import json, re, sys
sys.path.insert(0, ".")
from ordata import load, save, owners
from build import coords, GAZ
from orutil import slug, _uniq
d = load(); O = owners(d)
ORG = {"1000 Friends of Oregon": "or_1000_friends", "Community Energy Project": "or_cep"}
have = {e["link"] for o in O.values() for e in o["events"]}
n = 0
for x in json.load(open("ebrite3.json")):
    org = x["org"][0] if isinstance(x["org"], list) and x["org"] else None
    if org not in ORG or x["url"] in have: continue
    oid = ORG[org]; o = O[oid]; e = x["ev"]
    m = re.search(r",\s*([A-Za-z .]+),\s*(?:OR|Oregon)", e.get("address") or "")
    t = m.group(1).strip() if m and m.group(1).strip() in GAZ else None
    ev = dict(id=_uniq(o["events"], f"{oid}_e_{slug(e['name'])}"), name=e["name"].strip(), date=e["start"][:19],
              location=", ".join(v for v in [e.get("venue"), e.get("address")] if v) or "Details on the event page",
              description=re.sub(r"\s+", " ", e["desc"]).strip()[:220], link=x["url"], online=bool(e["online"]), verified=True, sources=[x["url"]])
    if e.get("end"): ev["end"] = e["end"][:19]
    if t and not e["online"]: ev["lat"], ev["lng"] = coords(t)
    o["events"].append(ev); have.add(x["url"]); n += 1
    print(oid, ev["date"], ev["name"][:70], "|", ev["location"][:50])
save(d); print("added", n)
