"""Build research/state-pilot/or.json from master.py + info.py + the scraped feeds."""
import json, re, html, datetime as dt, sys
sys.path.insert(0, ".")
from master import ORGS, EXTRA, SRC, OCN, ORCAH, ZERO, FFE, CJO, PCEF, OOA, OJTA
from info import INFO

TODAY = "2026-10-13"
EB = "or_energize_bend"

# ---------- gazetteer ----------
GAZ = {}
for line in open("gaz.zip", encoding="latin-1").read().splitlines()[1:]:
    f = line.split("\t")
    nm = re.sub(r" (city|CDP|town)$", "", f[3].strip())
    GAZ[nm] = (round(float(f[10]), 4), round(float(f[11].strip()), 4))
SALEM = GAZ["Salem"]

def coords(town):
    if town is None:
        return SALEM
    return GAZ[town]

# ---------- sources per org ----------
scan = {r["name"]: r for r in json.load(open("scan.json"))}
scan2 = {n: (u, c) for n, u, c in json.load(open("scan2.json"))}
ORCAH_PROFILE = {o["slug"]: o["link"] for o in json.load(open("orgs_clean.json"))}

MON = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
def parse_date(s):
    m = re.match(r"([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})", s)
    if not m: return None
    try: return dt.date(int(m.group(3)), MON[m.group(1).lower()], int(m.group(2))).isoformat()
    except Exception: return None

def last_activity(name):
    r = scan.get(name, {})
    ds = [parse_date(d) for d in r.get("dates", [])]
    ds = [d for d in ds if d and "2025-01-01" <= d <= TODAY]
    return max(ds) if ds else ""

# Energize Bend coalition partners (links/logos on energizebend.org)
EB_MEMBERS = ["The Environmental Center", "Sierra Club Juniper Group", "Breach Collective", "Oregon League of Conservation Voters",
              "350Deschutes", "Citizens' Climate Lobby Bend", "Deschutes Youth Climate Coalition", "Oregon Physicians for Social Responsibility"]
EB_SRC = "https://energizebend.org/"

rows = {}
for name, ab, web, coals, slug in ORGS:
    if name in ("Fossil Free Eugene", "Energize Bend"):
        continue  # these are coalitions on this map
    rows[name] = dict(name=name, abbrev=ab, web=web, coals=list(coals), slug=slug)
for name, ab, web in EXTRA:
    rows[name] = dict(name=name, abbrev=ab, web=web, coals=[], slug=None)
for name in ["Sierra Club Juniper Group", "Citizens' Climate Lobby Bend", "Deschutes Youth Climate Coalition"]:
    rows[name] = dict(name=name, abbrev={"Sierra Club Juniper Group": "Juniper Group", "Citizens' Climate Lobby Bend": "CCL Bend", "Deschutes Youth Climate Coalition": "DYCC"}[name],
                      web={"Sierra Club Juniper Group": "https://www.sierraclub.org/oregon/juniper/about", "Citizens' Climate Lobby Bend": "https://citizensclimatelobby.org/chapters/OR_Bend/", "Deschutes Youth Climate Coalition": ""}[name],
                      coals=[], slug=None)
for n in EB_MEMBERS:
    rows[n]["coals"].append(EB)

orgs = []
for name, r in rows.items():
    oid, town, typ, focus, tags, desc = INFO[name]
    lat, lng = coords(town)
    src = []
    for c in r["coals"]:
        src.append(EB_SRC if c == EB else SRC[c])
    if r["slug"]:
        src.append(ORCAH_PROFILE[r["slug"]])
    s = scan.get(name, {})
    if s.get("status") == 200:
        src.append(s.get("final") or r["web"])
    if name in scan2 and scan2[name][0]:
        src.append(scan2[name][0])
    o = dict(id=oid, name=name, abbrev=r["abbrev"], type=typ, geographic_focus=focus, description=desc,
             coalition_ids=list(dict.fromkeys(r["coals"])), lat=lat, lng=lng, last_activity=last_activity(name),
             website=r["web"] or "", topic_tags=tags, profile={"geo_precision": "approx"},
             projects=[], events=[], actions=[], sources=list(dict.fromkeys(src)))
    if town is None:
        o["remote"] = True
    if not o["website"]:
        del o["website"]
    orgs.append(o)
byname = {o["name"]: o for o in orgs}
byid = {o["id"]: o for o in orgs}
assert len(byid) == len(orgs), "duplicate ids"

# extra sources for groups only sourced elsewhere
for n, u in [("OPAL Environmental Justice Oregon", "https://orclimatehub.org/"), ("PCUN", "https://www.beyondtoxics.org/events/"),
             ("Next Up", "https://nextuporegon.org/"), ("Unite Oregon", "https://www.uniteoregon.org/")]:
    if u not in byname[n]["sources"]:
        byname[n]["sources"].append(u)

# ---------- coalitions ----------
def C(cid, name, abbrev, desc, tags, scope, color, town, web, src, last=""):
    lat, lng = coords(town)
    return dict(id=cid, name=name, abbrev=abbrev, description=desc, focus_tags=tags, geographic_scope=scope, color=color,
                lat=lat, lng=lng, member_ids=[], member_count=0, website=web, projects=[], events=[], actions=[],
                last_activity=last, sources=src)

coalitions = [
    C(OCN, "Oregon Conservation Network", "OCN", "Network of 42 Oregon conservation, climate and environmental justice groups convened by the Oregon League of Conservation Voters to set and pass shared priorities in the state legislature.",
      ["climate policy", "conservation", "legislative agenda"], "Statewide", "#2563eb", "Portland", "https://www.olcv.org/", [SRC[OCN]], "2025-02-25"),
    C(ORCAH, "Oregon Climate Action Hub", "ORCAH", "Statewide information hub that helps Oregonians find ways to act on climate, with a calendar, job board, resources and a directory of climate groups (shown here as its members). It also hosts monthly Liaison Lunches and the Resilience Action & Impact Network.",
      ["climate action", "events", "directory", "resilience"], "Statewide", "#16a34a", None, "https://orclimatehub.org/", ["https://orclimatehub.org/about-the-hub/", SRC[ORCAH]], "2026-10-02"),
    C(ZERO, "ZERO Coalition", "ZERO", "Coalition working to decarbonize Oregon's buildings from an equity-centered perspective, through policy, energy codes, outreach and Sustainable Building Week. Members also include about 18 architecture, engineering and building firms and a utility, not shown here.",
      ["buildings", "electrification", "energy codes", "equity"], "Statewide", "#f59e0b", "Portland", "https://www.zerocoalitionoregon.org/", [SRC[ZERO], "https://www.zerocoalitionoregon.org/", "https://orclimatehub.org/organization/zero-coalition/"]),
    C(FFE, "Fossil Free Eugene Coalition", "Fossil Free Eugene", "Grassroots coalition urging the City of Eugene to meet its climate goals: all-electric new buildings, a fund to move low-income households off fossil gas, and 100% renewable utilities. It is also a member of the ZERO Coalition.",
      ["electrification", "fossil gas", "data centers", "climate justice"], "Eugene and Lane County", "#dc2626", "Eugene", "https://fossilfreeeugene.org/", [SRC[FFE], "https://fossilfreeeugene.org/", SRC[ZERO]]),
    C(CJO, "Climate Jobs Oregon", "CJO", "Labor coalition launched in January 2026 by the Oregon AFL-CIO and building trades unions to push for a union-built clean energy transition: faster siting and permitting, new generation, storage and transmission, and union-built green public housing.",
      ["labor", "clean energy jobs", "permitting"], "Statewide", "#7c3aed", "Portland", "", [SRC[CJO], "https://www.solarpowerworldonline.com/2026/01/oregon-unions-band-together-to-form-clean-energy-jobs-coalition/"], "2026-02-20"),
    C(PCEF, "Portland Clean Energy Fund Coalition", "PCEF", "Coalition led by communities of color that won the 2018 Portland Clean Energy Fund ballot measure, which funds clean energy, efficiency, job training and green infrastructure for low-income and BIPOC Portlanders. In 2026 partners defeated a ballot measure to divert the fund in court and are running a Protect PCEF pledge.",
      ["environmental justice", "clean energy", "climate funding"], "Portland", "#0891b2", "Portland", "https://www.coalitioncommunitiescolor.org/pcef", [SRC[PCEF], "https://www.coalitioncommunitiescolor.org/pcef", "https://www.coalitioncommunitiescolor.org/ccc-news/2026/2/24/press-release-ej-advocates-respond-to-pcef-ruling"], "2026-06-16"),
    C(OOA, "Oregon Ocean Alliance", "Ocean Alliance", "Alliance of eight groups protecting Oregon's ocean and coast; through 2027 it focuses on funding for ocean conservation, ocean climate resilience and building champions among policymakers.",
      ["ocean", "coast", "climate resilience"], "Oregon coast and ocean", "#0ea5e9", "Gearhart", "", [SRC[OOA]]),
    C(OJTA, "Oregon Just Transition Alliance", "OJTA", "Statewide BIPOC-led environmental justice alliance of more than 20 place-based member groups on the coast, in Southern and Eastern Oregon and the Willamette Valley. It runs the Energy Justice Leadership Institute and Transportation Leadership Institute.",
      ["environmental justice", "just transition", "leadership"], "Statewide", "#ea580c", "Portland", "https://www.ojta.org/", ["https://give.communityin.org/profiles/oregon-just-transition-alliance", "https://www.beyondtoxics.org/partners/"]),
    C(EB, "Energize Bend", "Energize Bend", "Coalition advocating for building electrification in Bend through outreach, education and local policy; a member of the ZERO Coalition. Partners also include a few local businesses, not shown here.",
      ["electrification", "buildings", "clean energy"], "Bend", "#65a30d", "Bend", "https://energizebend.org/", [EB_SRC, SRC[ZERO]]),
]
coal = {c["id"]: c for c in coalitions}
coal[ORCAH]["remote"] = True  # no office address published

edges = []
for o in orgs:
    for c in o["coalition_ids"]:
        coal[c]["member_ids"].append(o["id"])
        edges.append({"source": c, "target": o["id"]})
for c in coalitions:
    c["member_count"] = len(c["member_ids"])

json.dump(dict(orgs=orgs, coalitions=coalitions, edges=edges), open("stage1.json", "w"), indent=1)
print(len(orgs), "orgs", len(coalitions), "coalitions", len(edges), "edges")
for c in coalitions: print(" ", c["abbrev"], c["member_count"])
