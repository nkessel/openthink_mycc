import json,requests,io,os,sys
sys.path.insert(0,'.')
from PIL import Image
BUA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
orgs=json.load(open('orgs.json'))
from info import INFO
from master import ORGS
slug2name={o[4]:o[0] for o in ORGS if o[4]}
slug2name['oregon-climate-action-hub']='__orcah'
ids=[o['featured_media'] for o in orgs if o['featured_media']]
med={}
for i in range(0,len(ids),50):
    r=requests.get("https://orclimatehub.org/wp-json/wp/v2/media",params={"include":",".join(map(str,ids[i:i+50])),"per_page":50},headers={"User-Agent":BUA},timeout=30)
    for m in r.json(): med[m['id']]=(m['source_url'],m.get('title',{}).get('rendered',''))
os.makedirs('orcahlogos',exist_ok=True)
rep={}
for o in orgs:
    n=slug2name.get(o['slug'])
    if not n or o['featured_media'] not in med: continue
    oid='or_orcah' if n=='__orcah' else INFO[n][0]
    url,title=med[o['featured_media']]
    try:
        x=requests.get(url,headers={"User-Agent":BUA},timeout=30)
        im=Image.open(io.BytesIO(x.content)).convert("RGBA"); w,h=im.size
        im.thumbnail((400,400)); im.save(f'orcahlogos/{oid}.png')
        rep[oid]={"url":url,"title":title,"size":[w,h],"page":o['link']}
    except Exception as e: rep[oid]={"err":str(e)}
json.dump(rep,open('orcahlogos/report.json','w'),indent=1)
print(len(rep))
for k,v in rep.items(): print(k,v.get('title','')[:50],v.get('size'),v.get('err',''))
