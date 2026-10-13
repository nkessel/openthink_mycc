import json, re, sys, concurrent.futures as cf
sys.path.insert(0,'.')
import requests
from bs4 import BeautifulSoup
from pf import allowed, UA
from master import ORGS, EXTRA
BUA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CITY=re.compile(r"([A-Z][A-Za-z.\- ]{2,25}),?\s+(?:OR|Oregon)\.?,?\s+(97\d{3})")
MON="(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
DATE=re.compile(MON+r"\.? \d{1,2},? 20(?:25|26)")
def scan(row):
    name,ab,web=row[0],row[1],row[2]
    r={"name":name,"web":web}
    if not web: return r
    try:
        if not allowed(web): r["err"]="robots"; return r
        x=requests.get(web,headers={"User-Agent":BUA},timeout=20)
        r["final"]=x.url; r["status"]=x.status_code
        s=BeautifulSoup(x.text,"html.parser")
        r["title"]=s.title.get_text(strip=True)[:120] if s.title else ""
        m=s.find("meta",attrs={"name":"description"}) or s.find("meta",attrs={"property":"og:description"})
        r["meta"]=(m.get("content") or "")[:300] if m else ""
        for t in s(["script","style"]): t.decompose()
        txt=re.sub(r"\s+"," ",s.get_text(" ",strip=True))
        r["cities"]=list(dict.fromkeys(f"{a.strip()} {z}" for a,z in CITY.findall(txt)))[:4]
        r["dates"]=list(dict.fromkeys(DATE.findall(txt)))[:8]
    except Exception as e:
        r["err"]=type(e).__name__
    return r
if __name__=="__main__":
  rows=[o[:3] for o in ORGS]+[e for e in EXTRA]
  with cf.ThreadPoolExecutor(12) as ex: res=list(ex.map(scan,rows))
  json.dump(res,open("scan.json","w"),indent=1)
  for r in res: print(r["name"],"|",r.get("status",r.get("err","-")),"|",r.get("cities"),"|",r.get("dates",[])[:3],"|",r.get("title","")[:50])
