import json,re,sys,concurrent.futures as cf
sys.path.insert(0,'.')
import requests
from bs4 import BeautifulSoup
from pf import allowed
from scan import CITY,BUA
res=json.load(open('scan.json'))
need=[r for r in res if r.get('status')==200 and not r.get('cities')]
def go(r):
    base=r['final'].rstrip('/')
    from urllib.parse import urlparse
    p=urlparse(base); root=f"{p.scheme}://{p.netloc}"
    for path in ["/contact","/contact-us","/about","/about-us","/oregon"]:
        u=root+path
        try:
            if not allowed(u): continue
            x=requests.get(u,headers={"User-Agent":BUA},timeout=15)
            if x.status_code!=200: continue
            t=re.sub(r"\s+"," ",BeautifulSoup(x.text,"html.parser").get_text(" "))
            c=list(dict.fromkeys(f"{a.strip()} {z}" for a,z in CITY.findall(t)))
            if c: return r['name'],u,c[:4]
        except Exception: pass
    return r['name'],None,[]
with cf.ThreadPoolExecutor(12) as ex:
    out=list(ex.map(go,need))
json.dump(out,open('scan2.json','w'),indent=1)
for o in out: print(o)
