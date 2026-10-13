import requests,re,json,sys,time,concurrent.futures as cf
sys.path.insert(0,'.')
from pf import allowed
BUA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
cities=["portland","eugene","bend","salem","corvallis","ashland","medford","hood-river","astoria","la-grande","pendleton","beaverton","springfield","newport","roseburg","coos-bay","klamath-falls","grants-pass"]
terms=["climate","environment","sustainability","clean-energy","conservation"]
out={}
def page(u):
    if not allowed(u): return []
    try: r=requests.get(u,headers={"User-Agent":BUA},timeout=30)
    except Exception: return []
    res=[]
    for l in re.findall(r'<script type="application/ld\+json">(.*?)</script>',r.text,re.S):
        try: j=json.loads(l)
        except Exception: continue
        for it in (j.get("itemListElement",[]) if isinstance(j,dict) else []):
            e=it.get("item",{})
            if e.get("startDate"): res.append(e)
    return res
urls=[f"https://www.eventbrite.com/d/or--{c}/{t}/" for c in cities for t in terms]
with cf.ThreadPoolExecutor(6) as ex:
    for evs in ex.map(page,urls):
        for e in evs: out[e["url"]]=e
json.dump(out,open("ebrite_list.json","w"),indent=1)
print(len(out))
