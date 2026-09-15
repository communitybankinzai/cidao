"""待っている紹介動画の仕事を1件ずつ取り、写真と BGM を非公開バケットから下ろし、render.py で作って、動画を上げ、DB を更新する。

GitHub Actions（.github/workflows/talent-video.yml）から動く。環境変数：
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（DB とストレージの読み書き）, VOICEVOX_URL（省略可）
  MAX_JOBS（1回に作る本数・既定 3）
- 仕事の取り方：status=queued の行を claimed_at の空きで「先に取った方が勝ち」（同じ行を2つの実行が取らない）
- 失敗したら status=failed と短い理由を書く（本文・写真は残さない）
- 使い方：python scripts/talent-video/run_job.py   ／ 待っている件数だけ見る：python run_job.py --count
"""
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
BASE = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
MEDIA, BGM = 'talent-media', 'talent-bgm'


def api(path, method='GET', data=None, headers=None, raw=False):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY}
    if data is not None and not raw:
        data = json.dumps(data).encode('utf-8')
        h['Content-Type'] = 'application/json'
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = r.read()
            return r.status, r.headers, body
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def rest(path, method='GET', data=None, prefer=None):
    st, hd, body = api('/rest/v1/' + path, method, data, {'Prefer': prefer} if prefer else None)
    if st >= 300:
        raise RuntimeError(f'rest {method} {path.split("?")[0]} -> {st}: {body[:200]!r}')
    return json.loads(body) if body else None


def download(bucket, path, dst):
    st, _, body = api(f'/storage/v1/object/{bucket}/{urllib.parse.quote(path)}')
    if st != 200:
        raise RuntimeError(f'download {bucket}/{path} -> {st}')
    open(dst, 'wb').write(body)


def upload(bucket, path, src, ctype):
    st, _, body = api(f'/storage/v1/object/{bucket}/{urllib.parse.quote(path)}', 'POST', open(src, 'rb').read(),
                      {'Content-Type': ctype, 'x-upsert': 'true'}, raw=True)
    if st != 200:
        raise RuntimeError(f'upload {bucket}/{path} -> {st}: {body[:200]!r}')


def claim():
    """queued の先頭を、claimed_at が空のときだけ rendering にする。0件なら None。"""
    rows = rest('talent_videos?status=eq.queued&order=created_at.asc&limit=1&select=id')
    if not rows:
        return None
    vid = rows[0]['id']
    got = rest(f'talent_videos?id=eq.{vid}&status=eq.queued&claimed_at=is.null', 'PATCH',
               {'status': 'rendering', 'claimed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, 'return=representation')
    return got[0] if got else claim()


def fail(vid, reason):
    rest(f'talent_videos?id=eq.{vid}', 'PATCH', {'status': 'failed', 'error': str(reason)[:300]})
    print(f'job {vid}: failed: {str(reason)[:300]}', flush=True)


def process(job):
    import render  # フォントの検査はここで走る
    vid = job['id']
    tmp = tempfile.mkdtemp(prefix='talent-video-')
    try:
        script = job['script_json']
        scenes = []
        for i, s in enumerate(script['scenes']):
            local = os.path.join(tmp, f'photo{i}.jpg')
            download(MEDIA, s['photo'], local)
            scenes.append(dict(s, photo=local))
        bgm_local = os.path.join(tmp, 'bgm.mp3')
        download(BGM, job['bgm_file'], bgm_local)
        out = os.path.join(tmp, 'out.mp4')
        final, thumb, total = render.render({
            'style': job['style'], 'voice': {'name': job['voice_name'], 'speaker': job['voice_speaker'], 'speed': float(job['voice_speed'])},
            'bgm': {'file': bgm_local, 'credit': job['bgm_credit']}, 'scenes': scenes, 'name': script['name'],
            'out': out, 'work': os.path.join(tmp, 'work'),
        })
        vpath, tpath = f"videos/{vid}.mp4", f"thumbs/{vid}.jpg"
        upload(MEDIA, vpath, final, 'video/mp4')
        upload(MEDIA, tpath, thumb, 'image/jpeg')
        rest(f'talent_videos?id=eq.{vid}', 'PATCH', {
            'status': 'owner_review', 'storage_path': vpath, 'thumb_path': tpath, 'duration_sec': round(total, 1),
            'size_bytes': os.path.getsize(final), 'rendered_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'error': None,
        })
        # 本人に「できました」を知らせる（通知の表は既存。本文は入れない）
        rest('notifications', 'POST', {'recipient_id': job['member_id'], 'kind': 'member', 'title': '紹介動画ができました。確認して「公開してよい」か「作り直し」を選んでください', 'link_url': '/me/talent'})
        print(f'job {vid}: done ({total:.1f}s, {os.path.getsize(final) // 1024} KB)', flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    if '--count' in sys.argv:
        st, hd, _ = api('/rest/v1/talent_videos?status=eq.queued&select=id', headers={'Prefer': 'count=exact', 'Range': '0-0'})
        n = (hd.get('Content-Range') or '/0').split('/')[-1]
        print(n)
        return
    if not BASE or not KEY:
        raise SystemExit('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が要ります')
    for _ in range(int(os.environ.get('MAX_JOBS', '3'))):
        job = claim()
        if not job:
            print('no queued job', flush=True)
            break
        print(f"job {job['id']}: start ({job['style']} / {job['voice_name']} / {job['bgm_file']})", flush=True)
        try:
            process(job)
        except Exception as e:  # noqa: BLE001 - 1件の失敗で残りを止めない
            fail(job['id'], e)


if __name__ == '__main__':
    main()
