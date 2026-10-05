// What counts as past, and the one setting (Map settings → "Show past events, projects and actions") that shows
// past items everywhere. Off by default: past items then live only in a "Past" section of each group's details pane.
import type { Action, CoalitionEvent, Project } from "./types";
import { hasTime, parseEventDate } from "./util";

const KEY = "openthink.showPast";
const today = () => new Date().toISOString().slice(0, 10);

export function isPastEvent(e: CoalitionEvent): boolean {
  if (e.recurrence) return false;
  const t = parseEventDate(e.end || e.date).getTime() + (hasTime(e.end || e.date) ? 0 : 86400000);
  return Number.isFinite(t) && t < Date.now();
}
export const isPastAction = (a: Action): boolean => !!a.deadline && a.deadline.slice(0, 10) < today();
export const isPastProject = (p: Project): boolean => p.status === "completed";
export function isPast(kind: "event" | "project" | "action", x: CoalitionEvent | Project | Action): boolean {
  return kind === "event" ? isPastEvent(x as CoalitionEvent) : kind === "project" ? isPastProject(x as Project) : isPastAction(x as Action);
}

export function showPast(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setShowPast(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("openthink:showpast", { detail: { on } }));
}
/** The items to show outside a group's details pane: current ones, or all of them when the setting is on. */
export function shown<T extends CoalitionEvent | Project | Action>(kind: "event" | "project" | "action", list: T[]): T[] {
  return showPast() ? list : list.filter((x) => !isPast(kind, x));
}
