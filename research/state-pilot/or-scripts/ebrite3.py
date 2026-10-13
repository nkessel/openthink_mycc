import json,re,sys,concurrent.futures as cf
sys.path.insert(0,'.')
from ebrite2 import go as detail
from ebrite import page
Q={"or_1000_friends":"1000-friends-of-oregon","or_olcv":"oregon-league-of-conservation-voters","or_sierra_club":"sierra-club-oregon","or_third_act_oregon":"third-act-oregon",
"or_oec":"oregon-environmental-council","or_climate_solutions":"climate-solutions","or_unite_oregon":"unite-oregon","or_apano":"apano","or_verde":"verde","or_depave":"depave",
"or_fot":"friends-of-trees","or_opal":"opal-environmental-justice","or_350_eugene":"350-eugene","or_350_deschutes":"350-deschutes","or_breach":"breach-collective",
"or_ccc":"coalition-of-communities-of-color","or_naya":"naya","or_cep":"community-energy-project","or_electrify_oregon":"electrify-oregon","or_landwatch":"central-oregon-landwatch",
"or_willamette_riverkeeper":"willamette-riverkeeper","or_trk":"tualatin-riverkeepers","or_oregon_wild":"oregon-wild","or_beyond_toxics":"beyond-toxics","or_ob4c":"oregon-business-for-climate",
"or_climate_reality_pdx":"climate-reality-portland","or_xrpdx":"extinction-rebellion-portland","or_sunrise_pdx":"sunrise-pdx","or_next_up":"next-up-oregon","or_envirocenter":"the-environmental-center-bend",
"or_socan":"socan","or_rogue_climate":"rogue-climate","or_orcan":"oregon-climate-and-agriculture-network","or_emo":"ecumenical-ministries-of-oregon","or_neea":"neea","or_nwec":"nw-energy-coalition"}
urls={}
for oid,q in Q.items():
    for city in ("portland","eugene","bend"):
        urls[f"https://www.eventbrite.com/d/or--{city}/{q}/"]=oid
found={}
def one(u):
    return urls[u],page(u)
with cf.ThreadPoolExecutor(6) as ex:
    for oid,evs in ex.map(one,list(urls)):
        for e in evs:
            if e["startDate"]>="2026-10-13": found.setdefault(e["url"],oid)
print(len(found),"candidate event pages")
with cf.ThreadPoolExecutor(8) as ex: det=[x for x in ex.map(detail,list(found)) if x and x["ev"]]
out=[]
for x in det:
    oid=found[x["url"]]; org=(x["org"] or ["?"])[0]
    out.append({"oid":oid,"org":org,**x})
json.dump(out,open("ebrite3.json","w"),indent=1,ensure_ascii=False)
for x in out: print(x["oid"].ljust(26),"|",x["org"][:34].ljust(34),"|",x["ev"]["start"][:16],x["ev"]["name"][:60])
