// One-off: merge research/ma-gaps/fill5.json (coalition + org details, each with a source) into public/data.json.
// Coalitions: website, a fuller description, scope, focus tags, and the member groups their own pages name (only
// groups already on the map). Orgs: blank fields only. SCJC's list is campaign supporters, not members: skipped.
import { readFileSync, writeFileSync } from "node:fs";
const d = JSON.parse(readFileSync("public/data.json", "utf8"));
const fill = JSON.parse(readFileSync("research/ma-gaps/fill5.json", "utf8"));
const tags = new Set(d.coalitions.flatMap((c) => c.focus_tags));
const SCOPE = { gjc: "Greater Boston", ejlt: "statewide", hero: "statewide", scjc: "Greater Springfield" };
const LOGO = { gjc: "logos/coalition_gjc.png", south_coast_neighbors_united: "logos/south_coast_neighbors_united.jpg" };
const MEMBERS_FROM = new Set(["gjc", "ejlt", "hero"]);
let added = 0;
for (const e of fill) {
  const f = e.fields || {};
  if (e.kind === "coalition") {
    const c = d.coalitions.find((x) => x.id === e.id);
    if (f.website) c.website = f.website;
    if (f.description) c.description = f.description;
    if (SCOPE[e.id]) c.geographic_scope = SCOPE[e.id];
    if (f.focus_tags) c.focus_tags = [...new Set([...c.focus_tags, ...f.focus_tags.filter((t) => tags.has(t))])];
    if (LOGO[e.id]) c.logo = LOGO[e.id];
    if (MEMBERS_FROM.has(e.id)) {
      for (const m of e.members || []) {
        const o = m.org_id && d.organizations.find((x) => x.id === m.org_id);
        if (!o || c.member_ids.includes(o.id)) continue;
        c.member_ids.push(o.id);
        o.coalition_ids = [...new Set([...(o.coalition_ids || []), c.id])];
        d.edges.push({ source: c.id, target: o.id });
        added++;
      }
      c.member_count = c.member_ids.length;
    }
  } else {
    const o = d.organizations.find((x) => x.id === e.id);
    for (const k of ["website", "description", "geographic_focus"]) if (f[k] && !o[k]) o[k] = f[k];
    if (f.website && /press|news/i.test(o.website || "") && e.id === "healthlink") o.website = f.website;
    if (f.type && (!o.type || o.type === "unknown")) o.type = f.type;
    if (LOGO[e.id] && !o.logo) o.logo = LOGO[e.id];
  }
}
writeFileSync("public/data.json", JSON.stringify(d, null, 2) + "\n");
console.log("memberships added:", added);
