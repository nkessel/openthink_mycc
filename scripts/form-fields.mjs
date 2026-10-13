// Reads the live Google Forms (URLs in src/forms.config.ts) and writes src/forms.fields.json: for each form,
// every question's title → its "entry.N" id and choices. The site uses it to open a form with every current
// answer filled in (src/prefill.ts). Re-run after changing questions on the forms:  node scripts/form-fields.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const config = readFileSync("src/forms.config.ts", "utf8");
const urlOf = (kind) => new RegExp(`${kind}: \\{\\s*url: "([^"]+)"`).exec(config)?.[1];
const out = {};
for (const kind of ["org", "event", "project", "action"]) {
  const url = urlOf(kind);
  if (!url) continue;
  const html = execFileSync("curl", ["-sL", "-m", "30", url], { encoding: "utf8", maxBuffer: 20e6 });
  const m = /FB_PUBLIC_LOAD_DATA_ = (.*?);<\/script>/s.exec(html);
  if (!m) throw new Error(`${kind}: form data not found (is the form public?)`);
  const items = JSON.parse(m[1])[1][1] || [];
  const fields = {};
  for (const it of items) {
    const [, title, , type, qs] = it;
    // type 7 = grid (the old "Organizations you work with" rows): one entry per row, never pre-filled
    if (!qs || type === 7 || fields[title]) continue;
    const q = qs[0];
    let choices = (q.length > 1 && q[1] ? q[1] : []).map((c) => c[0]).filter(Boolean);
    // "Which event is this about?" lists every item; only its first choice ("➕ Add a new …") is needed here
    if (/^Which /.test(title)) choices = choices.slice(0, 1);
    fields[title] = { entry: `entry.${q[0]}`, type, ...(choices.length ? { choices } : {}) };
  }
  out[kind] = fields;
}
writeFileSync("src/forms.fields.json", JSON.stringify(out, null, 1) + "\n");
console.log(Object.entries(out).map(([k, f]) => `${k}: ${Object.keys(f).length} questions`).join(", "));
