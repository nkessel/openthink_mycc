#!/usr/bin/env bash
# Rebuilds the voting-district outlines in public/geo/ from MassGIS (run after redistricting or new ward maps).
# Needs network access to services1.arcgis.com. Writes ma-congress / ma-senate / ma-house / ma-wards / ma-precincts.geojson.
set -euo pipefail
B="https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/All_Legislative_Layers_and_combined_for_popups_WFL1/FeatureServer"
T=$(mktemp -d); O="$(dirname "$0")/../public/geo"; MS="npx -y mapshaper@0.6"
curl -s "$B/0/query?where=1%3D1&outFields=REP_DIST&outSR=4326&f=geojson" > "$T/house.json"
curl -s "$B/1/query?where=1%3D1&outFields=SEN_DIST&outSR=4326&f=geojson" > "$T/senate.json"
curl -s "$B/2/query?where=1%3D1&outFields=DISTRICT&outSR=4326&f=geojson" > "$T/congress.json"
for o in 0 1000 2000 3000; do
  curl -s "$B/3/query?where=1%3D1&outFields=WARD,TOWN,WP_NAME&outSR=4326&resultOffset=$o&resultRecordCount=1000&f=geojson" > "$T/wp_$o.json"
done
$MS -i "$T"/wp_*.json combine-files -merge-layers force -each 'WARD=(WARD||"").trim(); town=TOWN.toLowerCase().replace(/\b\w/g,function(c){return c.toUpperCase()})' -o "$T/wp.json"
$MS "$T/house.json" -simplify 8% keep-shapes -each 'name=REP_DIST' -filter-fields name -o format=geojson precision=0.0001 "$O/ma-house.geojson"
$MS "$T/senate.json" -simplify 8% keep-shapes -each 'name=SEN_DIST' -filter-fields name -o format=geojson precision=0.0001 "$O/ma-senate.geojson"
$MS "$T/congress.json" -simplify 5% keep-shapes -each 'name=DISTRICT' -filter-fields name -o format=geojson precision=0.0001 "$O/ma-congress.geojson"
$MS "$T/wp.json" -filter 'WARD !== ""' -dissolve town,WARD -each 'name=town + " Ward " + WARD' -filter-fields name -simplify 10% keep-shapes -o format=geojson precision=0.0001 "$O/ma-wards.geojson"
$MS "$T/wp.json" -each 'name=WP_NAME' -filter-fields name -simplify 4% keep-shapes -o format=geojson precision=0.0001 "$O/ma-precincts.geojson"
