"""Shared helpers for the item check (data-review/scripts/).

Read-only: these scripts only read the map's public data and the groups' public web pages.
Needs: Python 3.10+, beautifulsoup4, lxml  (pip install beautifulsoup4 lxml)
"""
import hashlib, json, os, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # repo root
WORK = Path(os.environ.get("ITEMCHECK_WORK", ROOT / "data-review" / "work"))
CACHE = WORK / "cache"                               # raw HTML + trimmed text (not committed)
TODAY = os.environ.get("ITEMCHECK_TODAY", time.strftime("%Y-%m-%d"))

LIVE_DATA_URL = ("https://script.google.com/macros/s/AKfycbwj2109KXf2Ndv-0ZCHp0a6MH3aVSejxkqofBOfOFHRSvMi61DXj"
                 "keIe25OlsHNbs5S/exec")  # same as src/data.config.ts

TRIAL_IDS = [
    "350ma_central_mass", "charles_river_watershed_association", "green_energy_consumers_alliance",
    "climate_action_now_western_ma", "ma_senior_action", "neighbor_to_neighbor_massachusetts",
    "tree_boston", "sunrise_boston", "boston_latin_school_youthcan",
]

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 mycc-item-check"
SOCIAL = ("facebook.com", "instagram.com", "twitter.com", "x.com", "linktr.ee", "tiktok.com")
EVENT_HOSTS = ("actionnetwork.org", "mobilize.us", "eventbrite.com", "zoom.us", "everyaction.com", "lu.ma", "meetup.com")


def key(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def norm_url(u):
    if not u:
        return ""
    p = urllib.parse.urlsplit(u.strip())
    path = p.path or "/"
    return urllib.parse.urlunsplit((p.scheme.lower() or "https", p.netloc.lower(), path, p.query, ""))


def host(u):
    h = urllib.parse.urlsplit(u).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def norm_text(s):
    s = (s or "").lower().replace("&", "and")
    s = re.sub(r"[‘’']", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def fetch(url, timeout=30):
    """GET with cache. Returns dict(url, final_url, status, ctype, html_path, error)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    meta_p = CACHE / f"{key(url)}.json"
    if meta_p.exists():
        return json.loads(meta_p.read_text())
    meta = {"url": url, "final_url": url, "status": None, "ctype": "", "error": "", "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml,*/*"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            meta.update(final_url=r.geturl(), status=r.status, ctype=r.headers.get("Content-Type", ""))
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        meta.update(status=e.code, error=f"HTTP {e.code}")
    except Exception as e:  # DNS, TLS, timeout
        body = b""
        meta.update(error=f"{type(e).__name__}: {e}")
    (CACHE / f"{key(url)}.raw").write_bytes(body)
    meta["bytes"] = len(body)
    meta_p.write_text(json.dumps(meta, indent=1))
    time.sleep(0.5)  # be polite
    return meta


def raw(url):
    p = CACHE / f"{key(url)}.raw"
    return p.read_bytes() if p.exists() else b""


def soup(url):
    from bs4 import BeautifulSoup
    return BeautifulSoup(raw(url), "lxml")


def trimmed_text(url):
    """Page text without scripts, styles, nav, header, footer (what a reader sees in the main area)."""
    s = soup(url)
    for t in s(["script", "style", "noscript", "svg", "nav", "header", "footer", "form", "iframe"]):
        t.decompose()
    text = s.get_text("\n")
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.splitlines()]
    return "\n".join(l for l in lines if l)


def load_json(name):
    return json.loads((WORK / name).read_text())


def save_json(name, obj):
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False))
