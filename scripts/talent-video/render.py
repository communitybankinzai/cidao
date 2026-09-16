"""人材バンク紹介ショート動画の作成（本番用・GitHub Actions の Ubuntu で動く）。

試作 C:/Users/nsfactory/talent-video-proto/render2.py を本番向けに直したもの。
- 入力は job JSON（run_job.py が DB から組み立てる）：
  {"style": "oshare|cool|hands", "voice": {"name","speaker","speed"}, "bgm": {"file","credit"},
   "scenes": [{"id","heading","narration","subtitle","photo"(ローカルの写真パス),"words"(省略可)}],
   "name": "表示名", "out": "出力 mp4", "work": "作業フォルダ"}
- VOICEVOX ENGINE（VOICEVOX_URL・既定 http://127.0.0.1:50021）と ffmpeg・Pillow が要る
- フォントは FONT_SANS_BOLD / FONT_SANS / FONT_SERIF の環境変数、無ければ Noto CJK（fonts-noto-cjk）→ Windows の BIZ UD の順に探す
- 出力は yuv420p・tv 範囲（yuvj420p だとスマホで映像が出ない）。maxrate 6M で容量に上限
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
import wave

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

sys.stdout.reconfigure(encoding='utf-8')
W, H, FPS = 1080, 1920, 30
SRC_SCALE = 1.5  # 動きのガタつきを減らすため、元画像は出力より大きく作る
VOICEVOX = os.environ.get('VOICEVOX_URL', 'http://127.0.0.1:50021')
MOTIONS = ['in', 'right', 'out', 'left']


def find_font(env, candidates):
    path = os.environ.get(env)
    for p in ([path] if path else []) + candidates:
        if p and os.path.exists(p):
            return p
    raise SystemExit(f'font not found for {env}: {candidates}')


FONTS = {
    'gothic_b': find_font('FONT_SANS_BOLD', ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'C:/Windows/Fonts/BIZ-UDGothicB.ttc']),
    'gothic_r': find_font('FONT_SANS', ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'C:/Windows/Fonts/BIZ-UDGothicR.ttc']),
    'mincho': find_font('FONT_SERIF', ['/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', 'C:/Windows/Fonts/BIZ-UDMinchoM.ttc']),
}
# Noto CJK の .ttc は index 0 が日本語（JP）。BIZ UD は index 1 がプロポーショナル版
FONT_INDEX = {k: (0 if 'Noto' in v else 1) for k, v in FONTS.items()}


def font(key, size):
    return ImageFont.truetype(FONTS[key], size, index=FONT_INDEX[key])


STYLES = {
    'oshare': dict(
        margin=1.20, amount=0.14, trans=['fade', 'smoothleft', 'fadewhite', 'smoothright', 'fade', 'smoothup', 'fade'], trans_dur=0.7,
        grade='eq=brightness=0.03:saturation=1.12:gamma=1.03,colorbalance=rs=0.04:gs=0.01:bs=-0.04,vignette=angle=PI/6',
        label='印西のひと紹介', head_font='mincho', head_size=86, accent=(247, 198, 160, 255),
        cap_box=(255, 255, 255, 215), cap_text=(45, 36, 30, 255), cap_size=52,
        pad_before=0.45, pad_after=0.8, split=False, anim=0.6, bgm_vol=0.15, card_bg=(246, 238, 229), card_fg=(70, 52, 40), fit_ratio=0.8),
    'cool': dict(
        margin=1.35, amount=0.26, trans=['slideleft', 'wipeleft', 'zoomin', 'slideup', 'wiperight', 'slideleft', 'zoomin'], trans_dur=0.35,
        grade='eq=contrast=1.18:saturation=0.82:brightness=-0.02,colorbalance=rs=0.05:bs=0.07:rh=0.06:bh=-0.04,vignette=angle=PI/4,noise=alls=6:allf=t',
        label='INZAI PEOPLE', head_font='gothic_b', head_size=112, accent=(255, 196, 0, 255),
        cap_box=(0, 0, 0, 195), cap_text=(255, 255, 255, 255), cap_size=56,
        pad_before=0.2, pad_after=0.5, split=True, anim=0.3, bgm_vol=0.2, card_bg=(14, 14, 16), card_fg=(255, 196, 0), fit_ratio=0.8),
    # 顔を出さない人の型：作品・手元の写真と、大きく動く文字の場面（words）で見せる。正方形の写真は切り抜いて画面いっぱいに使う
    'hands': dict(
        margin=1.15, amount=0.10, trans=['fade', 'smoothleft', 'fade', 'smoothup', 'fade', 'smoothright', 'fade'], trans_dur=0.6,
        grade='eq=brightness=0.02:saturation=1.08:gamma=1.02,colorbalance=rs=0.05:gs=0.01:bs=-0.05,vignette=angle=PI/5',
        label='印西のひと紹介', head_font='mincho', head_size=86, accent=(247, 198, 160, 255),
        cap_box=(255, 255, 255, 215), cap_text=(45, 36, 30, 255), cap_size=52,
        pad_before=0.45, pad_after=0.9, split=False, anim=0.6, bgm_vol=0.15, card_bg=(246, 238, 229), card_fg=(70, 52, 40),
        fit_ratio=1.1, words_size=112),
}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print(r.stderr[-3000:])
        raise SystemExit('ffmpeg failed')


def tts(text, voice, path):
    q = urllib.request.Request(f"{VOICEVOX}/audio_query?" + urllib.parse.urlencode({'text': text, 'speaker': voice['speaker']}), method='POST')
    query = json.loads(urllib.request.urlopen(q, timeout=120).read().decode('utf-8'))
    query['speedScale'] = voice.get('speed', 1.0)
    query['prePhonemeLength'] = 0.08
    query['postPhonemeLength'] = 0.08
    req = urllib.request.Request(f"{VOICEVOX}/synthesis?speaker={voice['speaker']}", data=json.dumps(query).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    open(path, 'wb').write(urllib.request.urlopen(req, timeout=600).read())
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def compose_photo(src, dst, margin, fit_ratio):
    """縦長写真は中央で切り抜き、横長（画面写真など）はぼかした背景の上に全体を置く。"""
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    cw, ch = int(W * margin * SRC_SCALE), int(H * margin * SRC_SCALE)
    cover = ImageOps.fit(im, (cw, ch), method=Image.LANCZOS)
    if im.width / im.height > fit_ratio:
        canvas = cover.filter(ImageFilter.GaussianBlur(50)).point(lambda v: int(v * 0.5))
        # 小さい画像（アイコン 256px など）も枠いっぱいまで拡大する。thumbnail は縮めるだけで、
        # 2026-09-16 に「画像が小さくて動画にする意味がない」と指摘された原因だった
        fit = ImageOps.contain(im, (int(cw * 0.92), int(ch * 0.58)), Image.LANCZOS)
        canvas.paste(fit, ((cw - fit.width) // 2, (ch - fit.height) // 2))
    else:
        canvas = cover
    canvas.save(dst, quality=92)


def wrap(draw, text, f, max_w):
    """読点・句点のあとで改行することを優先する。1句が長すぎるときだけ文字の途中で折る。"""
    phrases, cur = [], ''
    for ch in text:
        cur += ch
        if ch in '、。！？':
            phrases.append(cur)
            cur = ''
    if cur:
        phrases.append(cur)
    lines, line = [], ''
    for ph in phrases:
        if draw.textlength(line + ph, font=f) <= max_w:
            line += ph
            continue
        if line:
            lines.append(line)
            line = ''
        for ch in ph:
            if line and draw.textlength(line + ch, font=f) > max_w:
                lines.append(line)
                line = ch
            else:
                line += ch
    if line:
        lines.append(line)
    return lines


def heading_png(scene, st, dst):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((70, 96), st['label'], font=font('gothic_r', 36), fill=st['accent'])
    d.rectangle([70, 150, 70 + 90, 158], fill=st['accent'])
    f = font(st['head_font'], st['head_size'])
    for dx, dy in ((4, 4), (2, 2)):  # 影を付けて、明るい写真の上でも読めるようにする
        d.text((70 + dx, 176 + dy), scene['heading'], font=f, fill=(0, 0, 0, 150))
    d.text((70, 176), scene['heading'], font=f, fill=(255, 255, 255, 255))
    im.save(dst)


def caption_png(scene, st, dst):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font('gothic_b', st['cap_size'])
    lines = wrap(d, scene.get('subtitle') or scene['narration'], f, W - 190)
    lh = int(st['cap_size'] * 1.5)
    box_h = len(lines) * lh + 70
    y0 = H - box_h - 320  # 下端は SNS の操作ボタンに隠れるので空ける
    d.rounded_rectangle([48, y0, W - 48, y0 + box_h], radius=26, fill=st['cap_box'])
    d.rectangle([48, y0 + 22, 56, y0 + box_h - 22], fill=st['accent'])
    for i, line in enumerate(lines):
        d.text((92, y0 + 36 + i * lh), line, font=f, fill=st['cap_text'])
    im.save(dst)


def stock_badge(dst_png):
    """Openverse から補った画像の場面に「イメージ画像」の小さな表示を付ける（本人の活動写真と誤解させないため）。"""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font('gothic_b', 30)
    d.rounded_rectangle([W - 260, 300, W - 40, 350], radius=12, fill=(0, 0, 0, 140))
    d.text((W - 150, 325), 'イメージ画像', font=f, fill=(255, 255, 255, 230), anchor='mm')
    im.save(dst_png)


def zoompan(motion, frames, amount):
    c = "ih/2-(ih/zoom/2)"
    if motion == 'in':
        return f"zoompan=z='1+{amount}*on/{frames}':x='iw/2-(iw/zoom/2)':y='{c}'"
    if motion == 'out':
        return f"zoompan=z='1+{amount}*(1-on/{frames})':x='iw/2-(iw/zoom/2)':y='{c}'"
    if motion == 'left':
        return f"zoompan=z='1+{amount}':x='(iw-iw/zoom)*(1-on/{frames})':y='{c}'"
    return f"zoompan=z='1+{amount}':x='(iw-iw/zoom)*on/{frames}':y='{c}'"


def words_png(scene, st, k, dst):
    """大きな文字の場面：k 番目の句だけを描いた透明画像。句は画面中央に上から順に並べ、最後の句を差し色にする。"""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    words = scene['words']
    size = st['words_size']
    f = font(st['head_font'], size)
    while max(d.textlength(w, font=f) for w in words) > W - 160 and size > 60:
        size -= 4
        f = font(st['head_font'], size)
    lh = int(size * 1.45)
    y = (H - lh * len(words)) // 2 - 80 + k * lh
    if k == 0:
        d.text((80, 96), st['label'], font=font('gothic_r', 36), fill=st['accent'])
        d.rectangle([80, 150, 80 + 90, 158], fill=st['accent'])
    fill = st['accent'] if k == len(words) - 1 else (255, 255, 255, 255)
    for dx, dy in ((4, 4), (2, 2)):
        d.text((W // 2 + dx, y + dy), words[k], font=f, fill=(0, 0, 0, 160), anchor='mt')
    d.text((W // 2, y), words[k], font=f, fill=fill, anchor='mt')
    im.save(dst)


def words_clip(st, i, scene, work, bg, dur, narr, wav):
    """写真をぼかして暗くした上に、句を1つずつ下から浮かび上がらせる（写真が少ない人・顔を出さない人向け）。"""
    n = len(scene['words'])
    f = int(round(dur * FPS))
    a = st['anim']
    span = max(narr * 0.75, 0.5)  # ナレーションの4分の3までに全部の句を出し切る
    fc = (f"[0:v]{zoompan('in', f, st['amount'])}:d={f}:s={W}x{H}:fps={FPS},scale={W}:{H},gblur=sigma=14,"
          f"eq=brightness=-0.22,scale=in_range=full:out_range=tv,{st['grade']},format=yuv420p[b0];")
    inputs, prev = ['-i', bg], 'b0'
    for k in range(n):
        png = os.path.join(work, f"{i:02d}_w{k}.png")
        words_png(scene, st, k, png)
        t0 = st['pad_before'] * 0.5 + span * k / n
        inputs += ['-loop', '1', '-framerate', str(FPS), '-i', png]
        fc += (f"[{k + 1}:v]format=rgba,fade=t=in:st={t0:.2f}:d={a}:alpha=1[w{k}];"
               f"[{prev}][w{k}]overlay=x=0:y='(1-min(max(t-{t0:.2f},0)/{a},1))*60':eval=frame[b{k + 1}];")
        prev = f"b{k + 1}"
    fc += f"[{prev}]format=yuv420p[v]"
    out = os.path.join(work, f"{i:02d}_clip.mp4")
    run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', fc, '-map', '[v]', '-t', f"{dur:.3f}",
         '-r', str(FPS), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out])
    print(f"  scene {i} {scene['id']}（文字）: {dur:.2f}s（ナレーション {narr:.2f}s）", flush=True)
    return out, dur, wav


def scene_clip(st, i, scene, voice, work):
    wav = os.path.join(work, f"{i:02d}.wav")
    narr = tts(scene['narration'], voice, wav)
    dur = st['pad_before'] + narr + st['pad_after'] + st['trans_dur']  # 次の場面への切り替え分を足す
    bg = os.path.join(work, f"{i:02d}_bg.jpg")
    if scene.get('words'):  # 文字の場面は写真をぼかすので、横長でも画面いっぱいに切り抜く
        compose_photo(scene['photo'], bg, st['margin'], fit_ratio=99)
        return words_clip(st, i, scene, work, bg, dur, narr, wav)
    compose_photo(scene['photo'], bg, st['margin'], st['fit_ratio'])
    head, cap = os.path.join(work, f"{i:02d}_head.png"), os.path.join(work, f"{i:02d}_cap.png")
    heading_png(scene, st, head)
    caption_png(scene, st, cap)
    a = st['anim']
    tail = f"scale={W}:{H},scale=in_range=full:out_range=tv,{st['grade']},format=yuv420p"
    if st['split'] and dur > 3.0:
        # テンポよく版：1場面を2カットに分け、動きを変えてテンポを出す
        d1 = round(dur * 0.5, 3)
        d2 = round(dur - d1, 3)
        f1, f2 = int(round(d1 * FPS)), int(round(d2 * FPS))
        m1, m2 = MOTIONS[i % 4], MOTIONS[(i + 1) % 4]
        shots = (f"[0:v]{zoompan(m1, f1, st['amount'])}:d={f1}:s={W}x{H}:fps={FPS},{tail}[s1];"
                 f"[0:v]{zoompan(m2, f2, st['amount'])}:d={f2}:s={W}x{H}:fps={FPS},{tail}[s2];[s1][s2]concat=n=2:v=1:a=0[base];")
    else:
        f = int(round(dur * FPS))
        shots = f"[0:v]{zoompan(MOTIONS[i % 4], f, st['amount'])}:d={f}:s={W}x{H}:fps={FPS},{tail}[base];"
    fc = (shots +
          f"[1:v]format=rgba,fade=t=in:st=0.15:d={a}:alpha=1[h];"
          f"[2:v]format=rgba,fade=t=in:st={0.15 + a * 0.6:.2f}:d={a}:alpha=1[c];"
          f"[base][h]overlay=x='-(1-min(max(t-0.15,0)/{a},1))*260':y=0:eval=frame[b1];"
          f"[b1][c]overlay=x=0:y='(1-min(max(t-{0.15 + a * 0.6:.2f},0)/{a},1))*70':eval=frame")
    inputs = ['-i', bg, '-loop', '1', '-framerate', str(FPS), '-i', head, '-loop', '1', '-framerate', str(FPS), '-i', cap]
    if scene.get('stock'):
        badge = os.path.join(work, f"{i:02d}_badge.png")
        stock_badge(badge)
        fc += "[b2];[b2][3:v]overlay=0:0,format=yuv420p[v]"
        inputs += ['-loop', '1', '-framerate', str(FPS), '-i', badge]
    else:
        fc += ",format=yuv420p[v]"
    out = os.path.join(work, f"{i:02d}_clip.mp4")
    run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', fc, '-map', '[v]', '-t', f"{dur:.3f}",
         '-r', str(FPS), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out])
    print(f"  scene {i} {scene['id']}: {dur:.2f}s（ナレーション {narr:.2f}s）", flush=True)
    return out, dur, wav


def credits_clip(style, st, job, work):
    im = Image.new('RGB', (W, H), st['card_bg'])
    d = ImageDraw.Draw(im)
    d.text((W // 2, 720), job['name'], font=font(st['head_font'], 104), fill=st['card_fg'], anchor='mm')
    sub = (255, 255, 255) if style == 'cool' else (90, 70, 58)
    d.text((W // 2, 850), 'CiDAO 人材バンクで相談できます', font=font('gothic_b', 48), fill=sub, anchor='mm')
    f = font('gothic_r', 38)
    lines = [f"ナレーション　VOICEVOX:{job['voice']['name']}", job['bgm']['credit']]
    # イメージ画像（Openverse）のクレジット。CC BY は表示が条件。長い題名は切る
    seen = set()
    for s in job['scenes']:
        st_ = s.get('stock')
        if st_ and st_['url'] not in seen:
            seen.add(st_['url'])
            text = st_['attribution'] or f"{st_.get('creator', '')} ({st_['license']})"
            lines.append('写真　' + (text if len(text) <= 44 else text[:43] + '…'))
    lines.append('Community Bank INZAI 人材バンク')
    muted = (190, 190, 190) if style == 'cool' else (120, 100, 88)
    fs = font('gothic_r', 30) if len(lines) > 4 else f
    for k, line in enumerate(lines):
        d.text((W // 2, 1150 + k * (52 if len(lines) > 4 else 66)), line, font=fs, fill=muted, anchor='mm')
    card = os.path.join(work, 'credits.jpg')
    im.save(card, quality=92)
    dur = 3.6
    frames = int(dur * FPS)
    out = os.path.join(work, '99_credits.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', card, '-filter_complex',
         f"[0:v]scale={int(W * 1.1)}:{int(H * 1.1)},zoompan=z='1+0.05*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},"
         f"scale=in_range=full:out_range=tv,format=yuv420p[v]",
         '-map', '[v]', '-t', f"{dur}", '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', out])
    return out, dur


def render(job):
    style = job['style']
    st = STYLES[style]
    voice = job['voice']
    work, final = job['work'], job['out']
    os.makedirs(work, exist_ok=True)
    os.makedirs(os.path.dirname(final) or '.', exist_ok=True)
    print(f"[{style}] voice={voice['name']} bgm={os.path.basename(job['bgm']['file'])} scenes={len(job['scenes'])}", flush=True)
    scenes = [scene_clip(st, i, s, voice, work) for i, s in enumerate(job['scenes'])]
    cred = credits_clip(style, st, job, work)
    clips = [(p, d) for p, d, _ in scenes] + [cred]
    T = st['trans_dur']
    starts, t = [], 0.0
    for _, d in clips:
        starts.append(t)
        t += d - T
    total = starts[-1] + clips[-1][1]

    inputs = []
    for p, _ in clips:
        inputs += ['-i', p]
    for _, _, wav in scenes:
        inputs += ['-i', wav]
    inputs += ['-stream_loop', '-1', '-i', job['bgm']['file']]
    n, m = len(clips), len(scenes)
    parts, prev = [], '0:v'
    for k in range(1, n):
        tr = st['trans'][(k - 1) % len(st['trans'])]
        parts.append(f"[{prev}][{k}:v]xfade=transition={tr}:duration={T}:offset={starts[k]:.3f}[x{k}]")
        prev = f"x{k}"
    parts.append(f"[{prev}]format=yuv420p[vout]")
    mix = []
    for j in range(m):
        delay = int((starts[j] + st['pad_before']) * 1000)
        parts.append(f"[{n + j}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={delay}:all=1[n{j}]")
        mix.append(f"[n{j}]")
    parts.append(f"[{n + m}:a]aresample=48000,aformat=channel_layouts=stereo,volume={st['bgm_vol']},"
                 f"afade=t=in:d=1.2,afade=t=out:st={total - 2.5:.2f}:d=2.5[bgm]")
    mix.append('[bgm]')
    parts.append(f"{''.join(mix)}amix=inputs={m + 1}:duration=longest:normalize=0,atrim=0:{total:.3f},"
                 f"loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(parts),
         '-map', '[vout]', '-map', '[aout]', '-t', f"{total:.3f}",
         '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_range', 'tv',
         '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-preset', 'medium', '-crf', '23',
         '-maxrate', '6M', '-bufsize', '12M',
         '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', final])
    thumb = os.path.splitext(final)[0] + '_thumb.jpg'
    run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '1.2', '-i', final, '-frames:v', '1', '-vf', 'scale=540:-2', thumb])
    print(f"[{style}] done: {final} ({total:.1f}s)", flush=True)
    return final, thumb, total


if __name__ == '__main__':
    render(json.load(open(sys.argv[1], encoding='utf-8')))
