// Only verified events on the map (Oct 18): every event needs a link to a public page that names it.
//  - An event with no web link (link or RSVP link) is left off the map.
//  - src/event-check.json holds the results of the last check of every event's page
//    (research/events/verification-2026-10-18.csv): events whose page is gone or never mentioned them are left
//    off, and moved links / changed dates are corrected. The sheet menu "Apply the event check" makes the same
//    changes in the sheet itself; after that this list changes nothing.
import type { DataFile } from "./types";
import CHECK from "./event-check.json";

const remove = new Set<string>(CHECK.remove);
const fix = CHECK.fix as Record<string, { link?: string; date?: string }>;
const hasPage = (u?: string | null) => !!u && /^https?:\/\/\S+\.\S+/.test(u.trim());

export function checkEvents(d: DataFile): DataFile {
  for (const g of [...d.coalitions, ...d.organizations]) {
    if (!g.events?.length) continue;
    g.events = g.events
      .filter((e) => !remove.has(e.id) && (hasPage(e.link) || hasPage(e.rsvp_link)))
      .map((e) => (fix[e.id] ? { ...e, ...fix[e.id] } : e));
  }
  return d;
}
