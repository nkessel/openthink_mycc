"""Polite fetch: obeys robots.txt (ClaudeBot / Claude-User / *), returns page text.
Usage: python3 pf.py URL [URL...] [--links] [--max N]
"""
import sys, re, urllib.robotparser
from urllib.parse import urlparse, urljoin
import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; map research; github.com/nkessel/openthink_mycc)"
_robots = {}


def allowed(url):
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = requests.get(base + "/robots.txt", headers={"User-Agent": UA}, timeout=12)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except Exception:
            rp.parse([])
        _robots[base] = rp
    rp = _robots[base]
    return all(rp.can_fetch(a, url) for a in ("ClaudeBot", "Claude-User", "anthropic-ai", "*"))


def fetch(url, links=False, maxc=6000):
    if not allowed(url):
        return f"[ROBOTS DISALLOWED] {url}"
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    except Exception as e:
        return f"[ERR {type(e).__name__}] {url}"
    if r.status_code != 200:
        return f"[HTTP {r.status_code}] {url}"
    s = BeautifulSoup(r.text, "html.parser")
    title = s.title.get_text(strip=True) if s.title else ""
    for t in s(["script", "style", "noscript", "svg"]):
        t.decompose()
    txt = re.sub(r"\s+", " ", s.get_text(" ", strip=True))
    out = f"== {r.url}\nTITLE: {title}\n{txt[:maxc]}"
    if links:
        ls = []
        for a in s.find_all("a", href=True):
            h = urljoin(r.url, a["href"])
            t = a.get_text(" ", strip=True)[:60]
            if h.startswith("http"):
                ls.append(f"{t} -> {h}")
        out += "\nLINKS:\n" + "\n".join(dict.fromkeys(ls))
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    links = "--links" in args
    maxc = 6000
    if "--max" in args:
        maxc = int(args[args.index("--max") + 1])
    urls = [a for a in args if a.startswith("http")]
    for u in urls:
        print(fetch(u, links, maxc))
        print()
