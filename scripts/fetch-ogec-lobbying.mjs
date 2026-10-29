// Lobbying spending by client and quarter from the Oregon Government Ethics Commission's public records lookup
// (apps.oregon.gov/OGEC/EFS/Records → Expenditures → Lobbyist Client), for the money & opposition layer.
//   node scripts/fetch-ogec-lobbying.mjs 2026 [2025 …]   → updates those years in research/money/or/ogec-lobbying.csv
// Contact names in the records are never kept: only the client (organization) and its quarterly amounts.
// A client listed under several contacts appears once per filer id; identical repeats are counted once.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseCsvText } from "./csv.mjs";
// Playwright may be installed globally (not a project dependency), so load it the CommonJS way (honours NODE_PATH).
const { chromium } = createRequire(import.meta.url)("playwright");

const OUT = "research/money/or/ogec-lobbying.csv";
const years = process.argv.slice(2);
if (!years.length) throw new Error("Give one or more years, e.g. 2026");

async function fetchYear(year) {
  const b = await chromium.launch();
  const p = await b.newPage();
  const grids = [];
  p.on("response", async (r) => { if (/GetGridData|GetTempGrid/.test(r.url())) { try { grids.push(await r.json()); } catch { /* not JSON */ } } });
  await p.goto("https://apps.oregon.gov/OGEC/EFS/Records", { waitUntil: "networkidle", timeout: 60000 });
  await p.selectOption("#ResultType", "Expenditures");
  await p.selectOption("#FilerType", "LobbyistClient");
  await p.selectOption("#FromYear", String(year));
  await p.selectOption("#Quarter", "0");
  await p.click("text=Generate Report");
  await p.waitForTimeout(5000);
  const dd = p.locator(".actionBar .dropdown-toggle, .actions .dropdown-toggle").first();
  if (await dd.count()) { await dd.click(); await p.locator('.dropdown-menu a:has-text("All")').first().click().catch(() => {}); await p.waitForTimeout(6000); }
  await b.close();
  const byFiler = new Map();
  for (const r of grids.flatMap((g) => g.rows || [])) byFiler.set(`${r.BusinessName}|${r.FilerID}`, r);
  const byClient = new Map();
  for (const r of byFiler.values()) {
    const c = byClient.get(r.BusinessName) || { year: String(year), client: r.BusinessName, q1: 0, q2: 0, q3: 0, q4: 0, total: 0 };
    c.q1 += r.Q1Exp || 0; c.q2 += r.Q2Exp || 0; c.q3 += r.Q3Exp || 0; c.q4 += r.Q4Exp || 0; c.total += r.TotalExpenditures || 0;
    byClient.set(r.BusinessName, c);
  }
  return [...byClient.values()];
}

const old = existsSync(OUT) ? parseCsvText(readFileSync(OUT, "utf8")) : [];
let rows = old.filter((r) => !years.includes(r.year));
for (const y of years) {
  const got = await fetchYear(y);
  console.log(y, got.length, "clients,", got.filter((r) => r.total > 0).length, "with spending");
  if (!got.length) throw new Error(`No rows for ${y}; the records page may have changed`);
  rows.push(...got);
}
rows.sort((a, b) => a.year.localeCompare(b.year) || a.client.localeCompare(b.client));
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(OUT, "year,client,q1,q2,q3,q4,total\n" + rows.map((r) => [r.year, r.client, r.q1, r.q2, r.q3, r.q4, r.total].map(csv).join(",")).join("\n") + "\n");
