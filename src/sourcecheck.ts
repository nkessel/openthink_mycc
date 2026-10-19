// Only verified items on the map (Oct 18): every event, project and action needs a public web page that names it.
//  - src/source-check.json holds the results of the last check of every item's page
//    (research/verification/*.csv): moved links, changed dates and reworded names are corrected, and items whose
//    page is gone, never named them, or exists only in an email are left off.
//  - Then any item with no web link (link, or an event's RSVP link) is left off too.
// The sheet menu "Apply the source check" makes the same changes in the sheet; after that this changes nothing.
import type { DataFile } from "./types";
import CHECK from "./source-check.json";

const remove = new Set<string>(CHECK.remove);
const fix = CHECK.fix as Record<string, Record<string, string>>;
const hasPage = (u?: string | null) => !!u && /^https?:\/\/\S+\.\S+/.test(u.trim());
const clean = <T extends { id: string; link?: string | null; rsvp_link?: string | null }>(xs: T[] | undefined): T[] | undefined =>
  xs
    ?.filter((x) => !remove.has(x.id))
    .map((x) => (fix[x.id] ? { ...x, ...fix[x.id] } : x))
    .filter((x) => hasPage(x.link) || hasPage(x.rsvp_link));

export function checkSources(d: DataFile): DataFile {
  for (const g of [...d.coalitions, ...d.organizations]) {
    if (g.events) g.events = clean(g.events)!;
    if (g.projects) g.projects = clean(g.projects)!;
    if (g.actions) g.actions = clean(g.actions)!;
  }
  return d;
}
