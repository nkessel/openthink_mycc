"""Step 1: pull the trial groups and their items from the sheet's live JSON (read-only).

Falls back to public/data.json (may be weeks old; see generated_at). The live JSON already leaves out
rows with hidden = TRUE. Coalition items are not under organizations, so they are left out here.
Output: work/items.json
"""
import json, sys, urllib.request
from common import *

def main():
    src = LIVE_DATA_URL
    try:
        req = urllib.request.Request(LIVE_DATA_URL, headers={"User-Agent": UA})
        d = json.loads(urllib.request.urlopen(req, timeout=60).read())
    except Exception as e:
        print("live data failed, using public/data.json:", e, file=sys.stderr)
        d, src = json.loads((ROOT / "public" / "data.json").read_text()), "public/data.json"
    orgs = {o["id"]: o for o in d["organizations"]}
    groups = []
    for gid in sys.argv[1:] or TRIAL_IDS:
        o = orgs[gid]
        items = []
        for k, typ in (("projects", "project"), ("events", "event"), ("actions", "action")):
            for it in o.get(k) or []:
                if it.get("host_org_id") and it["host_org_id"] != gid:
                    continue  # belongs elsewhere
                t = typ if typ != "action" else ("role" if it.get("kind") == "role" else "action")
                items.append({"item_type": t, **it})
        groups.append({k: o.get(k) for k in ("id", "name", "website", "description", "abbrev", "type")} | {"items": items})
    save_json("items.json", {"source": src, "generated_at": d.get("generated_at"), "today": TODAY, "groups": groups})
    print(src, d.get("generated_at"), sum(len(g["items"]) for g in groups), "items in", len(groups), "groups")

if __name__ == "__main__":
    main()
