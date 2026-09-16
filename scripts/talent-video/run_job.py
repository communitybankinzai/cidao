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
import re
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


OPENVERSE = 'https://api.openverse.org/v1/images/'
STOCK_LICENSES = 'cc0,pdm,by'  # 動画に組み込んで本人が SNS に使うので、商用可・継承条件なしのものだけ（BY-SA・NC・ND は使わない）


# 人物・政治・お金・ブランドなどを示す語。検索語か写真の題名・タグに含まれたら使わない（別の人がその人だと誤解される・不適切な写真が混ざる。2026-09-16）
STOCK_BLOCK = {'people', 'person', 'man', 'men', 'woman', 'women', 'boy', 'girl', 'child', 'children', 'kid', 'kids', 'baby', 'family', 'parent',
               'mother', 'father', 'team', 'player', 'players', 'crowd', 'portrait', 'face', 'faces', 'couple', 'friends', 'group', 'student', 'students',
               'teacher', 'worker', 'workers', 'staff', 'adult', 'adults', 'meeting', 'conversation', 'talking', 'chatting', 'party', 'political', 'politics',
               'election', 'vote', 'campaign', 'flag', 'protest', 'money', 'cash', 'banknote', 'coin', 'coins', 'currency', 'dollar', 'euro', 'pound',
               'logo', 'brand', 'advert', 'advertisement', 'poster', 'flyer', 'religion', 'church', 'military', 'gun', 'weapon', 'alcohol', 'beer', 'wine'}


def find_stock(query, used):
    """Openverse（CC0／パブリックドメイン／CC BY）から、検索語が題名かタグに含まれる画像を1枚選ぶ。無ければ None。
    匿名の上限は 20回/分・200回/日（2026-09-16 実測）。"""
    words = [w.lower() for w in query.replace(',', ' ').split() if len(w) > 2]
    if not words:
        return None
    q = urllib.parse.urlencode({'q': query, 'license': STOCK_LICENSES, 'size': 'large,medium', 'page_size': 20, 'mature': 'false'})
    req = urllib.request.Request(OPENVERSE + '?' + q, headers={'User-Agent': 'CiDAO-talent-video/1.0 (communitybankinzai@gmail.com)'})
    try:
        data = json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8'))
    except Exception as e:  # noqa: BLE001
        print(f'  openverse: {e}', flush=True)
        return None
    if any(w in STOCK_BLOCK for w in words):
        return None  # 人物や場面が主役の検索語には画像を付けない（文字の場面になる）
    need = (len(words) + 1) // 2  # 検索語の半分以上が題名・タグに含まれるものだけ
    best, best_score = None, 0
    for r in data.get('results', []):
        if r.get('url') in used or not r.get('url') or min(r.get('width') or 0, r.get('height') or 0) < 600:
            continue
        tokens = set(re.findall(r'[a-z]+', ' '.join([r.get('title') or ''] + [t.get('name', '') for t in (r.get('tags') or [])]).lower()))
        if tokens & STOCK_BLOCK:
            continue
        score = sum(1 for w in words if w in tokens)
        if score >= need and score > best_score:
            best, best_score = r, score
    if not best:
        return None
    return {'url': best['url'], 'attribution': (best.get('attribution') or '').split('. To view')[0].strip(),
            'license': f"{best.get('license', '').upper()} {best.get('license_version', '')}".strip(),
            'creator': best.get('creator') or '', 'title': best.get('title') or ''}


def fetch_stock_photos(script, tmp):
    """本人の写真が1枚以下（use_stock）のとき、最初と最後以外の場面の画像を Openverse で補う。取れた分だけ差し替え、出どころを scene['stock'] に残す。"""
    used, n = set(), 0
    for i, s in enumerate(script['scenes']):
        s.pop('stock', None)  # 前回の選択は引き継がない（作り直しのたびに選び直す）
        if s['id'] in ('title', 'cta') or not s.get('query'):
            continue
        pick = find_stock(s['query'], used)
        if not pick:
            continue
        local = os.path.join(tmp, f'stock{i}.jpg')
        try:
            req = urllib.request.Request(pick['url'], headers={'User-Agent': 'CiDAO-talent-video/1.0'})
            open(local, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:  # noqa: BLE001
            print(f'  stock download failed: {e}', flush=True)
            continue
        used.add(pick['url'])
        s['stock'] = {'attribution': pick['attribution'], 'license': pick['license'], 'url': pick['url']}
        s['_stock_local'] = local
        n += 1
    print(f'  イメージ画像 {n} 枚（Openverse）', flush=True)
    return n


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
        # 写真は、積まれた後に本人が消していることがある。取れない写真は取れた写真で代用し、1枚も無いときだけ失敗にする
        local_by_path, missing = {}, []
        for s in script['scenes']:
            p = s['photo']
            if p in local_by_path or p in missing:
                continue
            local = os.path.join(tmp, f'photo{len(local_by_path)}.jpg')
            try:
                download(MEDIA, p, local)
                local_by_path[p] = local
            except RuntimeError:
                missing.append(p)
        if not local_by_path:
            raise RuntimeError('写真が1枚もありません（登録し直してください）')
        if missing:
            print(f'  {len(missing)} 枚の写真が見つからないので、ほかの写真で代用します', flush=True)
        available = list(local_by_path.values())
        if script.get('use_stock'):
            fetch_stock_photos(script, tmp)
        scenes = [dict(s, photo=s.get('_stock_local') or local_by_path.get(s['photo'], available[i % len(available)])) for i, s in enumerate(script['scenes'])]
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
        for s in script['scenes']:  # 使ったイメージ画像の出どころを台本に書き戻す（作業用の一時パスは残さない）
            s.pop('_stock_local', None)
        rest(f'talent_videos?id=eq.{vid}', 'PATCH', {
            'status': 'owner_review', 'storage_path': vpath, 'thumb_path': tpath, 'duration_sec': round(total, 1),
            'size_bytes': os.path.getsize(final), 'rendered_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'error': None,
            'script_json': script,
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
