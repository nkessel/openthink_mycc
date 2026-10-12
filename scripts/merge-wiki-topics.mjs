// Merge Turibius's two Wikipedia topic files into one list (his spec, Running doc, Oct 2026):
//   topics_<date>-v9-MYCC.csv          hop_distance,topic,qid,seeds,...,lift_lcb_max,...
//   topics_<date>-v9-MYCC.aliases.csv  qid,topic,alias,source,fragment,ambiguous
// → research/topics/wiki/topics-merged.csv with hop_distance,topic,aliases,qid,seeds,lift_lcb_max
//   (aliases joined with " | "; ambiguous aliases left out). Topics below --min-lift are dropped.
//   The 13 seed topics have no lift score; they are kept (they are the main topics on the map).
// Usage: node scripts/merge-wiki-topics.mjs <topics.csv> <aliases.csv> [--min-lift 0]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseCsvText as parseCsv } from "./csv.mjs";

const args = process.argv.slice(2);
const flag = args.indexOf("--min-lift");
const minLift = flag >= 0 ? Number(args[flag + 1]) : 0;
const [topicsPath, aliasesPath] = args.filter((a, i) => !a.startsWith("--") && (flag < 0 || i !== flag + 1));
if (!topicsPath || !aliasesPath) {
  console.error("usage: node scripts/merge-wiki-topics.mjs <topics.csv> <aliases.csv> [--min-lift N]");
  process.exit(1);
}

const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const topics = parseCsv(readFileSync(topicsPath, "utf8"));
const aliases = new Map();
for (const a of parseCsv(readFileSync(aliasesPath, "utf8"))) {
  if (a.ambiguous === "1" || !a.alias || a.alias === a.topic) continue;
  if (!aliases.has(a.qid)) aliases.set(a.qid, new Set());
  aliases.get(a.qid).add(a.alias);
}

const out = ["hop_distance,topic,aliases,qid,seeds,lift_lcb_max"];
let kept = 0, dropped = 0;
for (const t of topics) {
  const seed = t.hop_distance === "0";
  if (!seed && !(Number(t.lift_lcb_max) >= minLift)) { dropped++; continue; }
  kept++;
  out.push([t.hop_distance, t.topic, [...(aliases.get(t.qid) || [])].join(" | "), t.qid, t.seeds, t.lift_lcb_max].map(csvCell).join(","));
}
mkdirSync("research/topics/wiki", { recursive: true });
writeFileSync("research/topics/wiki/topics-merged.csv", out.join("\n") + "\n");
console.log(`${kept} topics kept, ${dropped} below lift ${minLift} → research/topics/wiki/topics-merged.csv`);
