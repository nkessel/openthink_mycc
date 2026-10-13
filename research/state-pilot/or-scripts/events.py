"""Add events, projects and actions to stage1.json -> research/state-pilot/or.json"""
import json, re, html, datetime as dt, sys
sys.path.insert(0, ".")
from build import GAZ, coords

d = json.load(open("stage1.json"))
owners = {o["id"]: o for o in d["orgs"]}
owners.update({c["id"]: c for c in d["coalitions"]})
TODAY = "2026-10-13"
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORD = {1: "First", 2: "Second", 3: "Third", 4: "Fourth"}

def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", html.unescape(s).lower()).strip("_")[:40]

def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()

def first_sentences(s, n=220):
    s = clean(s)
    if len(s) <= n: return s
    cut = s[:n]
    i = cut.rfind(". ")
    return (cut[: i + 1] if i > 80 else cut.rsplit(" ", 1)[0] + "…")

def ev(owner, name, date, location, desc, link, src, end=None, online=False, town=None, rec=None, host=None, verified=True, lat=None, lng=None, rsvp=None):
    e = dict(id=f"{owner}_e_{slug(name)}", name=html.unescape(name), date=date, location=location, description=desc,
             link=link, online=online, verified=verified, sources=src)
    if end: e["end"] = end
    if rec: e["recurrence"] = rec
    if host: e["host_org_id"] = host
    if rsvp: e["rsvp_link"] = rsvp
    if not online and town:
        e["lat"], e["lng"] = coords(town)
    ids = {x["id"] for x in owners[owner]["events"]}
    k = 2
    while e["id"] in ids:
        e["id"] = f"{owner}_e_{slug(name)}_{k}"; k += 1
    owners[owner]["events"].append(e)

def proj(owner, name, desc, link, src, status="active", host=None):
    p = dict(id=f"{owner}_p_{slug(name)}", name=name, description=desc, status=status, skills_needed=[], link=link, verified=True, sources=src)
    if host: p["host_org_id"] = host
    owners[owner]["projects"].append(p)

def act(owner, name, desc, link, src, kind="task", deadline=None, host=None):
    a = dict(id=f"{owner}_a_{slug(name)}", kind=kind, name=name, skills_needed=[], deadline=deadline, description=desc, link=link, verified=True, sources=src)
    if host: a["host_org_id"] = host
    owners[owner]["actions"].append(a)

# ---------- recurring series from event-calendar feeds ----------
tribe = {n: e for n, e in json.load(open("tribe.json")) if e != "robots"}

def series(evs):
    """Collapse repeats of one title into (first event, recurrence text or None)."""
    ds = [dt.datetime.fromisoformat(e["start"]) for e in evs]
    first = evs[0]
    if len(ds) < 3:
        return first, None
    t = ds[0].strftime("%-I:%M %p").replace(":00 ", " ")
    gaps = {(b - a).days for a, b in zip(ds, ds[1:])}
    wd = {x.weekday() for x in ds}
    if len(wd) == 1:
        day = DAYS[ds[0].weekday()]
        if gaps == {7}: return first, f"Every {day}, {t}"
        if gaps == {14}: return first, f"Every other {day}, {t}"
        nths = {(x.day - 1) // 7 + 1 for x in ds}
        if len(nths) == 1 and min(nths) <= 4: return first, f"{ORD[min(nths)]} {day} of each month, {t}"
    return first, None

def from_feed(feed_name, owner, titles, town_default=None, host=None):
    evs = [e for e in tribe[feed_name] if e["start"][:10] >= TODAY]
    for title in titles:
        grp = [e for e in evs if clean(e["title"]) == title]
        if not grp:
            print("  !! not found", feed_name, title); continue
        e, rec = series(grp)
        v = e.get("venue") or {}
        vname = clean(v.get("venue") or "")
        desc = first_sentences(e["desc"])
        online = bool(re.search(r"zoom|virtual|online", (vname + " " + e["title"] + " " + desc[:200]).lower())) and not v.get("address")
        town = v.get("city") if v.get("city") in GAZ else town_default
        if v.get("address"):
            loc = f"{vname}, {clean(v['address'])}, {v.get('city')}"
        elif online:
            loc = "Online"
        else:
            loc = "Details on the event page"; town = None
        ev(owner, title, e["start"].replace(" ", "T"), loc, desc, e["url"], [e["url"]], end=e["end"].replace(" ", "T"),
           online=online, town=town, rec=rec, host=host, rsvp=e.get("website") or None)

from_feed("350PDX", "or_350pdx", ["Defend Forest Park Rally and Watch Party", "Energy Justice Team", "Washington County Team Meeting",
          "Forest Defense Team Meeting", "Milwaukie Advocates for Climate (MAC) Monthly Meeting", "Ballot-filling Party!", "Book Club: virtual or in-person",
          "350PDX Art Build", "Southwest Team Meeting", "Brooklyn Climate Action Team: Regular Meeting"], "Portland")
from_feed("Rogue Climate", "or_rogue_climate", ["First Time Youth Voter Training (Hybrid)", "📣 Get Out the Vote Gathering (Rogue Valley)",
          "💚 Weekly Rogue Climate Action Team (RCAT) Meeting", "🌿 Rogue Valley Monthly Volunteer Team Meeting", "🌊 South Coast Action Team (SCAT) Meeting",
          "🌻 Legislative Volunteer Team Meeting (virtual)"])
from_feed("Cascadia Wildlands", "or_cascadia_wildlands", ["Monthly WildCAT Meeting"])
from_feed("Friends of the Columbia Gorge", "or_gorge_friends", ["October Gorge Morning Walk", "Stewardship Day at Cape Horn Land Trust Preserve", "Fall Planting at Cape Horn Land Trust Preserve"])
from_feed("Friends of Family Farmers", "or_foff", ["Muckboots in the Capitol: Pre-Legislative Session Community Updates", "Community Meetings"])
from_feed("Wild Salmon Center", "or_wsc", ["OMSI Reel Science: Running Wild", "Forests, Fish & Ales Astoria"])
from_feed("Elakha Alliance", "or_elakha", ["2026 Elakha Alliance Science Symposium (Virtual)", "Ocean Conservation Linocut & Printmaking Workshop (Yachats) SOLD OUT"])
from_feed("Lake Oswego Sustainability Network", "or_losn", ["2026 Lake Oswego City Council Candidate Forum", "Foothills Clean Energy District Advocacy Training", "2026 Urban Forest Summit", "Lake Oswego Kids Clothing & Gear Swap"])
from_feed("Senior Advocates for Generational Equity", "or_sage", ["A Nation at 250 & Our Shared Future — A Conversation with Dr. Christopher McKnight Nichols", "Building the Future: What Becomes Possible When Generations Work Together?"])
from_feed("Solar Oregon", "or_solar_oregon", ["Comparing Solar Quotes – October 28th, 2026", "Solar Oregon’s Annual Celebration – 2026", "Green Energy Series #41: Passive Solar: Let the Sun Shine In", "How to Go Solar + Storage", "Green Energy Series #42: Optimizing Your Thermostat Settings"])
from_feed("ElectrifyPDX", "or_electrifypdx", ["Fall Webinar Series: Five Things You Should Know About Your Home’s Energy"])
from_feed("City of Bend", "or_bend", ["Environment and Climate Committee Meeting"])
from_feed("Fossil Free Eugene", "or_ffe", ["Climate Happy Hour"])

# ---------- Oregon Climate Action Hub calendar ----------
H = "https://orclimatehub.org/event/"
ev("or_orcah", "Forest Park Rally at Portland City Hall", "2026-10-14T08:45:00", "Portland City Hall, 1221 SW 4th Ave, Portland",
   "Rally with Forest Park Conservancy, Bird Alliance of Oregon, Sierra Club, 350PDX and others asking City Council to protect Forest Park from PGE's proposal to bypass the park's management plan.",
   H + "forest-park-rally-at-portland-city-hall/", [H + "forest-park-rally-at-portland-city-hall/"], end="2026-10-14T10:00:00", town="Portland")
ev("or_orcah", "October Liaison Lunch: Legislative Priorities in Oregon", "2026-10-16T12:00:00", "Online",
   "The Environmental Caucus chief of staff previews environmental priorities for the 2027 legislative session, with Q&A.",
   H + "october-liaison-lunch-this-could-be-you/", [H + "october-liaison-lunch-this-could-be-you/"], end="2026-10-16T13:00:00", online=True)
ev("or_orcah", "November Liaison Lunch: Electrify Oregon", "2026-11-20T12:00:00", "Online", "Presentation by hub partner Electrify Oregon; agenda to come.",
   H + "october-liaison-lunch-this-could-be-you-2/", [H + "october-liaison-lunch-this-could-be-you-2/"], end="2026-11-20T13:00:00", online=True, host="or_electrify_oregon")
for date, slugp in [("2026-10-16", "oregon-climate-action-commission-virtual-meeting-8/"), ("2026-12-11", "oregon-climate-action-commission-virtual-meeting-9/")]:
    ev("or_orcah", "Oregon Climate Action Commission meeting", f"{date}T09:00:00", "Online",
       "Public online meeting of the state's Climate Action Commission; materials are posted in advance.", H + slugp, [H + slugp], end=f"{date}T12:00:00", online=True)
ev("or_orcah", "Oregon Resilience Summit", "2026-10-21T13:00:00", "Sunriver Resort, Sunriver",
   "Three-day gathering on disaster recovery and resilience work across Oregon, with networking and sessions.",
   "https://oregonresilience.org/ors2026/", [H + "oregon-resilience-summit/"], end="2026-10-23T13:00:00", town="Sunriver")
ev("or_orcah", "The Energy Security Dilemma (Bend talk)", "2026-11-09T18:30:00", "Bend",
   "Talk by David Bernell on fossil fuels, renewables and energy security in a time of war and climate change, from Central Oregon Community College's community learning series.",
   "https://cocc.edu/departments/foundation/cls/", [H + "bend-the-energy-security-dilemma-fossil-fuels-and-renewable-energy-in-a-time-of-war-and-climate-change/"], end="2026-11-09T20:00:00", town="Bend")
ev("or_orcah", "Washington Oregon Higher Education Sustainability Conference 2027", "2027-03-03T08:00:00", "In person (venue on the conference site)",
   "Regional conference for campuses and communities on climate resilience, decarbonization and student engagement.",
   "https://www.wohesc.com/2027", [H + "washington-oregon-higher-education-sustainability-conference-2027/"], end="2027-03-05T15:00:00")
act("or_orcah", "Join the Resilience Action & Impact Network (RAIN)", "Sign-up form for advocates who want to connect with others and shape the Plan for a Resilient Oregon.",
    "https://forms.cloud.microsoft/pages/responsepage.aspx?id=Mmk_qnz6tEegzqWYytFhz2StSjLKfhFBvP-vaxKdD7FUQkxGRlRHODdQRkpNM0c4UzVQR0xON0M5Si4u&route=shorturl",
    [H + "join-the-resilience-action-impact-network-rain/"], deadline="2026-10-21")
act("or_orcah", "Propose a session for WOHESC 2027", "Call for proposals for the March 2027 Washington Oregon Higher Education Sustainability Conference.",
    "https://www.wohesc.com/2027", [H + "wohesc-call-for-proposals-deadline/"], deadline="2026-10-16")
proj("or_orcah", "Oregon climate action calendar and directory", "Public calendar, job board, resources and directory of Oregon climate groups, open to submissions from groups.",
     "https://orclimatehub.org/archive/events/", ["https://orclimatehub.org/"])

# Oregon Business for Climate + On Purpose Oregon workshop series
for date, nm, sl in [("2026-10-20", "Common Cause: Business Power for Climate Action – The What", "common-cause-business-power-for-climate-action-the-what/"),
                     ("2026-11-17", "Common Cause: Business Power for Climate Action – The How", "common-cause-business-power-for-climate-action-the-how/")]:
    ev("or_ob4c", nm, f"{date}T16:00:00", "In person (venue on the event page)",
       "Part of a three-part workshop and networking series with On Purpose Oregon to help purpose-driven businesses engage in Oregon climate policy.",
       H + sl, [H + sl], end=f"{date}T18:00:00")

# ZERO Coalition
ev("or_zero", "November Sustainable Building Monthly: ZERO quarterly meeting", "2026-11-10T17:00:00", "In person (venue on the event page)",
   "Final quarterly meeting of 2026: recap of policy, code and advocacy wins and a preview of priorities for the 2027 legislative session.",
   H + "november-sustainable-building-monthly/", [H + "november-sustainable-building-monthly/"], end="2026-11-10T19:00:00")
ev("or_zero", "December Sustainable Building Monthly: holiday party", "2026-12-08T17:00:00", "In person (venue on the event page)",
   "End-of-year gathering of Sustainable Building Monthly, ASHRAE Oregon and partners.", H + "december-sustainable-building-monthly/", [H + "december-sustainable-building-monthly/"], end="2026-12-08T19:00:00")
proj("or_zero", "7 Steps to Cost-Effective Zero Energy", "Free guides for new buildings and retrofits that walk owners and builders through reaching zero energy step by step.",
     "https://www.zerocoalitionoregon.org/7stepsoverviewnew", ["https://www.zerocoalitionoregon.org/"])
proj("or_zero", "Sustainable Building Week", "Annual week of events on sustainable and zero-energy buildings; the 2026 edition ran October 5-9.",
     "https://www.zerocoalitionoregon.org/sustainable-building-week", ["https://www.zerocoalitionoregon.org/"], status="completed")
act("or_zero", "Become a ZERO Coalition member", "Organizations working on building decarbonization can apply to join by sending in the membership packet.",
    "https://www.zerocoalitionoregon.org/zerocoalitionmembership", ["https://www.zerocoalitionoregon.org/zerocoalitionmembership"])

# OrCAN
ev("or_orcan", "Oregon's Soil Health Summit", "2027-02-04T09:00:00", "LaSells Stewart Center, Corvallis",
   "Full-day summit for Oregon's farmers and ranchers on soil health for climate resilience, with the latest soil science and practical skills.",
   "https://www.oregonclimateag.org/soil-health-summit", [H + "soil-health-summit/"], end="2027-02-04T17:00:00", town="Corvallis")

# Columbia Riverkeeper (+ Friends of the Columbia Gorge)
RK = "https://www.columbiariverkeeper.org/event/"
ev("or_columbia_riverkeeper", "No Underwater Power Line community info session", "2026-10-14T18:00:00", "Thunder Island Brewing Co., 601 NW Wana Pa St., Cascade Locks",
   "Learn about the proposed high-voltage power line under the Columbia River, likely to serve data centers, and how to oppose it; co-hosted with Friends of the Columbia Gorge.",
   RK + "no-underwater-power-line-info-session-10-14-2026", [RK + "no-underwater-power-line-info-session-10-14-2026"], end="2026-10-14T20:00:00", town="Cascade Locks", host="or_gorge_friends")
ev("or_columbia_riverkeeper", "Webinar: From Road to River – tire chemicals, salmon and the Columbia", "2026-10-21T12:00:00", "Online",
   "One-hour webinar on 6PPD-quinone, a toxic tire chemical, and what it means for salmon in the Columbia River Basin.", RK + "webinar-10-21-2026/", [RK + "webinar-10-21-2026/"], online=True)
ev("or_columbia_riverkeeper", "Hanford Journey", "2026-10-23T08:30:00", "Vernita Safety Rest Area, SR-24, Washington",
   "Day along the Hanford Reach with the Yakama Nation's ERWM program to learn about the Hanford Nuclear Site cleanup.", RK + "hanford-journey-2026-10-23/", [RK + "hanford-journey-2026-10-23/"])
for nm, ds in [("No Underwater Power Line", "Campaign against a proposed high-voltage line under the Columbia River that would likely power data centers."),
               ("Stand Up to Data Centers", "Columbia Riverkeeper campaign on data centers in the Columbia River region."),
               ("NEXT Energy Refinery", "Columbia Riverkeeper campaign against the proposed NEXT Energy refinery.")]:
    proj("or_columbia_riverkeeper", nm, ds, "https://www.columbiariverkeeper.org/campaigns/zenith-oil-by-rail/", ["https://www.columbiariverkeeper.org/campaigns/zenith-oil-by-rail/"])

# Beyond Toxics / PCUN
BT = "https://www.beyondtoxics.org/event/"
ev("or_beyond_toxics", "West Eugene Community Meeting", "2026-10-14T17:30:00", "Amicus Memorial Garden Collaborative, 255 Maxwell Rd., Eugene",
   "Community meeting for West Eugene residents with Q&A and light refreshments.", BT + "west-eugene-community-meeting/", ["https://www.beyondtoxics.org/events/"], end="2026-10-14T19:30:00", town="Eugene")
ev("or_beyond_toxics", "Resilience Market (final of 2026)", "2026-10-24T10:00:00", "Amicus Memorial Garden Collaborative, 255 Maxwell Rd., Eugene",
   "The last Resilience Market of the year.", BT + "resilience-market-oct-24/", ["https://www.beyondtoxics.org/events/"], town="Eugene")
ev("or_pcun", "A Night in Solidarity with Farmworkers' Rights", "2026-10-29T17:00:00", "Wildish Theater, 630 Main St., Springfield",
   "Evening in solidarity with Oregon's farmworkers, hosted by PCUN.", BT + "night-in-solidarity-with-farmworkers-rights/", ["https://www.beyondtoxics.org/events/"], town="Springfield")
for nm, ds in [("West Eugene Clean Energy Project", "Pilot that makes clean energy technologies accessible to residents of West Eugene (formerly the Bethel Clean Energy Project)."),
               ("Fumes in Focus", "Short documentary and study of gas-stove air pollution in homes."),
               ("Gas station moratorium", "Advocacy for a ban on building new gas stations in Eugene to support the city's climate goals.")]:
    proj("or_beyond_toxics", nm, ds, "https://www.beyondtoxics.org/work/climate-justice/building-a-fossil-free-future/", ["https://www.beyondtoxics.org/work/climate-justice/building-a-fossil-free-future/"])

# Central Oregon LandWatch talks
LW = "https://www.centraloregonlandwatch.org/events/2026/10/"
for date, nm, sl, venue, ds in [
    ("2026-10-15", "Arctic to Deschutes", "15/arctic-to-deschutes", "Ray Hall, OSU-Cascades, 1500 SW Chandler Ave, Bend", "Filmmaker and engineer Dr. Len Necefer traces a line from Arctic rivers to Central Oregon's water debates."),
    ("2026-10-24", "Crossings", "24/crossings", "Ray Hall, OSU-Cascades, 1500 SW Chandler Ave, Bend", "National Geographic photographer Morgan Heim on how wildlife migrates through a fragmented landscape."),
    ("2026-10-29", "Best Case Scenario", "29/best-case-scenario", "Embark, 2843 NW Lolo Dr, Bend", "Emma Marris paints a hopeful picture of life in 2070, based on her National Geographic cover story.")]:
    ev("or_landwatch", nm, f"{date}T18:30:00", venue, ds, LW + sl, ["https://www.centraloregonlandwatch.org/events"], end=f"{date}T20:00:00", town="Bend")

# Fossil Free Eugene
act("or_ffe", "Keep hyperscale/AI data centers out of Eugene", "Action alert asking supporters to press the city to keep large AI data centers out of Eugene.", "https://fossilfreeeugene.org/", ["https://fossilfreeeugene.org/"])
act("or_ffe", "Youth Advocacy Intern", "The coalition is recruiting a youth advocacy intern.", "https://fossilfreeeugene.org/", ["https://fossilfreeeugene.org/"], kind="role")
proj("or_ffe", "All-electric Eugene", "Campaign for all-electric new construction, a fund to move low-income households off fracked gas, and 100% renewable city utilities by 2030.", "https://fossilfreeeugene.org/", ["https://fossilfreeeugene.org/"])

# 350 Eugene
proj("or_350_eugene", "Eugene Clean Energy Fund", "Campaign for a fund paid by large corporations to pay for local climate projects, projected at over $15M a year.", "https://www.350eugene.org/", ["https://www.350eugene.org/"])
proj("or_350_eugene", "Forest Defense", "Campaign for climate-safe forest management that protects old-growth and roadless forests.", "https://www.350eugene.org/", ["https://www.350eugene.org/"])

# PCEF coalition / APANO
act("or_pcef", "Sign the Protect PCEF Pledge", "Pledge to defend the Portland Clean Energy Fund against a new ballot measure that would divert its money to police.",
    "https://www.apano.org/blog-posts/sign-the-protect-pcef-pledge", ["https://www.apano.org/blog-posts/sign-the-protect-pcef-pledge"], host="or_apano")

# Verde
for nm, ds, sl in [("Community Solar", "Community solar program bringing renewable energy savings to Portland neighbors.", "solar"),
                   ("Home Heating and Cooling", "Program installing heat pumps for heating and cooling in low-income homes.", "homeheatingcooling"),
                   ("Líderes Verdes", "Leadership program for community members in environmental advocacy.", "lideres-verdes"),
                   ("Urban Habitat", "Habitat restoration and green infrastructure work in Portland neighborhoods.", "urban-habitat")]:
    proj("or_verde", nm, ds, f"https://www.verdenw.org/{sl}", ["https://www.verdenw.org/"])
act("or_verde", "Heat pump interest form", "Sign up to learn whether your home can get a heat pump through Verde's program.",
    "https://8yqdhvf81vh.typeform.com/HeatPumpProgram", ["https://www.verdenw.org/"])

# Community Energy Project
proj("or_cep", "Portland Home Retrofits", "Free home repairs and energy upgrades for low-income Portland households.", "https://www.communityenergyproject.org/", ["https://www.communityenergyproject.org/"])
act("or_cep", "Volunteer with CEP", "Volunteer to help with workshops and home projects.", "https://www.communityenergyproject.org/", ["https://www.communityenergyproject.org/"], kind="role")

# Electrify Oregon
proj("or_electrify_oregon", "Free electrification coaching", "Volunteer coaches help households plan heat pumps, panel upgrades and EVs for free.", "https://www.electrifyoregon.org/", ["https://www.electrifyoregon.org/"])

# Energize Bend
proj("or_energize_bend", "All-electric Bend", "Outreach, education and local policy for building electrification in Bend, including a proposed climate pollution fee.", "https://energizebend.org/climate-pollution-fee", ["https://energizebend.org/"])

# Next Up
act("or_next_up", "Join the Community Action Team", "Young leaders can apply to organize for change in their communities.", "https://nextuporegon.org/", ["https://nextuporegon.org/"], kind="role")
act("or_next_up", "2026 College Campus Organizer", "Part-time, temporary paid campus organizer roles.", "https://nextuporegon.org/", ["https://nextuporegon.org/"], kind="role")

# Breach Collective
proj("or_breach", "Data center accountability", "Advocacy in Portland and Eugene on data center deals, including bans on data center NDAs (September 2026).", "https://www.breachcollective.org/", ["https://www.breachcollective.org/"])
proj("or_breach", "NW Natural biomethane report", "September 2026 report finding that SB 98 biomethane greenwashes fossil gas and fails Oregon's climate goals.", "https://www.breachcollective.org/", ["https://www.breachcollective.org/"], status="completed")

# Climate Jobs Oregon / Ocean Alliance / OJTA
proj("or_cjo", "Union-built clean energy agenda", "Push for faster siting and permitting, new generation, storage and transmission, and union-built green public housing.", SRC_CJO := "https://nwlaborpress.org/2026/02/new-union-coalition-will-make-a-push-for-climate-jobs/", [SRC_CJO])
proj("or_ooa", "Ocean priorities through 2027", "Shared priorities: more funding for ocean conservation, state policy for ocean climate resilience, and building conservation champions.", "https://oregonshores.org/programs-campaigns/the-oregon-ocean-alliance/", ["https://oregonshores.org/programs-campaigns/the-oregon-ocean-alliance/"])
proj("or_ojta", "Energy Justice Leadership Institute", "Leadership program training frontline community members in energy policy advocacy and civic engagement.", "https://www.ojta.org/", ["https://give.communityin.org/profiles/oregon-just-transition-alliance"])
proj("or_ojta", "Transportation Leadership Institute", "Leadership program training frontline community members in transportation policy advocacy.", "https://www.ojta.org/", ["https://give.communityin.org/profiles/oregon-just-transition-alliance"])

# Climate Solutions / OCN lobby day item intentionally omitted (no 2026-27 date posted)

# ---------- finish ----------
EMOJI = re.compile(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]\ufe0f?\s*")
for o in list(owners.values()):
    for e in o["events"]:
        e["name"] = EMOJI.sub("", e["name"]).strip()
        e["id"] = e["id"].replace("__", "_").replace("_e__", "_e_")
        if e["date"].endswith("T00:00:00"):
            e["date"] = e["date"][:10]; e.pop("end", None)
def newest(o):
    ds = [o.get("last_activity") or ""]
    return max(ds)

out = dict(generated_at="2026-10-13T00:00:00Z", state="OR", coalitions=d["coalitions"], organizations=d["orgs"], edges=d["edges"])
out["notes"] = open("NOTES.txt").read().strip()
json.dump(out, open("or.json", "w"), indent=1, ensure_ascii=False)
ne = sum(len(o["events"]) for o in out["organizations"] + out["coalitions"])
np_ = sum(len(o["projects"]) for o in out["organizations"] + out["coalitions"])
na = sum(len(o["actions"]) for o in out["organizations"] + out["coalitions"])
print("events", ne, "projects", np_, "actions", na)
