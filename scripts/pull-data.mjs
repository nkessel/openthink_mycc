// Pull the latest map data from the Openthink Google Sheet into public/data.json.
//
//   OPENTHINK_DATA_URL="https://script.google.com/macros/s/…/exec" npm run pull-data
//
// The URL is the Apps Script web app from apps-script/Code.gs (Deploy → Web app).
// It only serves the public tabs — never Feedback or Change Log.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const url = process.env.OPENTHINK_DATA_URL || process.argv[2];
if (!url) {
  console.error("Set OPENTHINK_DATA_URL (or pass the web app URL as an argument).");
  process.exit(1);
}

const res = await fetch(url, { redirect: "follow" });
if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
const data = await res.json();
for (const key of ["coalitions", "organizations", "edges"]) {
  if (!Array.isArray(data[key])) throw new Error(`Response is missing "${key}" — is this the right URL?`);
}

const out = fileURLToPath(new URL("../public/data.json", import.meta.url));
writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
const count = (k) => data.coalitions.reduce((n, c) => n + c[k].length, 0);
console.log(
  `Wrote ${out}: ${data.coalitions.length} coalitions, ${data.organizations.length} orgs, ` +
    `${count("projects")} projects, ${count("events")} events.`,
);
