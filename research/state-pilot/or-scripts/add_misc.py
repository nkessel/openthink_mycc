import sys; sys.path.insert(0, ".")
from ordata import load, save, owners
from build import coords
from orutil import slug, _uniq
d = load(); O = owners(d)
Y = "https://350pdx.org/youth/"
if "or_pycc" not in O:
    la, ln = coords("Portland")
    o = dict(id="or_pycc", name="Portland Youth Climate Council", abbrev="PYCC", type="youth_org", geographic_focus="Portland", coalition_ids=[],
             description="Youth-run group of Portland Public Schools students pushing for climate justice in the school curriculum and stronger city tree rules.",
             lat=la, lng=ln, last_activity="", website="https://pdxclimatecouncil.wixsite.com/youth", topic_tags=["youth", "climate education", "trees"],
             profile={"geo_precision": "approx", "youth_serving": True}, projects=[], events=[], actions=[], sources=[Y])
    o["events"].append(dict(id="or_pycc_e_weekly_meeting", name="Portland Youth Climate Council weekly meeting", date="2026-10-19T19:00:00", end="2026-10-19T20:30:00",
        recurrence="Every Monday, 7:00-8:30 PM", location="Portland City Hall, 1221 SW 4th Ave, Portland", description="Weekly meeting of the student-run council; new members welcome.",
        link=Y, online=False, verified=False, sources=[Y], lat=la, lng=ln))
    d["organizations"].append(o); O["or_pycc"] = o
def proj(oid, name, desc, link, src=None):
    o = O[oid]
    if any(p["name"] == name for p in o["projects"]): return
    o["projects"].append(dict(id=_uniq(o["projects"], f"{oid}_p_{slug(name)}"), name=name, description=desc, status="active", skills_needed=[], link=link, verified=True, sources=[src or link]))
proj("or_opal", "Youth Environmental Justice Alliance (YEJA)", "Leadership program training low-income youth and youth of color in political education and environmental justice organizing.", "https://www.opalpdx.org/yeja/", Y)
proj("or_350pdx", "2026 Climate Justice Voter Guide", "Guide to candidates and measures on the 2026 ballot from a climate justice view.", "https://350pdx.org/2026-climate-justice-voter-guide/")
proj("or_350pdx", "2026 Climate Justice Platform", "Policy platform setting out 350PDX's climate justice priorities for 2026.", "https://350pdx.org/2026-climate-justice-platform/")
# profile flags
YOUTH = ["or_sunrise_pdx", "or_sunrise_reed", "or_fcc", "or_nyc", "or_aya", "or_next_up", "or_our_childrens_trust", "or_dycc", "or_uo_cjl", "or_ccl_uo", "or_pss", "or_oece", "or_oceh", "or_pycc"]
for i in YOUTH: O[i].setdefault("profile", {})["youth_serving"] = True
for i in ["or_sunrise_reed", "or_uo_cjl", "or_ccl_uo"]: O[i]["profile"]["school_club"] = True
O["or_olcv"]["profile"]["hub"] = True
# (1-4 scores like ej_focus are judgments the sources don't state, so they are left out)
save(d); print(len(d["organizations"]))
