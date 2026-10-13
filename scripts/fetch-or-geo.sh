#!/usr/bin/env bash
# Rebuilds Oregon geography in public/geo/ from US Census Bureau files (2024 cartographic boundary files + 2024 Gazetteer):
# or-towns (incorporated cities, with county), or-counties, or-congress (119th Congress), or-senate, or-house,
# or-zips.json (ZCTA centres 97xxx), or-town-centroids.json (incorporated cities). Needs network access to www2.census.gov.
set -euo pipefail
T=$(mktemp -d); O="$(dirname "$0")/../public/geo"; MS="npx -y mapshaper@0.6"
B=https://www2.census.gov/geo/tiger/GENZ2024/shp; G=https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer
for f in cb_2024_41_place_500k cb_2024_us_county_500k cb_2024_us_cd119_500k cb_2024_41_sldu_500k cb_2024_41_sldl_500k; do
  curl -s -o "$T/$f.zip" "$B/$f.zip" && unzip -oq "$T/$f.zip" -d "$T/$f"
done
curl -s -o "$T/zcta.zip" "$G/2024_Gaz_zcta_national.zip" && unzip -oq "$T/zcta.zip" -d "$T/zcta"
curl -s -o "$T/place.txt" "$G/2024_gaz_place_41.txt"
$MS -i "$T"/cb_2024_us_county_500k/*.shp -filter 'STATEFP=="41"' -each 'county=NAME' -filter-fields county -simplify 6% keep-shapes -o format=geojson precision=0.0001 "$O/or-counties.geojson"
$MS -i "$O/or-counties.geojson" -o "$T/cty.json"
$MS -i "$T"/cb_2024_41_place_500k/*.shp -filter 'LSAD=="25"' -each 'name=NAME' -filter-fields name -join "$T/cty.json" point-method fields=county -simplify 10% keep-shapes -o format=geojson precision=0.0001 "$O/or-towns.geojson"
$MS -i "$T"/cb_2024_us_cd119_500k/*.shp -filter 'STATEFP=="41"' -each 'n=+CD119FP; name="Congressional District "+n' -filter-fields name -simplify 5% keep-shapes -o format=geojson precision=0.0001 "$O/or-congress.geojson"
$MS -i "$T"/cb_2024_41_sldu_500k/*.shp -each 'name="State Senate District "+(+SLDUST)' -filter-fields name -simplify 8% keep-shapes -o format=geojson precision=0.0001 "$O/or-senate.geojson"
$MS -i "$T"/cb_2024_41_sldl_500k/*.shp -each 'name="State House District "+(+SLDLST)' -filter-fields name -simplify 8% keep-shapes -o format=geojson precision=0.0001 "$O/or-house.geojson"
python3 - "$T" "$O" <<'PY'
import glob, json, re, sys
T, O = sys.argv[1], sys.argv[2]
z = {}
for l in open(glob.glob(f"{T}/zcta/*.txt")[0]).read().splitlines()[1:]:
    f = l.split("\t")
    if f[0].startswith("97"): z[f[0]] = [round(float(f[5]), 4), round(float(f[6].strip()), 4)]
json.dump(z, open(f"{O}/or-zips.json", "w"), separators=(",", ":"))
t = {}
for l in open(f"{T}/place.txt", encoding="latin-1").read().splitlines()[1:]:
    f = l.split("\t")
    if f[4] == "25": t[re.sub(r" city$", "", f[3].strip())] = [round(float(f[10]), 4), round(float(f[11].strip()), 4)]
json.dump(t, open(f"{O}/or-town-centroids.json", "w"), separators=(",", ":"))
PY
