"""Step 6: write data-review/2026-11-item-check.csv from Agent 3's work/final.json and the script checks.

script_could_decide = yes when 4_script_checks.py reached the same verdict on its own (no AI): page cap,
moved links, blank websites, events whose exact name and date are on their own page. Everything else = no.
Usage: ITEMCHECK_FINAL=final_v2.json python3 6_build_csv.py   (default: final.json, the first trial pass)
Also prints counts by verdict and script_could_decide by item type (for the response tab).
"""
import collections, csv
from common import *

COLS = ["group_id", "group_name", "item_type", "item_id", "current_name", "verdict", "proposed_name",
        "proposed_description", "proposed_link", "proposed_date", "evidence_url", "evidence_quote",
        "agents_agree", "script_could_decide", "notes"]
ORDER = {"group": 0, "project": 1, "event": 2, "action": 3, "role": 4}


def main():
    rows, checks = load_json(os.environ.get("ITEMCHECK_FINAL", "final.json")), load_json("checks.json")
    sv = {}
    for gid, c in checks.items():
        sv[(gid, gid, "group")] = c["group"]["script_verdict"]
        for it in c["items"]:
            sv[(gid, it["id"], it["item_type"])] = it["script_verdict"]
    group_order = {g: i for i, g in enumerate(TRIAL_IDS)}
    for r in rows:
        s = sv.get((r["group_id"], r.get("item_id", ""), r["item_type"]), "")
        r["script_could_decide"] = "yes" if s and r.get("verdict") == s else "no"
    rows.sort(key=lambda r: (group_order.get(r["group_id"], 99), r.get("verdict") == "add", ORDER.get(r["item_type"], 9), r.get("item_id") or r.get("proposed_name", "")))
    out = ROOT / "data-review" / "2026-11-item-check.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") or "" for k in COLS})
    print(out, len(rows), "rows")
    print("by verdict:", dict(collections.Counter(r.get("verdict") or "(blank: agents disagree)" for r in rows)))
    print("agents_agree:", dict(collections.Counter(r.get("agents_agree") for r in rows)))
    by = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        if r.get("item_id"):  # existing items and groups only (add rows have no item_id)
            by[r["item_type"]][0] += r["script_could_decide"] == "yes"
            by[r["item_type"]][1] += 1
    print("script_could_decide (existing rows):", {k: f"{a}/{b}" for k, (a, b) in by.items()})
    print("verdict by type:", {t: dict(collections.Counter(r.get("verdict") or "blank" for r in rows if r["item_type"] == t)) for t in ORDER})


if __name__ == "__main__":
    main()
