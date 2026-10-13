import re, html
def slug(s): return re.sub(r"[^a-z0-9]+", "_", html.unescape(s).lower()).strip("_")[:40]
def _uniq(lst, i):
    ids = {x["id"] for x in lst}; base = i; k = 2
    while i in ids: i = f"{base}_{k}"; k += 1
    return i
