"""Round 2: more projects, actions and events from groups' own program/campaign/volunteer pages (progs.json)
and their Eventbrite listings (ebrite_ev.json). Runs on research/state-pilot/or.json in place."""
import json, re, sys, html
sys.path.insert(0, ".")
from ordata import load, save, owners
from build import coords, GAZ

d = load(); O = owners(d)
P = {}  # url lookup: (oid, path-suffix) -> full url from progs.json
for oid, v in json.load(open("progs.json")).items():
    for x in v: P[(oid, x["url"].split("/", 3)[-1])] = x["url"]

def slug(s): return re.sub(r"[^a-z0-9]+", "_", html.unescape(s).lower()).strip("_")[:40]
def U(oid, path):
    u = P.get((oid, path)) or next((v for (o, p), v in P.items() if o == oid and p.startswith(path)), None)
    assert u, (oid, path)
    return u
def _uniq(lst, i):
    ids = {x["id"] for x in lst}; base = i; k = 2
    while i in ids: i = f"{base}_{k}"; k += 1
    return i
def proj(oid, name, desc, path_or_url, status="active", host=None):
    u = path_or_url if path_or_url.startswith("http") else U(oid, path_or_url)
    o = O[oid]
    if any(p["name"].lower() == name.lower() for p in o["projects"]): return
    p = dict(id=_uniq(o["projects"], f"{oid}_p_{slug(name)}"), name=name, description=desc, status=status, skills_needed=[], link=u, verified=True, sources=[u])
    if host: p["host_org_id"] = host
    o["projects"].append(p)
def act(oid, name, desc, path_or_url, kind="task", deadline=None):
    u = path_or_url if path_or_url.startswith("http") else U(oid, path_or_url)
    o = O[oid]
    if any(a["name"].lower() == name.lower() for a in o["actions"]): return
    o["actions"].append(dict(id=_uniq(o["actions"], f"{oid}_a_{slug(name)}"), kind=kind, name=name, skills_needed=[], deadline=deadline, description=desc, link=u, verified=True, sources=[u]))

# ---- Beyond Toxics
B = "or_beyond_toxics"
proj(B, "Data center moratorium (Eugene)", "Pushes for a pause on siting and building data centers in Eugene until sustainability and equity come first.", "work/climate-justice/data-centers")
proj(B, "West Eugene Community Health", "Works with West Eugene neighbors living next to polluting industry on health impacts and cleaner air.", "work/environmental-justice/west-eugene-community-health")
proj(B, "Justice for Trainsong", "Raises Trainsong neighbors' concerns about a planned industrial project in their neighborhood.", "work/environmental-justice/west-eugene-community-health")
proj(B, "Statewide pesticide policy", "Advocacy to cut farmworker and consumer exposure to risky agricultural chemicals.", "work/pesticides-and-communities/statewide-pesticide-pol")
proj(B, "Golden Gardens", "Campaign to protect Golden Gardens Park, a rare natural area in Bethel threatened by a proposed sports complex.", "work/regenerative-ecosystems/golden-gardens")
proj(B, "Resilient Forestry", "Links forest protection to climate mitigation and presses for reform of forestry practices.", "work/regenerative-ecosystems/resilient-forestry")
proj(B, "Non Toxic Oregon", "Works to protect people, pets and wildlife from toxic pesticides.", "work/regenerative-ecosystems/non-toxic-oregon")
proj(B, "Clean air advocacy", "Two decades of work for health-based air quality rules with equity benchmarks, including wildfire smoke.", "work/air-quality")
proj(B, "Resilience Markets", "Community markets in West Eugene that share local food and resources.", "work/resilience-markets")

# ---- Cascadia Wildlands
C = "or_cascadia_wildlands"
proj(C, "Climate program", "Defends carbon-rich forests and opposes new fossil fuel projects in the Cascadia region.", "programs/climate")
proj(C, "Forests and watersheds", "Protects older forests and the streams that depend on them, in the field and in court.", "programs/forests-and-watersheds")
proj(C, "Wildlife", "Works to protect and recover wolves and other native wildlife.", "programs/wildlife")
act(C, "Take action for Cascadia's forests and wildlife", "Current petitions and comment campaigns.", "get-involved/take-action")
act(C, "Volunteer with Cascadia Wildlands", "Help at events, in the office and with the WildCAT activist team.", "get-involved/volunteer", kind="role")

# ---- Central Oregon LandWatch / DRA / Gorge Friends / GHCC
proj("or_landwatch", "Land use and wildfire resilience", "Planning advocacy for walkable towns, protected rural lands and wildfire-ready communities in Central Oregon.", "priorities")
act("or_landwatch", "Speak up on Central Oregon land use", "Current comment opportunities and hearings on land use, water and wildlife.", "take-action")
proj("or_dra", "Colder, cleaner lower Deschutes", "Water-quality research and advocacy for the lower Deschutes River.", "our-work")
G = "or_gorge_friends"
proj(G, "Friends of the Columbia Gorge Land Trust", "Buys and protects land in the Columbia River Gorge.", "what-we-do/protect-conserve/land-acquisition-trust")
proj(G, "Gorge Towns to Trails", "Building a trail network that connects Gorge towns to trails and to each other.", "what-we-do/protect-conserve/gorge-towns-to-trails-proje")
proj(G, "Gorge Accessibility Project", "Making Gorge trails and outings more accessible to people of all abilities.", "what-we-do/gorge-accessibility-project")
proj(G, "Enforcing protection laws", "Legal and land-use review to uphold the Columbia River Gorge National Scenic Area protections.", "what-we-do/protect-conserve/legal-land-use-review")
proj(G, "Advocacy and policy campaigns", "Campaigns against harmful development and fossil fuel projects in the Gorge.", "what-we-do/protect-conserve/advocacy-campaigns")
act(G, "Volunteer stewardship in the Gorge", "Join planting, invasive-weed removal and trail stewardship days.", "what-we-do/outdoor-engagement/volunteer-stewardship", kind="role")
act(G, "Take action for the Gorge", "Current letters and comment opportunities.", "get-involved/action")
act("or_ghcc", "Volunteer with Greater Hells Canyon Council", "Sign up for volunteer trips, including work on the Blue Mountains Trail.", "volunteer", kind="role")

# ---- Native Fish Society
N = "or_nfs"
proj(N, "River Steward Program", "Volunteer River Stewards advocate for wild fish on their home rivers across the Northwest.", "get-involved/volunteer/river-steward-program")
proj(N, "Rewild the Willamette", "Campaign to recover the Willamette's most imperiled wild fish.", "campaigns/rewild-the-willamette-2023")
proj(N, "Protect Oregon Coast springers", "Campaign for spring Chinook salmon on Oregon coast rivers.", "campaigns/protect-oregon-coast-springers-1")
proj(N, "An all-wild North Umpqua", "Campaign to revive wild steelhead and salmon on the North Umpqua River.", "campaigns/reviving-wild-abundance-an-all-wild-nu-river")
proj(N, "Wild Fish for All Scholarship", "Academic scholarship for BIPOC students in fisheries conservation.", "get-involved/wild-fish-for-all-scholarship")
act(N, "Become a Native Fish Fellow", "Fellowship for activists and leaders taking action for wild fish.", "get-involved/volunteer/fellowship-program", kind="role")
act(N, "Take action for wild fish", "Current conservation campaigns and comment opportunities.", "get-involved/take-action")

# ---- OEC / OLCV / ONDA / Oregon Shores / Oregon Wild
proj("or_oec", "Legislative agenda", "Policy work at the Oregon Legislature on climate, clean energy, water and toxics.", "our-work/policy")
act("or_oec", "Volunteer with OEC", "Community engagement and volunteer opportunities.", "volunteer", kind="role")
act("or_olcv", "Take action with OLCV", "Current petitions and calls to Oregon lawmakers.", "take-action")
proj("or_onda", "High desert stewardship trips", "Volunteer trips that restore streams, improve trails and protect public lands in Oregon's high desert.", "volunteer")
act("or_onda", "Volunteer in the high desert", "Restore streams, fix trails or help from home.", "volunteer", kind="role")
act("or_onda", "Advocate for Oregon's high desert", "Current actions to protect high desert lands and wildlife.", "take-action")
act("or_oregon_shores", "Volunteer on the coast", "CoastWatch and other coastal volunteer roles.", "programs-campaigns/volunteer", kind="role")
for nm, ds in [("CoastWatch", "Volunteers adopt a mile of Oregon coastline and report on its condition."),
               ("Campaign for Oregon's Estuaries", "Protecting and restoring the coast's estuaries."),
               ("Coastal resilience", "Helping coastal communities and habitats adapt to sea-level rise and climate change."),
               ("Oregon Beaches Forever", "Defending public access to and protection of Oregon's beaches.")]:
    proj("or_oregon_shores", nm, ds, "https://oregonshores.org/programs-campaigns/the-oregon-ocean-alliance/")
W = "or_oregon_wild"
proj(W, "Standing up for the Blue Mountains", "Engaging in the Blue Mountains forest plan revision, which will shape the region for decades.", "our-work/defending-forests-public-lands/standing-up-for")
proj(W, "Defending roadless wildlands", "Protecting Oregon's roadless national forest lands.", "our-work/defending-the-wild/defending-roadless-wildland")
proj(W, "Defending forests and public lands", "Campaigns for old-growth forests and public lands across Oregon.", "our-work/defending-forests-public-lands")
proj(W, "Helping wildlife thrive", "Work to protect wolves, salmon and other Oregon wildlife.", "our-work/helping-wildlife-thrive")
act(W, "Protect Oregon's old-growth forests", "Ask Oregon's congressional delegation to protect old-growth forests.", "action/tell-oregons-delegation-protect-our-old-growth-f")
act(W, "Volunteer with Oregon Wild", "Volunteer roles at events, outings and the office.", "get-involved/volunteer", kind="role")

# ---- rivers / transport / coast
act("or_rogue_riverkeeper", "Volunteer with Rogue Riverkeeper", "Help monitor water quality and protect the Rogue River.", "volunteer", kind="role")
S = "or_street_trust"
proj(S, "Legislation and campaigns", "Policy campaigns for safer streets and more investment in walking, biking and transit.", "policy/campaigns")
proj(S, "WeBike Portland", "Program that helps women, trans and gender non-conforming people get comfortable riding bikes.", "programs/webike")
proj(S, "Commuter clinics", "Workshops at workplaces and in communities on biking, walking and transit.", "programs/clinics")
act(S, "Volunteer with The Street Trust", "Help with events, clinics and advocacy.", "volunteer", kind="role")
proj("or_surfrider", "Oregon coast programs", "Water quality testing, beach cleanups and plastic reduction along the Oregon coast.", "programs")
act("or_surfrider", "Get involved with Surfrider Oregon", "Join a local chapter's cleanups, testing or advocacy.", "volunteer", kind="role")
act("or_trk", "Volunteer with Tualatin Riverkeepers", "Plantings, paddles, river cleanups and committee work.", "get-involved/volunteer", kind="role")
act("or_trk", "Take action for the Tualatin River", "Current advocacy alerts for the watershed.", "advocacy/take-action")
proj("or_wsc", "Wild salmon projects", "Projects protecting wild salmon rivers from California to Alaska, including Oregon's coast.", "projects")
act("or_wsc", "Take action for wild salmon", "Current actions to protect salmon rivers.", "take-action")
act("or_willamette_riverkeeper", "Volunteer with Willamette Riverkeeper", "Help with river cleanups, restoration and paddle trips.", "volunteer", kind="role")
proj("or_nyc", "Youth conservation crews", "Paid crews where young people gain job skills while doing conservation work.", "programs")
T = "or_tep"
proj(T, "Native plant nursery", "Grows native plants for river, stream and habitat restoration on the coast.", "programs/habitat-restoration/native-plant-nursery")
proj(T, "Backyard Planting Program", "Free help for landowners to remove invasive brush and plant natives.", "programs/habitat-restoration/backyard-planting-program")
proj(T, "Water quality monitoring", "Monitoring water quality in Tillamook County's rivers and bays.", "programs/water-quality")
proj(T, "Children's Clean Water Festival", "Annual festival for Tillamook County students, running since 2002.", "programs/community-education-engagement/childrens-clean")
act(T, "Volunteer with Tillamook Estuaries Partnership", "Help grow native plants, restore streams and monitor water quality.", "volunteer", kind="role")

# ---- climate groups
act("or_fcc", "Mentor youth climate leaders", "Professionals can volunteer expertise to mentor teens working on climate projects.", "volunteer", kind="role")
R = "or_rogue_climate"
proj(R, "Youth leadership (RCAT and internship)", "Rogue Climate Action Team and paid internships for young people in Southern Oregon.", "our-work/youth-leadership")
proj(R, "Energy justice", "Helps low-income and rural households get efficient, clean and affordable energy.", "our-work/energy-justice")
proj(R, "Resilience hubs", "Community resilience hubs in Southern Oregon.", "our-work/resilience-hubs")
proj(R, "Thriving Coos Bay", "Community-led vision for the Coos Bay area.", "our-work/pcip")
proj(R, "Stopping Jordan Cove LNG", "Years-long campaign that helped defeat the Jordan Cove LNG export terminal and pipeline.", "our-work/fossil-fuels/jordan-cove-lng", status="completed")
act(R, "Volunteer with Rogue Climate", "Join a volunteer team in the Rogue Valley or on the South Coast.", "stay-connected/volunteer", kind="role")
act(R, "Take action with Rogue Climate", "Current climate and energy actions.", "take-action")
proj("or_emo", "Oregon Interfaith Power & Light", "EMO program engaging congregations in climate advocacy, energy savings and community resilience.", "https://emoregon.org/creation-justice/oregon-interfaith-power-light/")
proj("or_cep", "Energy equity advocacy", "Advocacy for energy equity, healthy homes and fair access to heating and cooling.", "advocacy")
P3 = "or_350pdx"
for nm, ds, pa in [("Energy Justice Team", "Volunteer team working on fair, clean energy in Portland.", "campaigns/energy-justice-team"),
                   ("Forest Defense Team", "Volunteer team defending Oregon's forests as a climate solution, including Forest Park.", "campaigns/forest-defense"),
                   ("Milwaukie Advocates for Climate", "Neighborhood climate team in Milwaukie.", "campaigns/milwaukie-team"),
                   ("SW Neighborhood Team", "Neighborhood climate team in Southwest Portland.", "campaigns/sw-neighborhood-team")]:
    proj(P3, nm, ds, pa)
act(P3, "Volunteer with 350PDX", "Join a team or help with events and outreach.", "get-involved/volunteer-now", kind="role")
act(P3, "Take action with 350PDX", "Current climate justice actions.", "action")
act("or_fot", "Plant trees with Friends of Trees", "Volunteer as a tree planter, crew leader, driver or caller; groups welcome.", "volunteer", kind="role")
proj("or_elakha", "Sea otter recovery in Oregon", "Building support and a plan to return sea otters to the Oregon coast, with tribal and conservation partners.", "get-involved/invite-us-to-speak")
act("or_elakha", "Volunteer for sea otters", "Register as a prospective Elakha Alliance volunteer.", "get-involved/volunteer", kind="role")
L = "or_losn"
for nm, ds, pa in [("Electrify LO", "Helping Lake Oswego households switch to efficient electric appliances.", "project/electrify-lo-project"),
                   ("Sustainable landscaping", "Campaign for healthy yard care and a move away from gas-powered landscaping equipment.", "project/sustainable-landscaping"),
                   ("Community solar", "Helping residents join community solar.", "project/community-solar"),
                   ("Multifamily EV charging", "Bringing EV charging to apartments and condominiums.", "project/multifamily-ev-charging-project"),
                   ("Lake Oswego climate action plan", "Team working toward a city climate action plan consistent with state and Metro goals.", "project/climate-change"),
                   ("Schools sustainability team", "Works with Lake Oswego schools on sustainable facilities and curriculum.", "project/education"),
                   ("The Lake Oswego Story Project", "Writing project with the library imagining local responses to climate change.", "project/the-lake-oswego-story-project")]:
    proj(L, nm, ds, pa)
act("or_sage", "Find a volunteer match with SAGE", "Talk with SAGE to match your interests with a nonprofit volunteer role.", "get-involved/get-started-talk-to-us", kind="role")
act("or_solar_oregon", "Volunteer with Solar Oregon", "Help with workshops, events and outreach.", "get-involved/become-a-volunteer", kind="role")
proj("or_gei", "Clean energy policy recommendations", "Legal and policy recommendations for a fair transition to a carbon-free grid.", "centers/green_energy_institute/projects")
proj("or_afro_village", "AfroVillage programs", "Programs including AfroFuturism events and community WiFi.", "programs")
act("or_apano", "Volunteer with APANO", "Support organizing, events and community programs.", "get-involved/volunteer", kind="role")
act("or_our_childrens_trust", "Support youth climate cases", "Join the community backing young people's climate lawsuits.", "act")
proj("or_zero", "Zero energy buildings in Oregon", "Showcase of zero energy homes and commercial buildings around the state.", "projects")
act("or_energize_bend", "Get involved with Energize Bend", "Join the coalition's outreach for building electrification in Bend.", "get-involved", kind="role")

# ---- Columbia Riverkeeper: real campaign pages
RK = "or_columbia_riverkeeper"
O[RK]["projects"] = []
for nm, ds, pa in [("No Underwater Power Line", "Campaign to stop a proposed transmission cable under the Columbia River from The Dalles to Portland.", "campaigns/no-underwater-power-line"),
                   ("Stand Up to Data Centers", "Campaign on the water and energy demands of data center expansion along the Columbia.", "campaigns/data-center-expansion"),
                   ("NEXT Energy Refinery", "Opposes a proposed diesel refinery that would be one of Oregon's largest greenhouse gas emitters.", "campaigns/nxt-energy-refinery"),
                   ("Protect Pushpum", "Supports tribal opposition to the Goldendale pumped storage project at Pushpum (Rock Creek).", "campaigns/protect-pushpum-goldendale-pumped-storage"),
                   ("Cold Water for Salmon", "Uses the Clean Water Act to push the Army Corps to cut heat pollution from dams.", "campaigns/restore-cold-water"),
                   ("Snake River dam removal", "Campaign to restore salmon by removing the four Lower Snake River dams.", "campaigns/snake-river-dam-removal"),
                   ("Small modular nuclear reactors", "Questions claims that small modular reactors are a climate solution.", "campaigns/small-modular-nuclear-reactors"),
                   ("Williams' pipe dreams", "Opposes new gas pipeline expansions in the region.", "campaigns/williams-pipeline"),
                   ("Bonneville Dam cleanup", "Pushing for cleanup of toxic pollution at Bonneville Dam.", "campaigns/bonneville-dam-cleanup"),
                   ("Swim Guide", "Water quality monitoring so people know where it is safe to swim in the Columbia.", "campaigns/water-quality-monitoring"),
                   ("Columbia Gorge youth education", "Students and families restore a former industrial site as an outdoor classroom.", "campaigns/columbia-gorge-youth-education"),
                   ("Harmful algal blooms", "Tracking and raising awareness of toxic algal blooms in the Columbia.", "campaigns/harmful-algal-blooms")]:
    proj(RK, nm, ds, pa)
act(RK, "Sign the Snake River petition", "Petition to restore salmon by removing the Lower Snake River dams.", "campaigns/snake-river-dam-removal")

# ---- Eventbrite events for groups already on the map (organizer = the group)
EB = {"Community Energy Project": "or_cep", "Citizens Climate Lobby - Bend OR chapter": "or_ccl_bend"}
for r in json.load(open("ebrite_ev.json")):
    if not r["org"] or r["org"][0] not in EB: continue
    oid = EB[r["org"][0]]; e = r["ev"]; o = O[oid]
    town = None
    m = re.search(r",\s*([A-Za-z .]+),\s*(?:OR|Oregon)", e.get("address") or "")
    if m and m.group(1).strip() in GAZ: town = m.group(1).strip()
    ev = dict(id=_uniq(o["events"], f"{oid}_e_{slug(e['name'])}"), name=e["name"].strip(), date=e["start"][:19], location=", ".join(x for x in [e.get("venue"), e.get("address")] if x) or "Details on the event page",
              description=re.sub(r"\s+", " ", e["desc"])[:220], link=e["url"], online=bool(e["online"]), verified=True, sources=[e["url"]])
    if e.get("end"): ev["end"] = e["end"][:19]
    if town and not e["online"]: ev["lat"], ev["lng"] = coords(town)
    if not any(x["name"] == ev["name"] and x["date"] == ev["date"] for x in o["events"]): o["events"].append(ev)

# ZERO December meeting: venue now posted on Eventbrite
for e in O["or_zero"]["events"]:
    if e["date"].startswith("2026-12-08"):
        e["location"] = "PAE, 151 SW 1st Ave, Suite 300, Portland"; e["lat"], e["lng"] = coords("Portland")
        e["rsvp_link"] = next(r["url"] for r in json.load(open("ebrite_ev.json")) if r["org"] and r["org"][0] == "ZERO Coalition")
        e["sources"].append(e["rsvp_link"])

save(d)
allo = d["organizations"] + d["coalitions"]
print("events", sum(len(o["events"]) for o in allo), "projects", sum(len(o["projects"]) for o in allo), "actions", sum(len(o["actions"]) for o in allo))
