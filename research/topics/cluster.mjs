// Draft clustering of the extracted topic phrases into a two-level topic list (parent → child), for team review.
// Reads extracted.json + records.json, writes draft-taxonomy.json and hierarchy.md.
// Usage: node research/topics/cluster.mjs  (from the repo root)
// The rules are a first draft: the team edits the list in hierarchy.md, then every record is re-tagged against
// the final list.
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const extracted = JSON.parse(readFileSync(dir + "extracted.json", "utf8"));
const records = JSON.parse(readFileSync(dir + "records.json", "utf8"));
const recById = new Map(records.map((r) => [r.id, r]));

// Parents and their children, in display order.
const PARENTS = [
  ["energy", "Clean energy & the grid", [
    ["solar", "Solar"],
    ["wind", "Offshore & onshore wind"],
    ["community_power", "Community & public power (aggregation, co-ops, green electricity)"],
    ["grid", "Grid, storage & energy demand (incl. data centers)"],
    ["utilities", "Utilities, rates & consumer protection"],
    ["clean_energy", "Clean / renewable energy in general"],
  ]],
  ["buildings", "Buildings & home energy", [
    ["heat_pumps", "Heat pumps, geothermal & electrification"],
    ["efficiency", "Efficiency, weatherization & energy assessments"],
    ["green_building", "Green building standards (passive house, embodied carbon, BERDO)"],
    ["public_buildings", "School, town & worship buildings"],
  ]],
  ["fossil", "Fossil fuels, biomass & nuclear", [
    ["gas_infra", "Gas pipelines, compressors & gas expansion"],
    ["gas_leaks", "Gas leaks & methane"],
    ["power_plants", "Fossil power plants & peakers"],
    ["biomass", "Biomass energy"],
    ["nuclear", "Nuclear power (Pilgrim, decommissioning, new nuclear)"],
    ["fossil_general", "Fossil fuel phaseout & polluter accountability"],
  ]],
  ["transport", "Transportation", [
    ["transit", "Public transit & fares"],
    ["evs", "Electric vehicles"],
    ["active", "Walking, biking & shared mobility"],
    ["aviation", "Private jets & airport expansion"],
    ["transport_general", "Transportation planning & policy"],
  ]],
  ["waste", "Waste, plastics & reuse", [
    ["compost", "Composting & food scraps"],
    ["reuse", "Recycling, reuse & repair"],
    ["plastics", "Plastics"],
    ["zero_waste", "Zero waste, trash & litter cleanups"],
  ]],
  ["health", "Pollution & environmental health", [
    ["air", "Air quality & monitoring"],
    ["toxics", "Toxic chemicals, lead, PFAS & contaminated sites"],
    ["incinerators", "Incinerators, landfills & waste facilities"],
    ["climate_health", "Climate, health & healthy homes"],
  ]],
  ["water", "Water, rivers & coasts", [
    ["rivers", "Rivers, lakes & watersheds"],
    ["sewage", "Sewage overflows & stormwater"],
    ["drinking_water", "Drinking water & water affordability"],
    ["coasts", "Coasts, harbors, oceans & waterfront access"],
  ]],
  ["nature", "Forests, land & nature", [
    ["forests", "Forest protection"],
    ["urban_trees", "Urban trees & tree equity"],
    ["land", "Land conservation & public lands"],
    ["wildlife", "Wildlife, birds & biodiversity"],
    ["restoration", "Habitat restoration, native plants & invasives"],
    ["outdoors", "Access to nature & outdoor recreation"],
  ]],
  ["food", "Food & farming", [
    ["gardens", "Gardens & urban agriculture"],
    ["food_systems", "Local farms, food systems & food security"],
  ]],
  ["resilience", "Climate resilience & adaptation", [
    ["heat", "Extreme heat"],
    ["flood", "Floods, storms & resilient infrastructure"],
    ["resilience_general", "Resilience planning"],
  ]],
  ["local", "Local & community climate action", [
    ["town_energy", "Town energy committees, plans & municipal action"],
    ["schools_campus", "Schools & campus sustainability"],
    ["faith", "Faith communities & creation care"],
    ["household", "Household action & sustainable living"],
    ["youth", "Youth climate action"],
    ["business", "Sustainable & clean energy business"],
  ]],
  ["education", "Climate education, culture & research", [
    ["k12", "K-12 climate curriculum"],
    ["awareness", "Public awareness, talks & climate conversations"],
    ["arts", "Arts, film & culture"],
    ["research", "Climate research & mapping"],
  ]],
  ["policy", "Climate policy & legislation", [
    ["state_policy", "State climate & energy policy (general)"],
    ["federal_policy", "Federal & international climate policy"],
    ["local_policy", "Local ordinances & bylaws"],
    ["ballot", "Ballot questions"],
    ["budget", "Environmental budgets & agency funding"],
    ["bills", "Named bills (see the bill list)"],
  ]],
  ["justice", "Climate & environmental justice", [
    ["ej", "Climate & environmental justice"],
    ["just_transition", "Just transition & energy democracy"],
    ["racial_justice", "Racial justice"],
    ["housing", "Housing & displacement"],
  ]],
  ["economy", "Jobs, workers & the economy", [
    ["green_jobs", "Green jobs & clean energy workforce"],
    ["labor", "Worker safety & labor rights"],
    ["economic_justice", "Economic justice, taxes & the care economy"],
    ["finance", "Divestment, investment & climate finance"],
  ]],
  ["democracy", "Democracy & civic power", [
    ["democracy", "Democracy, transparency & elections"],
    ["money_politics", "Money in politics & utility influence"],
  ]],
  ["movements", "Other movements & community needs", [
    ["peace", "Peace, anti-war & nuclear weapons"],
    ["immigration", "Immigrant rights"],
    ["indigenous", "Indigenous peoples"],
    ["wellbeing", "Health care, wellbeing & social services"],
  ]],
  ["broad", "Broad climate (no specific topic)", [
    ["broad", "Climate / sustainability in general"],
  ]],
];

// Ordered rules: the first matching regex decides a phrase's child topic. Specific rules come before general ones.
const RULES = [
  // specific sites and cross-cutting items first
  ["nuclear", /pilgrim|nuclear (power|plant|decommission|waste|policy|safety)|new nuclear|radioactive|chapter 503|nuclear decommission|nuclear power/],
  ["peace", /nuclear (weapons|war|abolition|disarmament)|\bwars?\b|militarism|war profiteering|peace|diplomacy|palestine|gaza/],
  ["aviation", /jet|hanscom|airport/],
  ["incinerators", /incinerator|landfill|ash landfill|parallel products|waste facility/],
  ["toxics", /pfas|\blead\b|lead (paint|service|in)|toxic|toxins|chemical|asbestos|pcb|superfund site|new bedford harbor|pesticide|contamination/],
  ["biomass", /biomass|wood-based energy/],
  ["power_plants", /peaker|power plant/],
  ["gas_leaks", /gas leak|methane/],
  ["gas_infra", /pipeline|compressor|lng|gas (expansion|system|meter|industry|and energy)|meter station|fracked gas|access northeast|ferc|fossil gas|new fossil fuel infrastructure/],
  ["money_politics", /utility (campaign|political|influence|lobbying|ratepayer)|corporate (cash|money)|campaign finance/],
  ["utilities", /utility|supplier scams|consumer protection|time-varying|heat pump (electricity )?rates|energy affordability|heating fuel|heating-fuel|group purchasing|energy use and costs/],
  ["data_centers_grid", /data center/],
  ["grid", /grid|storage|peak electricity|microgrid|independent power/],
  ["wind", /\bwind\b/],
  ["community_power", /aggregation|community choice|green (electricity|power|energy|municipal)|100% green|public power|public energy|cooperative|community-owned|energy democracy|clean energy switching|renewable energy pledges/],
  ["solar", /solar/],
  // buildings
  ["public_buildings", /school (building|heating|ventilation|energy)|school ventilation|aging school|public school facilities|sustainable school buildings|green school buildings|healthy school|town building|municipal building|synagogue|house of worship|climate-resilient school/],
  ["green_building", /passive house|embodied carbon|berdo|building (emissions|carbon|performance|science|energy use)|energy codes|leed|zero-carbon|zero carbon|net-zero renovation|green building|built environment|architecture|ventilation design|deep energy/],
  ["heat_pumps", /heat pump|geothermal|ground-source|thermal energy network|electrification|building decarbonization|gas stoves|clean heat|sustainable home heating|hvac/],
  ["efficiency", /efficien|weatheriz|energy (assessment|audit|saving|coaching|conservation|retrofit|upgrade)|home energy|retrofit|rebate|mass save|window inserts|energy-savings|energy reduction|building energy|heating upgrades|efficient|home repair|energy savings|energy saving|building efficiency/],
  // transport
  ["evs", /\bev\b|evs|electric vehicle|vehicle electrification|electric transportation|clean affordable vehicles|transportation electrification/],
  ["active", /walking|biking|bicycle|bike|micromobility|car sharing|shared transportation/],
  ["transit", /\btransit\b|fare|rural ride/],
  ["transport_general", /transportation/],
  // waste
  ["compost", /compost|food scrap|food waste|organic waste/],
  ["plastics", /plastic|styrofoam/],
  ["reuse", /recycl|upcycl|reuse|repair|e-waste|donated goods/],
  ["zero_waste", /zero waste|waste reduction|trash|litter|hauler|consumption/],
  // water
  ["sewage", /sewage|sewer|stormwater/],
  ["drinking_water", /drinking water|water affordability|water supply/],
  ["coasts", /harbor|ocean|salt marsh|whale|waterfront|coast/],
  ["rivers", /river|brook|clean charles|lake|stream|watershed|creek|aquatic|cyanobacteria|algae|wetland|waterway|water quality|clean water|\bwater\b/],
  // health
  ["air", /\bair\b|diesel emissions|asthma/],
  ["climate_health", /health|healthy homes|home hazards/],
  // nature
  ["urban_trees", /tree (planting|equity|giveaway|care|data|identification)|urban (tree|forest)|street tree|shade tree|miyawaki|tree canopy|^trees$|clearcutting|tree clearing/],
  ["forests", /forest|logging|wildfire|old growth|quabbin|october mountain|wildlands/],
  ["restoration", /invasive|natural areas stewardship|native plant|restoration|native planting|sustainable landscaping|chemical-free gardening|ecological management/],
  ["wildlife", /bird|bats|beaver|wildlife|pollinator|biodiversity|species|habitat|waterfowl|hawk|natural history|ecology/],
  ["land", /\bland|conservation|protected|public lands|farm and woodland|four corners|sanctuar|nature for all/],
  ["outdoors", /nature|trail|outdoor|recreation|photography/],
  // food
  ["gardens", /garden|greenhouse|hydroponic|orchard|urban agriculture|school farm|vacant lot/],
  ["food_systems", /food|farm|hunger|agriculture/],
  // resilience
  ["heat", /heat (resilience|mapping)|extreme heat|urban heat/],
  ["flood", /flood|storm|climate-ready|climate-resilient|resilient communities/],
  ["resilience_general", /resilien|adaptation/],
  // policy & bills
  ["ballot", /ballot|question \d|top two/],
  ["bills", /superfund|polluter pays|make polluters|fair share|global warming solutions|clean water act|embodied carbon act|least developed|educator pay|clean slate|environmental justice law|trees as a public good|forest protection legislation/],
  ["budget", /budget|agency funding|state school funding/],
  ["federal_policy", /federal|bipartisan|international|green new deal/],
  ["local_policy", /bylaw|ordinance|local climate policy/],
  ["state_policy", /legislat|state (climate|carbon|energy)|climate (policy|bills|laws)|energy policy|clean energy policy|all-of-the-above|clean electricity policy|net zero accountability|net-zero (implementation|economy)|climate progress tracking|government climate inaction|environmental (common agenda|politics|law)|renewable energy requirements|energy priorities|climate and economic policy|state climate|climate advocacy|energy legislation/],
  // local action
  ["faith", /creation care|faith|green sanctuary|laudato|worship|congregation/],
  ["schools_campus", /school|campus|student|textbook|green contract/],
  ["youth", /youth|children|teen/],
  ["town_energy", /town|municipal|local (climate|decarbonization|clean energy)|community energy|green community|climate action plan|net-zero planning|regional (climate|planning)|sustainability planning|city climate|local government|community transportation/],
  ["household", /household|home carbon|carbon footprint|green living|sustainable living|self-sufficiency/],
  ["business", /business|green growth|sustainable economy|clean energy (businesses|projects)|energy contractors/],
  // education
  ["k12", /curricul|climate education|sustainability education|climate literacy|k-12/],
  ["arts", /poetry|film|art\b|historic preservation/],
  ["research", /research|mapping|sustainability audits/],
  ["awareness", /awareness|presentations|conversations|outreach|climate voters/],
  // justice & economy
  ["just_transition", /just transition|energy transition|frontline|equitable energy/],
  ["ej", /environmental justice|climate justice|justice and equity|climate and environmental justice|environmental and climate justice/],
  ["racial_justice", /racial|racism|white supremacy|systemic racism/],
  ["housing", /housing|displacement|rent|homeownership/],
  ["green_jobs", /jobs|workforce|careers|trades|weatherization jobs|inclusive hiring|green jobs/],
  ["labor", /worker|working conditions|workplace|labor|construction (safety|worker)|project labor|salary|working families/],
  ["finance", /divest|pension|investment|climate finance/],
  ["economic_justice", /econom|tax|childcare|child care|care\b|mutual aid|small business|social justice/],
  ["democracy", /democracy|transparency|accountability|good government|election|civic|women's civic|primary/],
  ["immigration", /immigra|ice\b/],
  ["indigenous", /indigenous/],
  ["wellbeing", /health care|wellness|substance|active living|social services|disability|adult basic|community (care|development|revitalization|health|economic)|rural community|reform|criminal record/],
  ["clean_energy", /clean energy|renewable|energy independence|hydropower|biodiesel|green energy|clean electricity/],
  ["fossil_general", /fossil|oil|polluter|pollution/],
  ["broad", /.*/],
];

const parentOf = new Map();
const label = new Map();
for (const [pid, plabel, kids] of PARENTS) { label.set(pid, plabel); for (const [cid, clabel] of kids) { parentOf.set(cid, pid); label.set(cid, clabel); } }
parentOf.set("data_centers_grid", "energy");

const BROAD = /^(climate|climate change|climate action|climate solutions|climate crisis solutions|environment|environmental issues|environmental action|environmental sustainability|sustainability|sustainable future|sustainable communities|livable planet|current climate issues|climate challenges|climate emergency|ecological crisis|climate futures|energy|green initiatives|environmental leadership|environmental leadership awards|sustainable policies|equitable climate solutions|climate and clean energy|energy and climate action|climate and energy solutions|sustainable energy future|long-term energy future|local environmental protection|community environmental groups|climate change and boston|emissions reduction|greenhouse gas reduction|decarbonization|climate change awareness|environmental worship)$/;

// Phrases the rules above put in the wrong place.
const OVERRIDES = {
  "window heat pumps": "heat_pumps", "window inserts": "efficiency", "worker-owned cooperative": "business",
  "utility clearcutting": "urban_trees", "climate and clean energy bills": "state_policy", "clean energy equity": "state_policy",
  "transportation electrification": "evs", "vehicle electrification": "evs", "weatherization jobs": "green_jobs",
  "weatherization workforce": "green_jobs", "town energy reduction": "town_energy", "biodiesel": "clean_energy",
  "fair share amendment": "bills", "chemical-free gardening": "gardens", "recycling contamination": "reuse",
  "toxic blue-green algae": "rivers", "health care": "wellbeing", "community health improvement": "wellbeing",
  "healthy habitat": "wildlife", "labor health and safety": "labor", "climate, energy and water legislation": "state_policy",
  "land and water conservation": "land", "quabbin watershed forests": "forests", "waterfowl and wetlands": "wildlife",
  "100% renewable island": "clean_energy", "green sanctuary program": "faith", "farm and woodland protection": "land",
  "school orchard and pollinator garden": "gardens", "climate outdoors workforce": "green_jobs", "vacant lot reuse": "gardens",
  "school climate curriculum": "k12", "youth substance use": "wellbeing", "youth green careers": "green_jobs",
  "legislative accountability": "democracy", "legislative transparency": "democracy", "state school funding": "economic_justice",
  "tax and budget policy": "economic_justice", "educator pay": "labor", "polluter accountability": "fossil_general",
  "international climate finance": "finance",
};

function classify(phrase) {
  if (OVERRIDES[phrase]) return OVERRIDES[phrase];
  if (BROAD.test(phrase) && !/awareness|worship/.test(phrase)) return "broad";
  for (const [cid, re] of RULES) if (re.test(phrase)) return cid === "data_centers_grid" ? "grid" : cid;
  return "broad";
}

// Bills: normalise names so mentions of the same bill count together.
const BILLS = [
  ["ma_superfund", "MA Climate Change Superfund (Make Polluters Pay)", "ma", /superfund|make polluters|polluter pays/],
  ["vt_superfund", "VT Climate Superfund Act (law)", "vt", /superfund/],
  ["ma_senate_energy", "MA Senate energy bill (2026)", "ma", /senate energy bill/],
  ["clean_energy_equity", "Clean Energy Equity bill", "ma", /clean energy equity/],
  ["embodied_carbon", "Embodied Carbon Act", "ma", /embodied carbon/],
  ["h3501", "H.3501 (offshore wind)", "ma", /h\.?3501|offshore wind/],
  ["h3726", "H.3726 (transportation-climate alignment)", "ma", /h\.?3726|transportation-climate/],
  ["s2294", "S.2294 (building decarbonization)", "ma", /s\.?2294|building decarbonization/],
  ["forest_bills", "Forest protection bills incl. H.953 (Trees as a Public Good)", "ma", /h\.?953|forest/],
  ["chapter503", "Chapter 503 nuclear guardrails", "ma", /chapter 503/],
  ["ldc_fund", "Least Developed Countries Fund state legislation", "ma", /least developed/],
  ["fair_share", "Fair Share Amendment (2022)", "ma", /fair share/],
  ["q6", "Question 6 (Nature for All Fund)", "ma", /question 6/],
  ["q3", "Question 3 (Top Two Primary)", "ma", /question 3/],
  ["clean_slate", "Clean Slate Act", "ma", /clean slate/],
  ["educator_pay", "Educator pay bill", "ma", /educator pay/],
  ["gwsa", "MA Global Warming Solutions Act (law)", "ma", /global warming solutions/],
  ["vt_gwsa", "VT Global Warming Solutions Act (law)", "vt", /global warming solutions/],
  ["clean_water_act", "Clean Water Act (federal)", "", /clean water act/],
  ["boston_diesel", "Boston diesel emissions ordinance", "ma", /diesel/],
  ["berdo", "BERDO (Boston building emissions ordinance)", "ma", /berdo|building emissions reduction/],
  ["vt_ej_law", "Vermont environmental justice law (2022)", "vt", /environmental justice law/],
];
function billId(b, map) {
  const s = `${b.number || ""} ${b.name}`.toLowerCase();
  for (const [id, , m, re] of BILLS) if ((!m || m === map) && re.test(s)) return id;
  return null;
}

// Tally.
const ITEM = new Set(["event", "project", "action"]);
const kids = new Map(); // cid -> {phrases: Map, items, missions, groups:Set, examples:[]}
const bills = new Map();
const unknownBills = [];
const assign = {}; // phrase -> cid
for (const e of extracted) {
  const r = recById.get(e.id);
  const seen = new Set();
  for (const t of e.topics) {
    const cid = (assign[t.phrase] ||= classify(t.phrase));
    if (seen.has(cid)) continue; // count each record once per child topic
    seen.add(cid);
    const k = kids.get(cid) || { phrases: new Map(), items: 0, missions: 0, recurring: 0, groups: new Set(), examples: [], recs: new Set() };
    k.recs.add(e.id);
    if (ITEM.has(e.kind)) { k.items++; if (e.recurring) k.recurring++; } else k.missions++;
    k.groups.add(`${e.map}:${e.host}`);
    if (ITEM.has(e.kind) && k.examples.length < 3) k.examples.push(`${r.name} (${r.host_name})`);
    kids.set(cid, k);
  }
  for (const t of e.topics) { const k = kids.get(assign[t.phrase]); k.phrases.set(t.phrase, (k.phrases.get(t.phrase) || 0) + 1); }
  for (const b of e.bills) {
    const id = billId(b, e.map);
    if (!id) { unknownBills.push(b.name); continue; }
    const x = bills.get(id) || { items: 0, missions: 0, groups: new Set() };
    if (ITEM.has(e.kind)) x.items++; else x.missions++;
    x.groups.add(`${e.map}:${e.host}`);
    bills.set(id, x);
  }
}

// draft-taxonomy.json: the machine-readable draft (re-tagging and the Topics view read this after review).
const taxonomy = {
  generated_at: new Date().toISOString().slice(0, 10),
  status: "draft for team review",
  parents: PARENTS.map(([pid, plabel, ks]) => ({
    id: pid, label: plabel,
    children: ks.map(([cid, clabel]) => ({ id: cid, label: clabel, phrases: [...(kids.get(cid)?.phrases.keys() || [])].sort() })),
  })),
  bills: BILLS.map(([id, name, map]) => ({ id, name, map: map || "us", mentions: bills.has(id) ? bills.get(id).items + bills.get(id).missions : 0 })),
};
writeFileSync(dir + "draft-taxonomy.json", JSON.stringify(taxonomy, null, 1) + "\n");

// hierarchy.md: the review copy.
const n = (cid) => kids.get(cid) || { phrases: new Map(), items: 0, missions: 0, recurring: 0, groups: new Set(), examples: [], recs: new Set() };
const kindOf = new Map(extracted.map((e) => [e.id, e]));
const parentTotals = PARENTS.map(([pid, plabel, ks]) => {
  // Distinct records: a record tagged with two children of one parent counts once for the parent.
  const g = new Set(), recs = new Set();
  for (const [cid] of ks) { const k = n(cid); k.recs.forEach((x) => recs.add(x)); k.groups.forEach((x) => g.add(x)); }
  let items = 0, missions = 0;
  for (const id of recs) ITEM.has(kindOf.get(id).kind) ? items++ : missions++;
  return { pid, plabel, ks, items, missions, groups: g.size };
});
const nItems = extracted.filter((e) => ITEM.has(e.kind)).length;
const nMissions = extracted.length - nItems;
let md = `# Topic list: draft for review

Generated ${taxonomy.generated_at} from ${extracted.length} records (${nItems} events, projects and actions, and ${nMissions}
mission statements) on the Massachusetts and Vermont maps. Method: \`INSTRUCTIONS.md\`; raw phrases with evidence:
\`extracted.json\`; draft rules: \`cluster.mjs\`.

**Team review copy:** [Topic map: draft topic list for review](https://claude.ai/code/artifact/78f497cd-fbed-4cac-a380-d54ce4d9c60a)
(Claude Docs; comments and edits there).

**How to review:** rename, merge, split or move any topic below, add missing ones, and say where any phrase in a
"phrases" list belongs instead. The final list is what every item gets re-tagged against.

**Counts** are records, not weights. *Items* = events + projects + actions; *missions* = org and coalition mission
statements; *groups* = distinct orgs/coalitions. In the Topics view, each of these will have a
"not important → important" slider: recurring events, projects vs events vs actions, recency, and the
mission-statement layer.

## Overview

| Parent topic | Items | Missions | Groups |
|---|--:|--:|--:|
${parentTotals.sort((a, b) => b.items - a.items).map((p) => `| ${p.plabel} | ${p.items} | ${p.missions} | ${p.groups} |`).join("\n")}

`;
for (const [pid, plabel, ks] of PARENTS) {
  const t = parentTotals.find((p) => p.pid === pid);
  md += `## ${plabel}\n\n${t.items} items, ${t.missions} missions, ${t.groups} groups.\n\n`;
  for (const [cid, clabel] of ks) {
    const k = n(cid);
    const phrases = [...k.phrases.entries()].sort((a, b) => b[1] - a[1]).map(([p, c]) => (c > 1 ? `${p} (${c})` : p));
    md += `### ${clabel}\n\n${k.items} items${k.recurring ? ` (${k.recurring} recurring)` : ""}, ${k.missions} missions, ${k.groups.size} groups.`;
    if (k.examples.length) md += ` E.g. ${k.examples.join("; ")}.`;
    md += `\n\n<details><summary>${phrases.length} phrases</summary>\n\n${phrases.join(", ") || "(none)"}\n\n</details>\n\n`;
    if (cid === "bills") {
      md += `| Bill / ballot question | Map | Items | Missions | Groups |\n|---|---|--:|--:|--:|\n`;
      for (const [id, name, map] of BILLS) {
        const x = bills.get(id);
        if (x) md += `| ${name} | ${(map || "us").toUpperCase()} | ${x.items} | ${x.missions} | ${x.groups.size} |\n`;
      }
      md += `\nBills are also counted under their issue (e.g. the forest bills under Forest protection), so the Topics\nview can show them inside the Legislation bubble and inside their issue.\n\n`;
    }
  }
}
const strat = {};
for (const e of extracted) for (const s of e.strategies) { strat[s] ||= { items: 0, missions: 0 }; ITEM.has(e.kind) ? strat[s].items++ : strat[s].missions++; }
md += `## Strategies (how groups work on these topics)\n\n| Strategy | Items | Missions |\n|---|--:|--:|\n`;
md += Object.entries(strat).sort((a, b) => b[1].items - a[1].items).map(([s, x]) => `| ${s} | ${x.items} | ${x.missions} |`).join("\n") + "\n\n";
const rel = {};
for (const e of extracted) { const k = `${e.climate_relevance}`; rel[k] ||= { items: 0, missions: 0 }; ITEM.has(e.kind) ? rel[k].items++ : rel[k].missions++; }
md += `## Climate relevance\n\n| Relevance | Items | Missions |\n|---|--:|--:|\n` + Object.entries(rel).map(([s, x]) => `| ${s} | ${x.items} | ${x.missions} |`).join("\n") + "\n\n";
md += `"Adjacent" means a related justice, health, labor, housing, peace or democracy issue. The Topics view can\nshow these dimmed, or behind a toggle.\n`;
writeFileSync(dir + "hierarchy.md", md);

const empty = PARENTS.flatMap(([, , ks]) => ks).filter(([cid]) => !kids.has(cid)).map(([cid]) => cid);
console.log("phrases:", Object.keys(assign).length, "| empty children:", empty.join(",") || "none", "| unmatched bills:", unknownBills);
console.log("broad:", [...n("broad").phrases.keys()].join(" | "));
