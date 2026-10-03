// One-off: rewrite public descriptions that still carried notes meant for the research team (backlog item
// "Remove research notes from public text"). Prints the changes; the same map is applied to the Google Sheet.
import { readFileSync, writeFileSync } from "node:fs";
export const FIX = {
  masscosh_tlaw_climate_change_e1: "10-hour OSHA construction safety course.",
  climate_action_now_western_m_p1: "",
  climate_action_now_western_m_p2: "",
  green_energy_consumers_allia_e10: "Webinar on driving electric vehicles in cold weather.",
  green_energy_consumers_allia_e11: "Webinar on long-term electric vehicle battery health.",
  mass_divest_coalition_p1: "Campaign for Massachusetts public pension funds to divest from fossil fuels.",
  aft_mass_e1: "Union event.",
  citizens_climate_lobby_e2: "Tabling event.",
  franklin_county_and_north_quabbin_community_health_improveme: "Regional health improvement network, convened by the Franklin Regional Council of Governments since 2016, that sets community health priorities such as youth substance use, mental wellness and active living.",
  franklin_county_and_north_qu_p1: "Franklin County and North Quabbin community health improvement network.",
  ma_senior_action: "Statewide, senior-led grassroots group founded in 1981 that organizes older adults on health care, economic security, housing, transportation and racial justice.",
  mass_facilities_administrators_association: "Professional association founded in 1973 for municipal facilities administrators (about 180 members from 140 municipalities) offering training and information exchange.",
  massachusetts_jobs_with_justice: "Coalition of labor, faith and student organizations that builds solidarity for workers' rights through rallies and picket-line support, with offices in Jamaica Plain and Springfield.",
  vt_actonclimatevt: "Coalition of 30+ Vermont organizations that builds support for equitable, just climate solutions; it says it helped pass the 2020 Global Warming Solutions Act.",
  vt_350vermont: "Statewide grassroots climate group based in Burlington, described by partners as the primary driver of Vermont's Climate Superfund Act.",
  vt_youth_lobby: "Vermont youth advocacy group focused on climate action and justice; runs the annual Rally for the Planet and trainings such as how to write your legislator.",
  vt_connecticut_river_conservancy: "Nonprofit that restores and advocates for clean water, healthy habitat and resilient communities across the Connecticut River watershed; a partner on the Vermont Environmental Common Agenda.",
  vt_vermont_trout_unlimited: "Statewide council of Trout Unlimited chapters; a partner on the Environmental Common Agenda.",
  vt_veep: "Energy education organization; a member of Transportation for Vermonters and Energy Action Network.",
  vt_aarp_vermont: "Vermont state office of AARP; a member of Transportation for Vermonters.",
  vt_american_lung_association_vt: "Vermont office of the American Lung Association; a member of Transportation for Vermonters.",
  vt_green_mountain_transit: "Regional public transit provider; a member of Transportation for Vermonters.",
  vt_charlotte_energy_committee: "Town committee working on energy since 2010; championed the 2025-26 Town Energy Modernization Project (rooftop solar and heat pumps for town buildings).",
  vt_middlebury_energy_committee: "Selectboard-appointed committee that promotes energy savings and lower emissions in Middlebury through efficiency, renewables and transportation planning; a 2026 news report says it was regrouping.",
  vt_marshfield_energy_committee: "Marshfield's town energy committee, which posts regular meeting minutes on the town website.",
  vt_rejoice: "Coalition project that held 19 community conversations across Vermont from 2017 to 2021 and whose findings informed the state's 2022 environmental justice law.",
};
if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const f of ["public/data.json", "public/maps/vt.json", "research/state-pilot/vt.json"]) {
    const raw = readFileSync(f, "utf8");
    const d = JSON.parse(raw);
    for (const g of [...d.coalitions, ...d.organizations]) {
      if (g.id in FIX) { g.description = FIX[g.id]; n++; }
      for (const k of ["events", "projects", "actions"]) for (const it of g[k] || []) if (it.id in FIX) { it.description = FIX[it.id]; n++; }
    }
    writeFileSync(f, raw.includes("\n  ") ? JSON.stringify(d, null, 2) + "\n" : raw.includes("\n ") ? JSON.stringify(d, null, 1) + "\n" : JSON.stringify(d));
  }
  console.log("descriptions rewritten:", n);
}
