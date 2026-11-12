"""Step 7 (Nov 12): apply the team's answers (doc subtab "1 LLM Response", Q1-Q6 + Additional inputs) to the
trial's work/final.json, with no new fetching. Run after re-running steps 2 (--cache-only), 3 and 4 with
ITEMCHECK_TODAY set.

Mechanical rules (no AI):
- Q6: past one-off events are left out of the CSV (the map already hides them); counted per group.
- Q2: at most 10 pages per group. Rows whose evidence page is no longer among the saved pages:
  add rows are dropped; rows for existing items go to work/recheck_rows.json for the two agents to re-judge.
  (Items whose own page didn't fit become "couldn't check" in step 4; none did in the trial.)
- Add events dated before today are dropped.
- The answer-specific changes in TEAM_RULES below (each says which answer it comes from).
Output: work/final_v2_base.json (kept rows), work/recheck_rows.json, work/v2_dropped.json
"""
import json
from common import *

# (group_id, item_id or add-row proposed_name) -> changes, with the team answer behind each.
TEAM_RULES = {
    ("neighbor_to_neighbor_massachusetts", "neighbor_to_neighbor_massach_a2"):
        {"verdict": "remove", "note": "team Q4: membership is not a volunteer role; the page gives no meeting schedule"},
    ("350ma_central_mass", "350ma_central_mass_a1"):
        {"note": "team Q4: a 'join us' item; the page gives no meeting schedule, so remove"},
    ("charles_river_watershed_association", "charles_river_watershed_asso_p2"):
        {"note": "team Q4: a named series of several events is a project"},
    ("charles_river_watershed_association", "charles_river_watershed_asso_a4"):
        {"note": "team Q4: a role on a general volunteer page is ok"},
    ("charles_river_watershed_association", "charles_river_watershed_asso_a5"):
        {"note": "team Q4: a role on a general volunteer page is ok"},
    ("boston_latin_school_youthcan", "boston_latin_school_youthcan_p1"):
        {"note": "team Q4: a single event that repeats yearly is a recurring event, not a project"},
    ("boston_latin_school_youthcan", "boston_latin_school_youthcan_p2"):
        {"note": "team Q4: a single event that repeats yearly is a recurring event, not a project"},
    ("sunrise_boston", "sunrise_boston_p1"): {"note": "national campaign (team Q3: keep on the chapter)"},
    ("sunrise_boston", "sunrise_boston_p2"): {"note": "national campaign (team Q3: keep on the chapter)"},
    ("sunrise_boston", "sunrise_boston"):
        {"note": "team Q3: website kept as the national org link; no chapter social handle on the fetched pages"},
    # Q5: a coalition campaign with its own website and its own meetings/events is an org, not a project.
    ("350ma_central_mass", "Fix the Grid"): {
        "item_type": "group", "verdict": "add", "proposed_link": "https://fix-the-grid.org/",
        "proposed_description": "Grassroots campaign in the six Northeast states for a just transition to a democratic, transparent, renewable electric grid.",
        "evidence_url": "https://www.350centralmass.org/", "evidence_quote": "Learn more at fix-the-grid.org",
        "replace_notes": "collaborates with 350ma_central_mass. Team Q5: coalition campaign with its own website "
                         "(named on this page) and its own meetings and summit (from the team's answer; not fetched)"},
    # Q5: list page only when it shows the event's name and date; quote both.
    ("green_energy_consumers_alliance", "Energy Efficient Heating for the Berkshires"): {
        "evidence_quote": "Energy Efficient Heating for the Berkshires … Thursday, November 19 2026, 6:30pm",
        "note": "list page; team Q5: name and date both on it"},
    ("tree_boston", "Tree Planting at the Alma Wright Zen Garden"): {
        "evidence_quote": "November 12, 2026 12:00 pm … Tree Planting at the Alma Wright Zen Garden",
        "note": "list page; team Q5: name and date both on it"},
}


def main():
    final, items, ext = load_json("final.json"), load_json("items.json"), load_json("extracted.json")
    byid = {it["id"]: it for g in items["groups"] for it in g["items"]}
    saved = {norm_url(k).rstrip("/") for g in ext.values() for u, p in g["pages"].items() if p.get("text_file")
             for k in (u, p.get("final_url") or u)}
    keep, recheck, dropped = [], [], []
    for r in final:
        r = dict(r)
        key = (r["group_id"], r["item_id"] or r["proposed_name"])
        it = byid.get(r["item_id"])
        if it and past_one_off(it):
            dropped.append(r | {"why": "past one-off event (team Q6)"}); continue
        if not r["item_id"] and r["item_type"] == "event" and r.get("proposed_date") and r["proposed_date"][:10] < TODAY:
            dropped.append(r | {"why": f"add event already past on {TODAY}"}); continue
        rule = TEAM_RULES.get(key, {})
        for f in ("item_type", "verdict", "proposed_link", "proposed_description", "evidence_url", "evidence_quote"):
            if f in rule:
                r[f] = rule[f]
        if "replace_notes" in rule:
            r["notes"] = rule["replace_notes"]
        if "note" in rule:
            r["notes"] = (r["notes"] + "; " if r["notes"] else "") + rule["note"]
        if norm_url(r.get("evidence_url", "")).rstrip("/") not in saved:
            if not r["item_id"]:
                dropped.append(r | {"why": "evidence page over the 10-page cap (team Q2)"}); continue
            recheck.append(r); continue
        keep.append(r)
    save_json("final_v2_base.json", keep)
    save_json("recheck_rows.json", recheck)
    save_json("v2_dropped.json", dropped)
    print(f"kept {len(keep)}, to re-check {len(recheck)}, dropped {len(dropped)}")
    for d in dropped:
        print("   dropped:", d["group_id"], d["item_id"] or d["proposed_name"], "-", d["why"])
    for r in recheck:
        print("   re-check:", r["group_id"], r["item_id"], r["verdict"] or "(disagreed)")


if __name__ == "__main__":
    main()
