// Expands the free-text `recurrence` of an event ("Every other Thursday", "Third Wednesday of each month")
// into concrete days for the calendar. Returns null when the text isn't a pattern we understand;
// the calendar then shows only the event's next date.

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export interface Rule {
  weekday: number;
  /** "weekly", "biweekly", or the nth weekday of the month (-1 = last). */
  kind: "weekly" | "biweekly" | "nth" | "daily";
  nth?: number;
  skipMonths: number[];
  /** Only this month (annual events). */
  onlyMonth?: number;
}

export function parseRecurrence(text: string): Rule | null {
  const t = text.toLowerCase();
  if (/^(every day|daily)\b/.test(t)) return { weekday: -1, kind: "daily", skipMonths: [] };
  if (/\bnext\b.*\b(mon|tue|wed|thu|fri|sat|sun)/.test(t) && !/\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\b/.test(t)) return null;
  const wd = DAYS.findIndex((d) => t.includes(d));
  if (wd < 0) return null;
  const skipMonths: number[] = [];
  const no = t.match(/\bno ([a-z, ]+?) (?:or ([a-z]+) )?meetings?/);
  if (no) for (const m of [no[1], no[2]]) { const i = MONTHS.indexOf((m || "").trim()); if (i >= 0) skipMonths.push(i); }
  const ord = t.match(/\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(?:sun|mon|tues|wednes|thurs|fri|satur)day/);
  if (ord) {
    const rule: Rule = { weekday: wd, kind: "nth", nth: ORD[ord[1]], skipMonths };
    const am = t.startsWith("annual") ? MONTHS.findIndex((m) => t.includes(m)) : -1;
    if (am >= 0) rule.onlyMonth = am;
    return rule;
  }
  const ord2 = t.match(/every\s+(\d)(?:st|nd|rd|th)\s+/);
  if (ord2) return { weekday: wd, kind: "nth", nth: Number(ord2[1]), skipMonths };
  if (/every other|biweekly|every two weeks/.test(t)) return { weekday: wd, kind: "biweekly", skipMonths };
  if (/monthly|month/.test(t) && !/every\s+\w*day/.test(t)) return null;
  return { weekday: wd, kind: "weekly", skipMonths };
}

/** Does the rule fall on `day`? Only days on or after the next occurrence (`anchor`) count. */
export function occursOn(rule: Rule, anchor: Date, day: Date): boolean {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  if (rule.kind === "daily") return d >= a;
  if (d < a || d.getDay() !== rule.weekday) return false;
  if (rule.skipMonths.includes(d.getMonth())) return false;
  if (rule.onlyMonth !== undefined && d.getMonth() !== rule.onlyMonth) return false;
  if (rule.kind === "weekly") return true;
  const days = Math.round((d.getTime() - a.getTime()) / 86400000);
  if (rule.kind === "biweekly") return days % 14 === 0;
  const n = Math.floor((d.getDate() - 1) / 7) + 1;
  if (rule.nth === -1) return d.getDate() + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return n === rule.nth;
}

/**
 * Recurring events are stored with the date of one occurrence, which goes stale ("Every Wednesday" still
 * dated last Wednesday). Move each one forward to its next occurrence so the map, lists and calendar all
 * show an upcoming date. Events whose pattern we can't read are left as they are.
 */
export function rollRecurringForward(events: { date: string; sheet_date?: string; end?: string; recurrence?: string }[], now = new Date()): void {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const e of events) {
    if (!e.recurrence) continue;
    const rule = parseRecurrence(e.recurrence);
    if (!rule) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/.exec(e.date);
    if (!m) continue;
    const anchor = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (anchor >= today) continue;
    for (let i = 0; i < 400; i++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      if (!occursOn(rule, anchor, day)) continue;
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      e.sheet_date = e.sheet_date || e.date;
      e.date = iso(day) + (m[4] || "");
      if (e.end && /^\d{4}-\d{2}-\d{2}T/.test(e.end)) e.end = iso(day) + e.end.slice(10);
      break;
    }
  }
}
