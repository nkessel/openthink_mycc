import requests,re,json,sys,concurrent.futures as cf,html
sys.path.insert(0,'.')
from pf import allowed
from harvest import jsonld_events
from bs4 import BeautifulSoup
BUA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
L=json.load(open("ebrite_list.json"))
def go(u):
    if not allowed(u): return None
    try: r=requests.get(u,headers={"User-Agent":BUA},timeout=30)
    except Exception: return None
    s=BeautifulSoup(r.text,"html.parser"); ev=jsonld_events(s,u)
    org=None
    for sc in s.find_all("script",type="application/ld+json"):
        t=sc.string or ""
        m=re.search(r'"organizer"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"[^}]*?(?:"url"\s*:\s*"([^"]+)")?',t)
        if m: org=(html.unescape(m.group(1)),m.group(2)); break
    return {"url":u,"ev":ev[0] if ev else None,"org":org}
with cf.ThreadPoolExecutor(8) as ex: res=[x for x in ex.map(go,[u for u,e in L.items() if e["startDate"]>="2026-10-13"]) if x and x["ev"]]
json.dump(res,open("ebrite_ev.json","w"),indent=1,ensure_ascii=False)
from collections import Counter
c=Counter(r["org"][0] if r["org"] else "?" for r in res)
print(len(res)); [print(n,k) for k,n in c.most_common(200)]
