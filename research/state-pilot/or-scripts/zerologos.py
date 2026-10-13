import requests,io,os,sys,json
sys.path.insert(0,'.')
from bs4 import BeautifulSoup
from PIL import Image
from pf import allowed
BUA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
os.makedirs('sharedlogos',exist_ok=True)
MAP={ # partner page link -> our id
 "https://nwenergy.org/":"or_nwec","https://newbuildings.org/":"or_nbi","https://www.climatesolutions.org/":"or_climate_solutions",
 "https://www.olcv.org/":"or_olcv","https://envirocenter.org/":"or_envirocenter","https://www.orssia.org/":"or_ossia","https://350deschutes.org/":"or_350_deschutes",
 "https://www.phnw.org/":"or_phnw","https://www.bluegreenalliance.org/":"or_bga","https://orbizclimate.org/":"or_ob4c","https://www.greshamoregon.gov/about-gresham/":"or_gresham",
 "https://latinobuilt.org/":"or_latino_built","https://www.multco.us/sustainability":"or_multco_sustainability","https://www.sierraclub.org/oregon":"or_sierra_club",
 "https://www.oregon.gov/deq/mm/production/Pages/Built-Environment.aspx":"or_deq","https://www.elevatenp.org/":"or_elevate","https://www.bendoregon.gov/":"or_bend",
 "https://cityofhoodriver.gov/":"or_hood_river","https://www.ci.oswego.or.us/":"or_lake_oswego","https://www.electrifyoregon.org/":"or_electrify_oregon",
 "https://www.350eugene.org/":"or_350_eugene","https://fossilfreeeugene.org/":"or_ffe","https://www.afrovillagepdx.org/":"or_afro_village","https://energizebend.org/":"or_energize_bend",
 "https://oregontradeswomen.org/":"or_oti","https://thirdact.org/oregon/":"or_third_act_oregon","https://www.tigard-or.gov/home":"or_tigard","https://electrifynow.net/":"or_electrify_now",
 "https://solaroregon.org/":"or_solar_oregon","https://losn.org/":"or_losn","https://www.olcv.org/metro-climate-action-team/":"or_olcv_mcat","https://www.earthadvantage.org/":"or_earth_advantage",
 "https://centralcityconcern.org/":"or_central_city_concern","https://www.ashland.or.us/":"or_ashland","https://law.lclark.edu/centers/green_energy_institute/":"or_gei",
 "https://neea.org/":"or_neea","https://www.communityenergyproject.org/":"or_cep","https://rootedhomes.org/":"or_rooted_homes","https://www.portland.gov/bps":"or_portland_bps","https://www.milwaukieoregon.gov/":"or_milwaukie",
 # Energize Bend partners
 "https://www.sierraclub.org/oregon/juniper/about":"or_sierra_juniper","https://www.breachcollective.org/":"or_breach","https://citizensclimatelobby.org/chapters/OR_Bend/":"or_ccl_bend",
}
rep={}
for page in ["https://www.zerocoalitionoregon.org/zerocoalitionmembership","https://energizebend.org/"]:
    assert allowed(page)
    s=BeautifulSoup(requests.get(page,headers={"User-Agent":BUA},timeout=30).text,"html.parser")
    for a in s.find_all("a",href=True):
        h=a["href"].split("?")[0]
        if h.startswith("https://linktr.ee/dycc"): oid="or_dycc"
        else: oid=MAP.get(h)
        img=a.find("img")
        if not oid or not img or oid in rep: continue
        src=img.get("data-src") or img.get("src")
        if src.startswith("//"): src="https:"+src
        try:
            x=requests.get(src+("?format=500w" if "squarespace" in src and "format" not in src else ""),headers={"User-Agent":BUA},timeout=30)
            im=Image.open(io.BytesIO(x.content)).convert("RGBA"); w,h2=im.size
            im.thumbnail((400,400)); im.save(f"sharedlogos/{oid}.png"); rep[oid]={"url":src,"page":page,"size":[w,h2]}
        except Exception as e: rep[oid]={"err":str(e)}
json.dump(rep,open("sharedlogos/report.json","w"),indent=1)
for k,v in rep.items(): print(k,v.get("size"),v.get("err",""))
