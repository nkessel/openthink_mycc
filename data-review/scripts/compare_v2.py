"""Update pass (Nov 12), Agent 3's step done by script: compare work/agent1_v2.json and work/agent2_v2.json
and merge them into work/final_v2_base.json -> work/final_v2.json.

- Re-checked rows (work/recheck_rows.json): same verdict -> agents_agree yes (keep the row with the more specific
  proposal and quote); different -> verdict blank, agents_agree no, notes "A1: ... / A2: ...".
- part_of: added to a row's notes as "part of: <project>" only when both agents tie it to the same project
  (names compared loosely). One-sided or different answers are listed in work/v2_part_of_disagree.json.
"""
import json
from common import *


def same_project(a, b):
    a, b = norm_text(a).replace("campaign", "").strip(), norm_text(b).replace("campaign", "").strip()
    return bool(a) and bool(b) and (a == b or a in b or b in a)


def main():
    base, recheck = load_json("final_v2_base.json"), load_json("recheck_rows.json")
    a1, a2 = load_json("agent1_v2.json"), load_json("agent2_v2.json")
    r1 = {(r["group_id"], r["item_id"]): r for r in a1["rows"]}
    r2 = {(r["group_id"], r["item_id"]): r for r in a2["rows"]}
    spec = lambda r: len(r.get("proposed_description", "")) + len(r.get("proposed_name", "")) + len(r.get("evidence_quote", ""))
    merged = list(base)
    for old in recheck:
        k = (old["group_id"], old["item_id"])
        x, y = r1.get(k), r2.get(k)
        if not x or not y:
            raise SystemExit(f"missing re-check row {k}: A1 {'ok' if x else 'missing'}, A2 {'ok' if y else 'missing'}")
        if x["verdict"] == y["verdict"]:
            row = dict(x if spec(x) >= spec(y) else y)
            row["agents_agree"] = "yes"
        else:
            row = dict(x)
            row.update(verdict="", agents_agree="no", proposed_name="", proposed_description="", proposed_link="", proposed_date="",
                       notes=f"A1: {x['verdict']} - {x.get('notes', '')} / A2: {y['verdict']} - {y.get('notes', '')}")
        row["notes"] = "re-checked under the 10-page cap; " + row.get("notes", "")
        merged.append(row)
    p1 = {(e["group_id"], e["item_key"]): e for e in a1.get("part_of", [])}
    p2 = {(e["group_id"], e["item_key"]): e for e in a2.get("part_of", [])}
    disagree, added = [], 0
    for k in sorted(set(p1) | set(p2)):
        x, y = p1.get(k), p2.get(k)
        if x and y and same_project(x["project"], y["project"]):
            for r in merged:
                if (r["group_id"], r["item_id"] or r["proposed_name"]) == k:
                    r["notes"] = (r["notes"] + "; " if r.get("notes") else "") + f"part of: {x['project']}"
                    added += 1
        else:
            disagree.append({"key": list(k), "A1": x and x["project"], "A2": y and y["project"]})
    save_json("final_v2.json", merged)
    save_json("v2_part_of_disagree.json", disagree)
    print(f"final_v2.json: {len(merged)} rows; part_of added {added}, not agreed {len(disagree)}")
    for d in disagree:
        print("   part_of not agreed:", d)


if __name__ == "__main__":
    main()
