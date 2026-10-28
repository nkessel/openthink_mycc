// "Money & opposition" layer (Oct 28: financial flows and oppositional groups on the Oregon map).
// Off by default; a switch in Map settings turns it on for maps that have public/money/<map>.json
// (built by scripts/build-money.mjs from research/money/<map>/). When on:
//  - groups on the public record against climate bills join the map in their own colour, each with the dated,
//    linked record of what it opposed (no edit links: they aren't part of the coalition sheet);
//  - one "Oregon Legislature" node receives every group's registered lobbying spending;
//  - money is drawn as arrows, thicker for more money (lobbying 2021–2025 totals; documented political money).
import type { DataFile, Organization } from "./types";
import type { MapId } from "./maps";
import { h } from "./dom";

export type FlowKind = "lobbying" | "political" | "grant";
export interface MoneyFlow {
  from: string;
  to: string;
  kind: FlowKind;
  amount: number;
  approx?: boolean;
  years?: Record<string, number>;
  date?: string;
  what: string;
  source: string;
}
export interface Stance { what: string; date: string; source: string }
interface MoneyFile {
  generated_at: string;
  hub: { id: string; name: string; abbrev: string };
  opposition: (Organization & { stances: Stance[]; lobbying: { years: Record<string, number>; total: number } | null })[];
  flows: MoneyFlow[];
}

/** Maps that have a money file. */
const MONEY_MAPS: MapId[] = ["or"];
const KEY = "openthink.money.v1";

export const moneyAvailable = (map: MapId) => MONEY_MAPS.includes(map);
export function moneyOn(map: MapId): boolean {
  if (!moneyAvailable(map)) return false;
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "[]") as string[]).includes(map);
  } catch {
    return false;
  }
}
function setMoneyOn(map: MapId, on: boolean) {
  try {
    const s = new Set(JSON.parse(localStorage.getItem(KEY) || "[]") as string[]);
    if (on) s.add(map); else s.delete(map);
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch { /* private mode: lasts for this page only */ }
}

let flows: MoneyFlow[] = [];
const stances = new Map<string, Stance[]>();
let generated = "";
/** The money arrows to draw (empty when the layer is off). */
export const moneyFlows = () => flows;
/** What a group opposed, with sources (opposition groups only). */
export const stancesOf = (id: string) => stances.get(id);
/** Every flow into or out of a group. */
export const flowsOf = (id: string) => flows.filter((f) => f.from === id || f.to === id);

/** Adds the layer's groups to the map data when it is switched on. Nothing is fetched otherwise. */
export async function attachMoney(data: DataFile, map: MapId): Promise<boolean> {
  if (!moneyOn(map)) return false;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}money/${map}.json`);
    if (!res.ok) return false;
    const m = (await res.json()) as MoneyFile;
    generated = m.generated_at;
    const ids = new Set([...data.coalitions, ...data.organizations].map((n) => n.id));
    const base = { coalition_ids: [] as string[], last_activity: m.generated_at, projects: [], events: [], actions: [] };
    for (const o of m.opposition) {
      if (ids.has(o.id)) continue;
      const { stances: st, lobbying: _l, ...org } = o;
      data.organizations.push({ ...base, ...org, sector: "opposition", profile: { geo_precision: "approx" } });
      stances.set(o.id, st);
      ids.add(o.id);
    }
    data.organizations.push({
      ...base, id: m.hub.id, name: m.hub.name, abbrev: m.hub.abbrev, type: "legislature", geographic_focus: "Salem",
      description: "Where registered lobbying money goes. Each arrow is one group's lobbying spending, 2021–2025, from the Oregon Government Ethics Commission's records.",
      lat: 44.9386, lng: -123.0301, website: "https://www.oregonlegislature.gov", sector: "money-hub", remote: true,
    });
    flows = m.flows.filter((f) => ids.has(f.from) || f.from === m.hub.id).filter((f) => ids.has(f.to) || f.to === m.hub.id);
    return true;
  } catch (err) {
    console.warn("Money & opposition layer could not be loaded:", err);
    return false;
  }
}

export const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, "")}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

/** The group's record in the details pane: what it opposed, and the money in and out, each with its source. */
export function moneyDetails(id: string, nameOf: (id: string) => string): HTMLElement | null {
  const st = stancesOf(id);
  const fl = flowsOf(id);
  if (!st && !fl.length) return null;
  const box = h("div", { class: "money-details" });
  if (st?.length) {
    box.appendChild(h("div", { class: "money-head" }, "On the record against"));
    const ul = h("ul", { class: "money-list" });
    for (const s of [...st].sort((a, b) => b.date.localeCompare(a.date)))
      ul.appendChild(h("li", {}, h("span", { class: "money-date" }, s.date.slice(0, 7)), " ", s.what, " ", h("a", { href: s.source, target: "_blank", rel: "noopener noreferrer" }, "source")));
    box.appendChild(ul);
  }
  if (fl.length) {
    box.appendChild(h("div", { class: "money-head" }, "Money"));
    const ul = h("ul", { class: "money-list" });
    for (const f of [...fl].sort((a, b) => b.amount - a.amount)) {
      const out = f.from === id;
      const who = nameOf(out ? f.to : f.from);
      const years = f.years ? ` (${Object.entries(f.years).filter(([, v]) => v).map(([y, v]) => `${y}: ${money(v)}`).join(", ")})` : "";
      ul.appendChild(h("li", {}, h("strong", {}, `${f.approx ? "about " : ""}${money(f.amount)}`), ` ${out ? "to" : "from"} ${who}. ${f.what}${years}. `,
        h("a", { href: f.source, target: "_blank", rel: "noopener noreferrer" }, "source")));
    }
    box.appendChild(ul);
  }
  box.appendChild(h("div", { class: "money-note" }, `Money & opposition layer, sources checked ${generated}.`));
  return box;
}

/** The switch in Map settings (only on maps with money data). Reloads the map when flipped. */
export function createMoneySection(parent: HTMLElement, map: MapId): HTMLElement | null {
  if (!moneyAvailable(map)) return null;
  const on = moneyOn(map);
  const row = h("div", { class: "control toggle-row money-toggle" });
  const label = h("label", { class: "ctrl-label" }, "Money & opposition");
  const sw = h("button", { type: "button", class: `switch ${on ? "on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": "Show money and opposition" }, h("span", { class: "knob" }));
  sw.addEventListener("click", () => {
    setMoneyOn(map, !on);
    try { sessionStorage.setItem("openthink.quickboot", "1"); } catch { /* ignore */ }
    location.reload();
  });
  row.append(label, sw);
  const hint = h("div", { class: "ctrl-hint" },
    "Groups on the public record against climate bills, in red, and money as arrows (thicker = more): lobbying 2021–2025 and documented political spending. Every figure links to its source.");
  const box = h("div", { class: "money-section" }, row, hint);
  parent.appendChild(box);
  return box;
}
