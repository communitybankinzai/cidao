# 冠水の投稿のうち「海の上」を除くための陸地の升目を作る（src/lib/land-mask-chiba.json）。
# 国土地理院の標高タイル（dem_png・z11、海は RGB 128,0,0）から、0.002度（約200m）の升目ごとに
# 1点でも陸があれば陸とする。実行：python scripts/build-land-mask-chiba.py（cidao の直下で）
import math,io,urllib.request,urllib.error,base64,json
from PIL import Image
Z=11; W,S_,E,N=139.70,34.85,140.90,36.15; STEP=0.002
def tx(lon): return (lon+180)/360*2**Z
def ty(lat): r=math.radians(lat); return (1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*2**Z
x0,x1=int(tx(W)),int(tx(E)); y0,y1=int(ty(N)),int(ty(S_))
tiles={}
for x in range(x0,x1+1):
    for y in range(y0,y1+1):
        try:
            b=urllib.request.urlopen(f'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{Z}/{x}/{y}.png',timeout=30).read()
            tiles[(x,y)]=Image.open(io.BytesIO(b)).convert('RGB').load()
        except urllib.error.HTTPError: tiles[(x,y)]=None
print('tiles',len(tiles),'missing',sum(v is None for v in tiles.values()))
def land(lat,lon):
    fx,fy=tx(lon),ty(lat); t=tiles.get((int(fx),int(fy)))
    if t is None: return False
    r,g,b=t[int((fx%1)*256),int((fy%1)*256)]
    return not (r==128 and g==0 and b==0)
cols=round((E-W)/STEP); rows=round((N-S_)/STEP)
bits=bytearray((cols*rows+7)//8); n=0
for j in range(rows):
    for i in range(cols):
        la0=S_+j*STEP; lo0=W+i*STEP
        # 升目内を3x3で調べ、1つでも陸なら陸
        if any(land(la0+STEP*(a+.5)/3, lo0+STEP*(b+.5)/3) for a in range(3) for b in range(3)):
            k=j*cols+i; bits[k//8]|=1<<(k%8); n+=1
print('cols',cols,'rows',rows,'land cells',n,'bytes',len(bits))
json.dump({'west':W,'south':S_,'step':STEP,'cols':cols,'rows':rows,'bits':base64.b64encode(bytes(bits)).decode()},open('src/lib/land-mask-chiba.json','w'))
