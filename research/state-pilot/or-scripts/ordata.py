import json
R = "/home/claude/openthink_mycc"
def load(): return json.load(open(f"{R}/research/state-pilot/or.json"))
def save(d):
    json.dump(d, open(f"{R}/research/state-pilot/or.json", "w"), ensure_ascii=False, indent=1)
    json.dump(d, open(f"{R}/public/maps/or.json", "w"), ensure_ascii=False, separators=(",", ":"))
def owners(d): return {o["id"]: o for o in d["organizations"] + d["coalitions"]}
