// Flatten every event, project, action and mission statement (org + coalition descriptions) from the map
// data into one list of records for topic extraction. Writes research/topics/records.json.
// Usage: node scripts/topic-records.mjs
import { readFileSync, writeFileSync } from "node:fs";

const maps = { ma: "public/data.json", vt: "public/maps/vt.json" };
const out = [];
for (const [map, path] of Object.entries(maps)) {
  const d = JSON.parse(readFileSync(path, "utf8"));
  const groups = [...d.coalitions.map((g) => ({ ...g, _kind: "coalition" })), ...d.organizations.map((g) => ({ ...g, _kind: "org" }))];
  for (const g of groups) {
    if (g.description) out.push({ id: `${map}:${g.id}:mission`, map, kind: `${g._kind}_mission`, host: g.id, host_name: g.name, name: g.name, text: g.description });
    for (const kind of ["event", "project", "action"]) {
      for (const it of g[`${kind}s`] || []) {
        const rec = { id: `${map}:${it.id || `${g.id}:${kind}:${it.name}`}`, map, kind, host: g.id, host_name: g.name, name: it.name, text: it.description || "" };
        if (it.date) rec.date = it.date;
        if (it.status) rec.status = it.status;
        if (it.kind) rec.subkind = it.kind;
        out.push(rec);
      }
    }
  }
}
const ids = new Set();
for (const r of out) { if (ids.has(r.id)) throw new Error("duplicate id " + r.id); ids.add(r.id); }
writeFileSync("research/topics/records.json", JSON.stringify(out, null, 1) + "\n");
const count = {};
for (const r of out) count[`${r.map} ${r.kind}`] = (count[`${r.map} ${r.kind}`] || 0) + 1;
console.log(out.length, "records", count);
