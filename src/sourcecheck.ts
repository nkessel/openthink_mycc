// Only verified items on the map (Oct 18): every event, project and action needs a public web page that names it.
//  - src/source-check.json holds the results of the last check of every item's page
//    (research/verification/*.csv): moved links, changed dates and reworded names are corrected, and items whose
//    page is gone, never named them, or exists only in an email are left off.
//  - Then any item with no web link (link, or an event's RSVP link) is left off too.
//  - `add` lists checked items that aren't in the sheet yet (e.g. MYCC's ways to get involved, from its public
//    Linktree); they're added to their group if it doesn't already have them.
// The sheet menu "Apply the source check" makes the same changes in the sheet; after that this changes nothing.
import type { Action, CoalitionEvent, DataFile, Project } from "./types";
import CHECK from "./source-check.json";

const remove = new Set<string>(CHECK.remove);
const fix = CHECK.fix as Record<string, Record<string, string>>;
const hasPage = (u?: string | null) => !!u && /^https?:\/\/\S+\.\S+/.test(u.trim());
type Adds = { events?: CoalitionEvent[]; projects?: Project[]; actions?: Action[] };
const add = ((CHECK as { add?: Record<string, Adds> }).add ?? {}) as Record<string, Adds>;
/** An added item that the sheet already has (e.g. with older wording) takes the checked wording and link. */
const addById = new Map<string, Record<string, unknown>>(
  Object.values(add).flatMap((a) => [...(a.events ?? []), ...(a.projects ?? []), ...(a.actions ?? [])].map((x) => [x.id, x as unknown as Record<string, unknown>])),
);
const clean = <T extends { id: string; link?: string | null; rsvp_link?: string | null }>(xs: T[] | undefined): T[] | undefined =>
  xs
    ?.filter((x) => !remove.has(x.id))
    .map((x) => (fix[x.id] || addById.has(x.id) ? { ...x, ...addById.get(x.id), ...fix[x.id] } : x))
    .filter((x) => hasPage(x.link) || hasPage(x.rsvp_link));

/** Group fields the check corrected (e.g. MYCC's website → its own Linktree, where people join). */
const groups = ((CHECK as { groups?: Record<string, Record<string, string>> }).groups ?? {});

export function checkSources(d: DataFile): DataFile {
  for (const g of [...d.coalitions, ...d.organizations]) {
    if (groups[g.id]) Object.assign(g, groups[g.id]);
    const more = add[g.id];
    if (more) {
      const has = new Set([...(g.events ?? []), ...(g.projects ?? []), ...(g.actions ?? [])].map((x) => x.id));
      if (more.events?.length) g.events = [...(g.events ?? []), ...more.events.filter((x) => !has.has(x.id))];
      if (more.projects?.length) g.projects = [...(g.projects ?? []), ...more.projects.filter((x) => !has.has(x.id))];
      if (more.actions?.length) g.actions = [...(g.actions ?? []), ...more.actions.filter((x) => !has.has(x.id))];
    }
    if (g.events) g.events = clean(g.events)!;
    if (g.projects) g.projects = clean(g.projects)!;
    if (g.actions) g.actions = clean(g.actions)!;
  }
  return d;
}
