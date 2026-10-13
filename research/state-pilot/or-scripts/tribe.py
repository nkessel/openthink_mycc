import json,sys,concurrent.futures as cf
sys.path.insert(0,'.')
import requests
from urllib.parse import urlparse
from pf import allowed
from scan import BUA
from master import ORGS,EXTRA
rows=[o[:3] for o in ORGS]+list(EXTRA)
def go(r):
    if not r[2]: return None
    p=urlparse(r[2]); root=f"{p.scheme}://{p.netloc}"
    u=root+"/wp-json/tribe/events/v1/events?start_date=2026-10-13&per_page=50"
    try:
        if not allowed(u): return (r[0],"robots")
        x=requests.get(u,headers={"User-Agent":BUA},timeout=20)
        if x.status_code!=200: return None
        d=x.json(); ev=d.get("events",[])
        return (r[0],[{"title":e["title"],"start":e["start_date"],"end":e["end_date"],"url":e["url"],"venue":(e.get("venue") or {}) if isinstance(e.get("venue"),dict) else {},"desc":e.get("description","")[:600],"cost":e.get("cost"),"website":e.get("website")} for e in ev])
    except Exception as ex: return None
with cf.ThreadPoolExecutor(12) as ex: out=[o for o in ex.map(go,rows) if o]
json.dump(out,open("tribe.json","w"),indent=1)
for n,ev in out:
    if ev=="robots": print(n,"ROBOTS"); continue
    print(f"== {n}: {len(ev)}")
    for e in ev[:30]: print("  ",e["start"],"|",e["title"][:80],"|",(e["venue"].get("venue") or "")[:30],e["venue"].get("city",""))
