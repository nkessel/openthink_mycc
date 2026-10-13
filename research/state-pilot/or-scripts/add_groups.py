"""Round 2: more Oregon groups (CCL chapters, groups whose climate events are on Eventbrite) + their events."""
import json, re, sys
sys.path.insert(0, ".")
from ordata import load, save, owners
from build import coords, GAZ
from orutil import slug, _uniq

d = load(); O = owners(d)
CCL = "https://citizensclimatelobby.org/chapters/"

def org(oid, name, abbrev, typ, town, focus, tags, desc, web, sources, last=""):
    if oid in O: return O[oid]
    lat, lng = coords(town)
    o = dict(id=oid, name=name, abbrev=abbrev, type=typ, geographic_focus=focus, description=desc, coalition_ids=[], lat=lat, lng=lng,
             last_activity=last, website=web, topic_tags=tags, profile={"geo_precision": "approx"}, projects=[], events=[], actions=[], sources=sources)
    if town is None: o["remote"] = True
    d["organizations"].append(o); O[oid] = o
    return o

for oid, nm, town, path, focus in [("or_ccl_corvallis", "Citizens' Climate Lobby Corvallis", "Corvallis", "OR_Corvallis", "Corvallis"),
                                   ("or_ccl_eugene", "Citizens' Climate Lobby Eugene-Springfield", "Eugene", "OR_Eugene-Springfield", "Eugene-Springfield"),
                                   ("or_ccl_salem", "Citizens' Climate Lobby Salem-Keizer", "Salem", "OR_Salem-Keizer", "Salem-Keizer"),
                                   ("or_ccl_southern_oregon", "Citizens' Climate Lobby Southern Oregon", "Medford", "OR_Southern_Oregon", "Southern Oregon"),
                                   ("or_ccl_uo", "Citizens' Climate Lobby University of Oregon", "Eugene", "OR_University_of_Oregon", "University of Oregon")]:
    org(oid, nm, nm.replace("Citizens' Climate Lobby ", "CCL "), "campus_group" if "University" in nm else "informal_group", town, focus,
        ["climate policy", "lobbying"], f"Local chapter of Citizens' Climate Lobby, building political will for national climate policy ({focus}).", CCL + path + "/", [CCL, CCL + path + "/"])
O["or_ccl_portland"]["website"] = CCL + "OR_Portland/"
O["or_ccl_portland"]["sources"].append(CCL)

EB = json.load(open("ebrite_ev.json"))
def eb_src(org_name):
    return [r["url"] for r in EB if r["org"] and r["org"][0] == org_name]
NEW = [
    ("or_bef", "Bonneville Environmental Foundation", "BEF", S := "501c3", "Portland", "Regional", ["clean energy", "community solar", "water"],
     "Portland nonprofit working on freshwater restoration and credible climate solutions; it runs community solar workshops for Portland residents.", "https://www.b-e-f.org", "Bonneville Environmental Foundation"),
    ("or_jcwc", "Johnson Creek Watershed Council", "JCWC", S, "Portland", "Johnson Creek watershed", ["watersheds", "restoration", "science"],
     "Promotes restoration and stewardship of the Johnson Creek watershed through science and community engagement.", "https://www.jcwc.org", "Johnson Creek Watershed Council"),
    ("or_solve", "SOLVE", "SOLVE", S, "Portland", "Oregon and SW Washington", ["cleanups", "restoration", "volunteering"],
     "Brings thousands of volunteers together in Oregon and Southwest Washington to clean up and restore the environment.", "https://www.solve.org", "SOLVE"),
    ("or_solc", "Southern Oregon Land Conservancy", "SOLC", S, "Ashland", "Southern Oregon", ["land conservation", "stewardship"],
     "Land trust protecting natural areas in Southern Oregon, with open-land days and volunteer work parties.", "https://www.landconserve.org", "Southern Oregon Land Conservancy"),
    ("or_emswcd", "East Multnomah Soil & Water Conservation District", "EMSWCD", "government", "Portland", "East Multnomah County", ["climate resilience", "soil", "water", "urban trees"],
     "Local conservation district in east Multnomah County; runs climate resilience workshops and free tree giveaways for residents.", "https://emswcd.org", "East Multnomah Soil & Water Conservation District"),
    ("or_ecotrust", "Ecotrust", "Ecotrust", S, "Portland", "Regional", ["food systems", "farmers", "climate"],
     "Portland-based nonprofit working on food, farming and natural resources; hosts gatherings for farmers.", "https://ecotrust.org", "Ecotrust"),
]
src_site = {"or_bef": "https://www.b-e-f.org/", "or_jcwc": "https://www.jcwc.org/", "or_solve": "https://www.solve.org/", "or_solc": "https://www.landconserve.org/"}
for oid, nm, ab, typ, town, focus, tags, desc, web, ebname in NEW:
    srcs = ([src_site[oid]] if oid in src_site else []) + eb_src(ebname)[:2]
    o = org(oid, nm, ab, typ, town, focus, tags, desc, web, srcs)
    for r in EB:
        if not r["org"] or r["org"][0] != ebname: continue
        e = r["ev"]
        if any(x["link"] == e["url"] for x in o["events"]): continue
        m = re.search(r",\s*([A-Za-z .]+),\s*(?:OR|Oregon)", e.get("address") or "")
        t = m.group(1).strip() if m and m.group(1).strip() in GAZ else None
        ev = dict(id=_uniq(o["events"], f"{oid}_e_{slug(e['name'])}"), name=e["name"].strip(), date=e["start"][:19],
                  location=", ".join(x for x in [e.get("venue"), e.get("address")] if x) or "Details on the event page",
                  description=re.sub(r"\s+", " ", e["desc"]).strip()[:220], link=e["url"], online=bool(e["online"]), verified=True, sources=[e["url"]])
        if e.get("end"): ev["end"] = e["end"][:19]
        if t and not e["online"]: ev["lat"], ev["lng"] = coords(t)
        o["events"].append(ev)

# ONDA restoration trips and gatherings (schema.org events on onda.org)
H = json.load(open("harvest.json"))
for e in H.get("or_onda", []):
    o = O["or_onda"]
    if any(x["link"] == e["url"] for x in o["events"]): continue
    ev = dict(id=_uniq(o["events"], f"or_onda_e_{slug(e['name'])}"), name=e["name"], date=e["start"][:19], location=", ".join(x for x in [e.get("venue"), e.get("address")] if x) or "Details on the event page",
              description=re.sub(r"\s+", " ", e["desc"]).strip()[:220], link=e["url"], online=bool(e["online"]), verified=True, sources=[e["url"]])
    if e.get("end"): ev["end"] = e["end"][:19]
    for t in ("Portland", "Bend"):
        if t in e["name"]: ev["lat"], ev["lng"] = coords(t)
    o["events"].append(ev)

# OJTA: dated activity from its own testimony
oj = O["or_ojta"]; oj["last_activity"] = "2025-03-10"
oj["sources"].append("https://apps.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/148462")

save(d)
print(len(d["organizations"]), "orgs;", sum(len(o["events"]) for o in d["organizations"] + d["coalitions"]), "events")
