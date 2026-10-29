// "Money & opposition" layer (Oct 28: financial flows and oppositional groups on the Oregon map).
// Off by default; a switch in Map settings turns it on for maps that have public/money/<map>.json
// (built by scripts/build-money.mjs from research/money/<map>/). When on:
//  - groups on the public record against climate bills join the map in their own colour, each with the dated,
//    linked record of what it opposed (no edit links: they aren't part of the coalition sheet);
//  - one "Oregon Legislature" node receives every group's registered lobbying spending;
//  - money is drawn as arrows, thicker for more money (lobbying totals from 2021 on; documented political money).
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
  /** "2023Q1" → amount: Oregon's lobbying reports are quarterly, and spending peaks while the legislature is in session. */
  quarters?: Record<string, number>;
  date?: string;
  what: string;
  source: string;
}
export interface Stance { what: string; date: string; source: string }
type Side = "Support" | "Oppose" | "Neutral";
export interface BillPosition { side: Side; id?: string; name?: string; date: string; docs: string[]; lobbying_year: number }
export interface Bill {
  id: string; year: string; short: string; catchline: string; outcome: string; url: string; testimony_url: string;
  positions: BillPosition[];
  /** Filings for organizations we can't name (or for people), by side: counted, never listed. */
  other: Record<Side, number>;
  /** Every testimony on the bill (people and organizations), by position. */
  all: Record<string, number>;
  /** What the named groups on each side spent lobbying that year, on all issues (each lobbying client counted once). */
  money: Record<Side, number>;
}
interface MoneyFile {
  generated_at: string;
  /** "2021–2026", and the latest quarter reported ("2026 Q3"), or the year when it's complete. */
  period?: string;
  through?: string;
  hub: { id: string; name: string; abbrev: string };
  opposition: (Organization & { stances: Stance[]; lobbying: { years: Record<string, number>; total: number } | null })[];
  flows: MoneyFlow[];
  bills?: Bill[];
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
let bills: Bill[] = [];
let hubId = "";
let period = "2021–2025";
let through = "2025";
const periodText = () => (through.includes("Q") ? `${period} (through ${through})` : period);
/** Key climate & energy bills, newest first, with who testified for and against (empty when the layer is off). */
export const moneyBills = () => bills;
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
    period = m.period || period;
    through = m.through || through;
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
      description: `Where registered lobbying money goes. Each arrow is one group's lobbying spending, ${periodText()}, from the Oregon Government Ethics Commission's records.`,
      lat: 44.9386, lng: -123.0301, website: "https://www.oregonlegislature.gov", sector: "money-hub", remote: true,
    });
    bills = (m.bills || []).slice().sort((a, b) => b.year.localeCompare(a.year) || a.id.localeCompare(b.id));
    hubId = m.hub.id;
    flows = m.flows.filter((f) => ids.has(f.from) || f.from === m.hub.id).filter((f) => ids.has(f.to) || f.to === m.hub.id);
    return true;
  } catch (err) {
    console.warn("Money & opposition layer could not be loaded:", err);
    return false;
  }
}

export const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, "")}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

const link = (href: string, text: string) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
const SIDE_LABEL: Record<Side, string> = { Support: "For", Oppose: "Against", Neutral: "Neutral" };

/** Quarterly lobbying as a row of small bars, 2021 Q1 to 2025 Q4, with the session quarters marked. */
function quarterBars(q: Record<string, number>): HTMLElement {
  const keys: string[] = [];
  const [y0, y1] = period.split("–").map(Number);
  const lastQ = through.includes("Q") ? Number(through.slice(-1)) : 4;
  for (let y = y0; y <= y1; y++) for (let i = 1; i <= (y === y1 ? lastQ : 4); i++) keys.push(`${y}Q${i}`);
  const max = Math.max(1, ...keys.map((k) => q[k] || 0));
  const W = 6, G = 2, H = 34;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${keys.length * (W + G)} ${H + 12}`);
  svg.setAttribute("class", "money-quarters");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Lobbying spending by quarter, ${periodText()}`);
  keys.forEach((k, i) => {
    const v = q[k] || 0, hh = Math.max(v ? 1.5 : 0, (v / max) * H);
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", String(i * (W + G))); r.setAttribute("y", String(H - hh));
    r.setAttribute("width", String(W)); r.setAttribute("height", String(hh));
    r.setAttribute("class", "bar");
    const t = document.createElementNS(ns, "title");
    t.textContent = `${k.replace("Q", " Q")}: ${money(v)}`;
    r.appendChild(t);
    svg.appendChild(r);
    if (k.endsWith("Q1")) {
      const tx = document.createElementNS(ns, "text");
      tx.setAttribute("x", String(i * (W + G))); tx.setAttribute("y", String(H + 10));
      tx.textContent = `'${k.slice(2, 4)}`;
      svg.appendChild(tx);
    }
  });
  return h("div", { class: "money-quarters-wrap" }, svg);
}

/** One group's testimony on the bills (both sides), newest first. */
function testimonyOf(id: string): { bill: Bill; p: BillPosition }[] {
  const out: { bill: Bill; p: BillPosition }[] = [];
  for (const b of bills) for (const p of b.positions) if (p.id === id) out.push({ bill: b, p });
  return out;
}

/** The legislature's view: each bill, who testified on each side, and what those groups spent lobbying that year. */
function billsSection(nameOf: (id: string) => string, open?: (id: string) => void): HTMLElement {
  const box = h("div", { class: "money-bills" });
  box.appendChild(h("div", { class: "money-head" }, `Climate & energy bills, ${bills.length ? `${bills.at(-1)!.year}–${bills[0].year}` : period}`));
  box.appendChild(h("div", { class: "money-note" },
    "Organizations that testified for or against each bill, from the legislature's site. The dollar figure is what the named groups on each side spent on lobbying that year, on all issues: Oregon's lobbying reports don't say which bills the money was for. “Against” doesn't always mean against climate action: some groups opposed a bill for not going far enough (Multnomah County on HB 4100, for example), so read the testimony."));
  for (const b of bills) {
    const named = (s: Side) => b.positions.filter((p) => p.side === s);
    const count = (s: Side) => named(s).length + (b.other[s] || 0);
    const passed = /^Passed/.test(b.outcome);
    const sum = h("summary", {},
      h("span", { class: "bill-id" }, b.id), " ", h("span", { class: "bill-short" }, b.short), " ",
      h("span", { class: `bill-outcome ${passed ? "passed" : "failed"}` }, passed ? "Passed" : "Did not pass"));
    const tally = h("div", { class: "bill-tally" },
      h("span", { class: "for" }, `For: ${count("Support")} orgs · ${money(b.money.Support)}`),
      h("span", { class: "against" }, `Against: ${count("Oppose")} orgs · ${money(b.money.Oppose)}`));
    // A bar comparing the two sides' lobbying that year.
    const tot = b.money.Support + b.money.Oppose;
    const bar = tot ? h("div", { class: "bill-bar", title: `Lobbying that year by the named groups: for ${money(b.money.Support)}, against ${money(b.money.Oppose)}` },
      h("span", { class: "for", style: `width:${(100 * b.money.Support) / tot}%` }), h("span", { class: "against", style: `width:${(100 * b.money.Oppose) / tot}%` })) : null;
    const body = h("div", { class: "bill-body" }, h("div", { class: "bill-catch" }, b.catchline));
    for (const s of ["Oppose", "Support", "Neutral"] as Side[]) {
      const list = named(s);
      if (!list.length && !b.other[s]) continue;
      body.appendChild(h("div", { class: `bill-side ${s.toLowerCase()}` }, `${SIDE_LABEL[s]} (${count(s)})`));
      const ul = h("ul", { class: "money-list" });
      for (const p of list) {
        const nm = p.id ? nameOf(p.id) : p.name || "";
        const who: HTMLElement = p.id && open
          ? (() => { const a = h("button", { type: "button", class: "money-org" }, nm); a.addEventListener("click", () => open(p.id!)); return a; })()
          : h("span", {}, nm);
        ul.appendChild(h("li", {}, who, p.lobbying_year ? h("span", { class: "money-amt" }, ` · ${money(p.lobbying_year)} lobbying in ${b.year}`) : null, " ",
          ...p.docs.slice(0, 2).map((d, i) => link(d, i ? "more" : "testimony")).flatMap((a, i) => (i ? [" ", a] : [a]))));
      }
      if (b.other[s]) ul.appendChild(h("li", { class: "money-more" }, `+ ${b.other[s]} other filing${b.other[s] === 1 ? "" : "s"} for an organization or person we don't list`));
      body.appendChild(ul);
    }
    const all = b.all || {};
    body.appendChild(h("div", { class: "money-note" },
      `All testimony: ${all.Support || 0} for, ${all.Oppose || 0} against, ${all.Neutral || 0} neutral (people and organizations). `,
      link(b.testimony_url, "Read it all"), " · ", link(b.url, "Bill page")));
    box.appendChild(h("details", { class: "bill" }, sum, tally, bar, body));
  }
  return box;
}

/** The group's record in the details pane: what it opposed, its testimony on the bills, and the money, each with its source. */
export function moneyDetails(id: string, nameOf: (id: string) => string, open?: (id: string) => void): HTMLElement | null {
  const st = stancesOf(id);
  const fl = flowsOf(id);
  const tm = testimonyOf(id);
  const isHub = id === hubId && bills.length > 0;
  if (!st && !fl.length && !tm.length && !isHub) return null;
  const box = h("div", { class: "money-details" });
  if (st?.length) {
    box.appendChild(h("div", { class: "money-head" }, "On the record against"));
    const ul = h("ul", { class: "money-list" });
    for (const s of [...st].sort((a, b) => b.date.localeCompare(a.date)))
      ul.appendChild(h("li", {}, h("span", { class: "money-date" }, s.date.slice(0, 7)), " ", s.what, " ", link(s.source, "source")));
    box.appendChild(ul);
  }
  if (tm.length) {
    box.appendChild(h("div", { class: "money-head" }, "Testimony on climate & energy bills"));
    const ul = h("ul", { class: "money-list" });
    for (const { bill, p } of tm)
      ul.appendChild(h("li", {}, h("span", { class: `money-pos ${p.side.toLowerCase()}` }, SIDE_LABEL[p.side]), " ",
        h("strong", {}, bill.id), ` ${bill.short} (${/^Passed/.test(bill.outcome) ? "passed" : "did not pass"}). `,
        ...(p.docs[0] ? [link(p.docs[0], "testimony")] : [])));
    box.appendChild(ul);
  }
  if (fl.length && !isHub) {
    box.appendChild(h("div", { class: "money-head" }, "Money"));
    const ul = h("ul", { class: "money-list" });
    for (const f of [...fl].sort((a, b) => b.amount - a.amount)) {
      const out = f.from === id;
      const who = nameOf(out ? f.to : f.from);
      const years = f.years ? ` (${Object.entries(f.years).filter(([, v]) => v).map(([y, v]) => `${y}: ${money(v)}`).join(", ")})` : "";
      ul.appendChild(h("li", {}, h("strong", {}, `${f.approx ? "about " : ""}${money(f.amount)}`), ` ${out ? "to" : "from"} ${who}. ${f.what}${years}. `,
        link(f.source, "source"), f.quarters ? quarterBars(f.quarters) : null));
    }
    box.appendChild(ul);
  }
  if (isHub) {
    // The legislature: biggest lobbying spenders first, then the bills.
    const ul = h("ul", { class: "money-list" });
    box.appendChild(h("div", { class: "money-head" }, `Lobbying spending, ${periodText()}`));
    for (const f of [...fl].sort((a, b) => b.amount - a.amount))
      ul.appendChild(h("li", {}, h("strong", {}, money(f.amount)), " ", (() => {
        const nm = nameOf(f.from);
        if (!open) return h("span", {}, nm);
        const a = h("button", { type: "button", class: "money-org" }, nm); a.addEventListener("click", () => open(f.from)); return a;
      })()));
    box.appendChild(ul);
    box.appendChild(billsSection(nameOf, open));
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
    "Groups on the public record against climate bills, in red, and money as arrows (thicker = more): lobbying from 2021 on, how groups testified on climate bills, and documented political spending. Every figure links to its source.");
  const box = h("div", { class: "money-section" }, row, hint);
  parent.appendChild(box);
  return box;
}
