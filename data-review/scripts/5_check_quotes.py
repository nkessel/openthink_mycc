"""Step 5 (guard against made-up evidence): every row's evidence_quote must appear word for word in the
saved text of its evidence_url (work/text/), be under 15 words, and the evidence_url must be a page that was
actually fetched. Also checks verdict values and the 5-adds-per-group limit.

Usage: python3 5_check_quotes.py work/agent1.json   (a JSON list of rows, CSV column names as keys)
Prints one line per problem; exit code 1 if any.
"""
import json, re, sys, unicodedata
from common import *

VERDICTS = {"ok", "fix", "move", "remove", "add", "couldn't check", ""}


def flat(s):
    s = unicodedata.normalize("NFKC", s or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "-").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def texts():
    ext = load_json("extracted.json")
    idx = {}
    for g in ext.values():
        for u, p in g["pages"].items():
            if p.get("text_file"):
                t = flat((WORK / p["text_file"]).read_text().split("\n\n", 1)[-1])
                for k in (u, p.get("final_url") or u):
                    idx[norm_url(k).rstrip("/")] = t
    return idx


def check(rows):
    idx, problems, adds = texts(), [], {}
    for i, r in enumerate(rows):
        tag = f"row {i} {r.get('group_id')} {r.get('item_id') or r.get('proposed_name')}"
        v = r.get("verdict", "")
        if v not in VERDICTS:
            problems.append(f"{tag}: bad verdict {v!r}")
        if v == "add":
            adds[r["group_id"]] = adds.get(r["group_id"], 0) + 1
        q, u = r.get("evidence_quote", ""), r.get("evidence_url", "")
        if not u:
            problems.append(f"{tag}: no evidence_url"); continue
        t = idx.get(norm_url(u).rstrip("/"))
        if t is None:
            if v != "couldn't check":
                problems.append(f"{tag}: evidence_url was not fetched: {u}")
            continue
        if q and len(q.split()) >= 15:
            problems.append(f"{tag}: quote has {len(q.split())} words (limit: under 15)")
        if q and flat(q).strip(" .\"'…") not in t:
            problems.append(f"{tag}: quote not found on page: {q!r}")
        if not q and v != "couldn't check":
            problems.append(f"{tag}: no quote")
    for g, n in adds.items():
        if n > 5:
            problems.append(f"{g}: {n} add rows (limit 5)")
    return problems


if __name__ == "__main__":
    rows = json.loads(open(sys.argv[1]).read())
    p = check(rows)
    print("\n".join(p) if p else f"OK: {len(rows)} rows, all quotes found on their pages")
    sys.exit(1 if p else 0)
