import importlib.util, sys, requests
sys.path.insert(0, "/home/claude/or")
from pf import allowed
spec = importlib.util.spec_from_file_location("fl", "scripts/fetch-logos.py")
fl = importlib.util.module_from_spec(spec); spec.loader.exec_module(fl)
BUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
class Blocked(Exception): pass
def get(url, **kw):
    if not allowed(url): raise Blocked(url)
    return requests.get(url, headers={"User-Agent": BUA}, timeout=15, allow_redirects=True, **kw)
fl.get = get
sys.argv = ["fetch-logos.py", "public/maps/or.json"]
fl.main()
