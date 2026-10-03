"""Sichtcheck für 02_bestand: 20 zufällige Treffer auf dem DOP20 als Kontaktbogen.

Aufruf aus pipeline/: python3 qa_bestand_sheet.py ausgabe.png [seed]
"""
import json, random, sys, rasterio, numpy as np
from rasterio.windows import from_bounds
from PIL import Image, ImageDraw
from shapely.geometry import shape
fc=json.load(open('../data/build/bestand.geojson'))['features']
random.seed(int(sys.argv[2]) if len(sys.argv)>2 else 1)
sel=random.sample(fc,20)
tiles=[]
for f in sel:
    g=shape(f['geometry']); cx,cy=g.centroid.x,g.centroid.y
    tile=f['properties']['kachel']
    with rasterio.open('../data/raw/dop20/'+tile) as d:
        b=(cx-12,cy-12,cx+12,cy+12); w=from_bounds(*b,d.transform)
        a=d.read(window=w,boundless=True).transpose(1,2,0)
    im=Image.fromarray(a.astype(np.uint8)).resize((240,240)); dr=ImageDraw.Draw(im)
    s=240/24
    pts=[((x-b[0])*s,(b[3]-y)*s) for x,y in g.exterior.coords]
    dr.line(pts+[pts[0]],fill=(255,0,0),width=2)
    p=f['properties']; dr.text((4,4),f"{p['id']} h{p['hoehe']} A{p['flaeche']} c{p['konfidenz']}",fill=(255,255,0))
    tiles.append(im)
sheet=Image.new('RGB',(240*5,240*4))
for i,t in enumerate(tiles): sheet.paste(t,((i%5)*240,(i//5)*240))
sheet.save(sys.argv[1])
