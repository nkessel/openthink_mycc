// Turns a fork of the MA Climate Organization Map into an empty starting point for another region.
// Run it once in your fork (see guide.html → "Start a map for your region"):
//
//   node scripts/start-new-region.mjs            shows what it would change (nothing is touched)
//   node scripts/start-new-region.mjs --yes      makes the changes
//
// It keeps all the code, the topic lists and the geography files, and removes Massachusetts's data:
//   - public/data.json becomes an empty map (no coalitions, groups or links)
//   - Massachusetts logos, the researched Vermont/Oregon maps, the money layer, the social justice layers,
//     research notes and the MA team's work log are deleted
//   - src/region.config.ts: extraMaps = false (only your map is shown)
//   - src/data.config.ts: LIVE_DATA_URL = "" (until you publish your own sheet's web app)
//   - src/forms.config.ts: the Massachusetts form links are cleared
// Afterwards it lists the files you still edit by hand.
import { existsSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const go = process.argv.includes("--yes");
const done = [];
const act = (what, fn) => {
  done.push(what);
  if (go) fn();
};

const EMPTY = { generated_at: new Date().toISOString(), coalitions: [], organizations: [], edges: [], org_links: [] };
act("public/data.json → an empty map", () => writeFileSync("public/data.json", JSON.stringify(EMPTY, null, 1) + "\n"));
act("public/thoughts.json → empty", () => writeFileSync("public/thoughts.json", "{}\n"));

if (existsSync("public/logos")) {
  const logos = readdirSync("public/logos");
  act(`public/logos/: delete ${logos.length} Massachusetts logos`, () => {
    for (const f of logos) rmSync(join("public/logos", f), { recursive: true, force: true });
    writeFileSync("public/logos/.gitkeep", "");
  });
}
for (const dir of ["public/maps", "public/money", "public/sectors", "research", "data-review"]) {
  if (existsSync(dir)) act(`${dir}/: delete (Massachusetts-only research and layers)`, () => rmSync(dir, { recursive: true, force: true }));
}
for (const f of readdirSync(".").filter((f) => /_LLM\.log$/.test(f))) {
  act(`${f}: delete (the MA team's work log)`, () => rmSync(f));
}

const edit = (file, from, to, what) => {
  const s = readFileSync(file, "utf8");
  if (!from.test(s)) return;
  act(`${file}: ${what}`, () => writeFileSync(file, s.replace(from, to)));
};
edit("src/region.config.ts", /extraMaps:\s*true/, "extraMaps: false", "extraMaps = false (only your map)");
edit("src/forms.config.ts", /url: "https:\/\/docs\.google\.com\/forms\/[^"]*"/g, 'url: ""', "clear the Massachusetts form links (the + button says the forms aren't connected yet)");
edit("src/data.config.ts", /export const LIVE_DATA_URL =\s*"[^"]*";/, 'export const LIVE_DATA_URL = "";', 'LIVE_DATA_URL = "" (until your web app is published)');

console.log(go ? "Done:" : "Would do (run again with --yes to make these changes):");
for (const d of done) console.log("  - " + d);
console.log(`
Still to edit by hand (guide.html → "Start a map for your region"):
  - src/region.config.ts      your map's name, state, time zone, map bounds and main city
  - apps-script/Code.gs       REGION at the top, and SEED_URL = '' to start the sheet empty
  - index.html                the page title and the land acknowledgement
  - src/data.config.ts        your web app URL, once it is published
  - src/forms.config.ts       your forms' links (from the sheet's Start Here tab)
  - GitHub Settings → Pages    your custom domain, if you have one (otherwise <you>.github.io/<repo>)
  - README.md                 your map's name`);
