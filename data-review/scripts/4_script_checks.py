"""Step 4: checks a plain script can settle with no AI, per item and per group.

Per item: link status (broken / moved), page empty because it loads with JavaScript, the item's exact
name on its page, the event's date on its page, past events (date or end before today, no recurrence),
and for recurring events the next dated occurrence found on the site.
Per group: website blank, description empty, website host vs the host most item links use.
A "script_verdict" is set only for clear-cut cases: past event -> remove; link moved -> fix (new link);
event with its exact name and date on its own page, upcoming -> ok; website blank -> fix.
Output: work/checks.json
"""
import datetime as dt, re
from common import *

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"]


def page_text(url):
    return trimmed_text(url) if raw(url) else ""


def date_forms(iso):
    d = dt.date.fromisoformat(iso[:10])
    m = MONTHS[d.month - 1]
    return [iso[:10], f"{m} {d.day}, {d.year}", f"{m} {d.day} {d.year}", f"{m} {d.day}", f"{m[:3]} {d.day}"]


def sim(a, b):
    a, b = set(norm_text(a).split()), set(norm_text(b).split())
    return len(a & b) / max(1, len(a | b))


def main():
    items, pages, ext = load_json("items.json"), load_json("pages.json"), load_json("extracted.json")
    out = {}
    for g in items["groups"]:
        gid = g["id"]
        meta = {p["url"]: p for p in pages[gid]["pages"]}
        found = ext[gid]["found"]
        grow = {"website": g.get("website") or "", "site_used": pages[gid]["site"], "site_source": pages[gid]["site_source"],
                "description_empty": not (g.get("description") or "").strip(), "flags": [], "script_verdict": ""}
        if not g.get("website"):
            grow["flags"].append("website blank")
            if pages[gid]["site"]:
                grow["script_verdict"] = "fix"
                grow["proposed_link"] = pages[gid]["site"]
        elif host(g["website"]) != host(pages[gid]["site"]):
            grow["flags"].append("website host differs from site used")
        if grow["description_empty"]:
            grow["flags"].append("description empty")
        rows = []
        for it in g["items"]:
            r = {"id": it["id"], "item_type": it["item_type"], "name": it["name"], "flags": [], "script_verdict": "",
                 "needs_info": bool(it.get("needs_info")), "verified": bool(it.get("verified"))}
            link = it.get("link") or ""
            m = meta.get(link, {})
            r["link_status"] = m.get("status")
            r["final_url"] = m.get("final_url", "")
            text = page_text(link) if m.get("status") == 200 else ""
            r["text_chars"] = len(text)
            if not link:
                r["flags"].append("no link")
            elif m.get("status") != 200:
                r["flags"].append(f"broken link ({m.get('status') or m.get('error')})")
            elif norm_url(m["final_url"]).rstrip("/") != norm_url(link).rstrip("/"):
                r["flags"].append("link moved")
                r["script_verdict"], r["proposed_link"] = "fix", m["final_url"]
            if m.get("status") == 200 and len(text) < 200:
                r["flags"].append("page nearly empty (loads with JavaScript?)")
            nt = norm_text(text)
            r["name_on_page"] = bool(nt) and norm_text(it["name"]) in nt
            if not r["name_on_page"] and nt:
                r["best_heading_match"] = max(ext[gid]["pages"].get(link, {}).get("headings", []) or [""], key=lambda h: sim(h, it["name"]))
            if it["item_type"] == "event":
                rsvp = it.get("rsvp_link") or ""
                if rsvp:
                    rm = meta.get(rsvp, {})
                    r["rsvp_status"] = rm.get("status")
                    if rm.get("status") != 200:
                        r["flags"].append(f"rsvp link broken ({rm.get('status') or rm.get('error')})")
                date, end, rec = it.get("date") or "", it.get("end") or "", (it.get("recurrence") or "").strip()
                r["date"], r["end"], r["recurrence"] = date, end, rec
                last = (end or date)[:10]
                low = text.lower()
                r["date_on_page"] = bool(date) and any(f in low for f in date_forms(date)) or any(
                    f.get("found_on") == link and (f.get("date") or "")[:10] == date[:10] for f in found)
                if rec:
                    nxt = sorted({f["date"][:16] for f in found if f["type"] == "event" and (f.get("date") or "")[:10] >= TODAY
                                  and sim(f["name"], it["name"]) >= 0.4})
                    r["next_occurrences_found"] = nxt[:3]
                    if last and last < TODAY:
                        # not an error by itself: the site rolls recurring dates forward (src/recurrence.ts)
                        r["flags"].append("recurring; stored date is past (the map rolls it forward)" + ("" if nxt else "; no later date found on site"))
                elif last and last < TODAY:
                    r["flags"].append("past event")
                    r["script_verdict"] = "remove"
                elif r["name_on_page"] and r["date_on_page"] and m.get("status") == 200:
                    r["script_verdict"] = r["script_verdict"] or "ok"
            rows.append(r)
        out[gid] = {"group": grow, "items": rows}
        print(gid, "| group:", grow["flags"], "|", sum(bool(r["script_verdict"]) for r in rows), "/", len(rows), "items script-settled")
        for r in rows:
            if r["flags"] or r["script_verdict"]:
                print("    ", r["id"], r["script_verdict"] or "-", r["flags"])
    save_json("checks.json", out)

if __name__ == "__main__":
    main()
