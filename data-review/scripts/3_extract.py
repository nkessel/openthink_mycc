"""Step 3: pull projects/campaigns, events, actions and volunteer roles out of the saved pages, with links
and dates, using each site's structure (no AI). Also saves every page's trimmed text to work/text/ so the
checking agents read the same copy (and can grep it) instead of re-fetching.

What it reads, by site layout:
- schema.org JSON-LD Event blocks (WordPress "The Events Calendar": climateactionnowma.org; Squarespace
  event pages: crwa.org)
- Squarespace event lists (article.eventlist-event: crwa.org/events)
- Mobilize event pages (their public API: name, timeslots, sponsor)
- Listing links whose address looks like an event, campaign/program or volunteer page, with the date
  written next to them (greenenergyconsumers.org/events, treeboston.org/events/, n2nma.org/what-we-do/campaigns/,
  sunrisemovement.org/campaigns/)
- Each page's title, h1-h3 headings and the dates written on it
Output: work/extracted.json, work/text/*.txt
"""
import datetime as dt, json, re, urllib.parse
from common import *

MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
DATE_RE = re.compile(rf"\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?({MONTHS})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?", re.I)
EVENT_HREF = re.compile(r"(/events?/(?!month|list|category|tag|page|feed|$)[^?#]+|mobilize\.us/[^/]+/event/\d+|actionnetwork\.org/events/|eventbrite\.com/e/)", re.I)
PROJECT_HREF = re.compile(r"/(campaigns?|our-campaigns|programs?|projects?|initiatives?|working-groups?)/[^/?#]+", re.I)
ROLE_WORDS = re.compile(r"\b(volunteer|become an?|join (our|the)|sign up|monitor|ambassador|petition|take action|write (a|your)|call your|testify|submit (a )?(public )?comment)\b", re.I)
PROJECT_WORDS = re.compile(r"\b(campaign|working group|project|program|initiative|coalition|committee|team)\b", re.I)


def parse_date(m, default_year):
    mon = MONTHS.split("|").index(m.group(1).lower()) + 1
    y = int(m.group(3)) if m.group(3) else default_year
    try:
        return dt.date(y, mon, int(m.group(2))).isoformat()
    except ValueError:
        return ""


def jsonld_events(url):
    out = []
    r = raw(url).decode("utf-8", "replace")
    for b in re.findall(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", r, re.S):
        try:
            data = json.loads(b)
        except Exception:
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            o = stack.pop()
            if isinstance(o, list):
                stack += o; continue
            if not isinstance(o, dict):
                continue
            if "@graph" in o:
                stack += o["@graph"]
            if o.get("@type") == "Event" or (isinstance(o.get("@type"), list) and "Event" in o["@type"]):
                out.append({"type": "event", "name": re.sub(r"\s+", " ", str(o.get("name", ""))).strip(),
                            "date": str(o.get("startDate", "")), "end": str(o.get("endDate", "")),
                            "url": o.get("url") or url, "how": "json-ld", "found_on": url})
    return out


def squarespace_events(url):
    out = []
    for a in soup(url).select("article.eventlist-event"):
        t = a.select_one(".eventlist-title")
        link = a.select_one("a[href]")
        times = [x.get("datetime") for x in a.select("time[datetime]")]
        clock = [x.get_text(strip=True) for x in a.select("time.event-time-localized-start, time.event-time-12hr-start")]
        out.append({"type": "event", "name": t.get_text(" ", strip=True) if t else "",
                    "url": urllib.parse.urljoin(url, link["href"]) if link else url,
                    "date": times[0] if times else "", "end": times[-1] if times else "",
                    "time": clock[0] if clock else "", "how": "squarespace eventlist", "found_on": url,
                    "past": "eventlist-event--past" in " ".join(a.get("class", []))})
    return out


def mobilize_event(url):
    """Mobilize pages load their dates with JavaScript; the same event is in Mobilize's public API."""
    m = re.search(r"mobilize\.us/[^/]+/event/(\d+)", url)
    if not m:
        return []
    api = f"https://api.mobilize.us/v1/events/{m.group(1)}"
    if fetch(api).get("status") != 200:
        return []
    d = json.loads(raw(api))["data"]
    loc = d.get("location") or {}
    tz = dt.timezone(dt.timedelta(hours=-4 if d["timeslots"] and 3 <= dt.datetime.fromtimestamp(d["timeslots"][0]["start_date"]).month <= 10 else -5))
    iso = lambda s: dt.datetime.fromtimestamp(s, tz).strftime("%Y-%m-%dT%H:%M")
    return [{"type": "event", "name": d["title"], "date": iso(t["start_date"]), "end": iso(t["end_date"]), "url": url,
             "location": loc.get("locality", ""), "sponsor": (d.get("sponsor") or {}).get("name", ""),
             "how": f"mobilize public API ({api}); local time, DST approximated by month", "found_on": url}
            for t in d["timeslots"][:10]]


def listing_links(url, site_host, year):
    """Anchors that look like event / project / role pages, with a date from the surrounding block."""
    out, seen = [], set()
    s = soup(url)
    for t in s(["script", "style", "nav", "header", "footer"]):
        t.decompose()
    for a in s.find_all("a", href=True):
        href = urllib.parse.urljoin(url, a["href"]).split("#")[0]
        text = re.sub(r"\s+", " ", a.get_text(" ")).strip()
        if not text or text.lower() in ("learn more", "read more", "view event details", "more info", "details", "register"):
            # use the heading of the block it sits in
            blk = a.find_parent(["article", "li", "div"])
            h = blk.find(["h1", "h2", "h3", "h4"]) if blk else None
            text = h.get_text(" ", strip=True) if h else text
        if not text or (href, text) in seen:
            continue
        typ = ("event" if EVENT_HREF.search(href) else "project" if PROJECT_HREF.search(href)
               else "role/action" if ROLE_WORDS.search(text) else "")
        if not typ or href.rstrip("/") == url.rstrip("/"):
            continue
        seen.add((href, text))
        blk = a.find_parent(["article", "li"]) or a.parent.parent
        ctx = re.sub(r"\s+", " ", blk.get_text(" ")) if blk else ""
        m = DATE_RE.search(ctx[:400]) if typ == "event" else None
        out.append({"type": typ, "name": text[:140], "url": href, "date": parse_date(m, year) if m else "",
                    "date_text": m.group(0) if m else "", "how": "listing link", "found_on": url,
                    "external": host(href) != site_host})
    return out


def page_summary(url):
    s = soup(url)
    title = s.title.get_text(" ", strip=True) if s.title else ""
    for t in s(["script", "style", "nav", "header", "footer"]):
        t.decompose()
    heads = [re.sub(r"\s+", " ", h.get_text(" ")).strip() for h in s.find_all(["h1", "h2", "h3"])]
    text = trimmed_text(url)
    dates = sorted({parse_date(m, int(TODAY[:4])) for m in DATE_RE.finditer(text) if m.group(3)} - {""})
    return {"title": title, "headings": [h for h in heads if h][:40], "dates_with_year": dates[:30],
            "text_chars": len(text)}


EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b")


def redact(text):
    """The repo is public: keep emails and phone numbers out of the saved page text."""
    return PHONE.sub("[phone]", EMAIL.sub("[email]", text))


def text_file(url):
    p = urllib.parse.urlsplit(url)
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", (host(url) + p.path + ("_" + p.query if p.query else "")).strip("_"))[:120]
    return f"{slug}.txt"


def main():
    pages = load_json("pages.json")
    import shutil
    shutil.rmtree(WORK / "text", ignore_errors=True)  # only pages fetched in this run (under the cap)
    (WORK / "text").mkdir(parents=True, exist_ok=True)
    year = int(TODAY[:4])
    out = {}
    for gid, rec in pages.items():
        found, summaries = [], {}
        site_host = host(rec["site"]) if rec["site"] else ""
        for p in rec["pages"]:
            u = p["url"]
            if p.get("status") != 200:
                summaries[u] = {"status": p.get("status"), "error": p.get("error")}
                continue
            tf = text_file(u)
            (WORK / "text" / tf).write_text(f"URL: {u}\nFINAL URL: {p['final_url']}\nFETCHED: {p['fetched_at']}\n\n" + redact(trimmed_text(u)))
            summaries[u] = page_summary(u) | {"text_file": f"text/{tf}", "final_url": p["final_url"], "builder": p.get("builder", "")}
            found += jsonld_events(u)
            found += squarespace_events(u)
            if "mobilize.us" in u:
                found += mobilize_event(u)
            found += listing_links(u, site_host, year)
        # de-duplicate by (type, url, name)
        uniq, seen = [], set()
        for f in found:
            k = (f["type"], norm_url(f["url"]), norm_text(f["name"]), f.get("date", "")[:10])
            if k not in seen:
                seen.add(k); uniq.append(f)
        out[gid] = {"site": rec["site"], "pages": summaries, "found": uniq}
        c = {t: sum(f["type"] == t for f in uniq) for t in ("event", "project", "role/action")}
        print(gid, c)
    save_json("extracted.json", out)

if __name__ == "__main__":
    main()
