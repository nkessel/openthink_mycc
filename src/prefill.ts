// Fills in every answer the map already knows when someone opens a form to edit an organization, event,
// project or action, so they only change what's different. Question ids come from src/forms.fields.json
// (scripts/form-fields.mjs reads them off the live forms). A blank answer keeps the current value in the sheet,
// so anything we can't fill safely (unknown yes/no answers, private fields, text too long for a link) is left blank.
import type { Action, Coalition, CoalitionEvent, DataFile, GraphNode, Organization, Project } from "./types";
import FIELDS from "./forms.fields.json";

type Field = { entry: string; type: number; choices?: string[] };
type FormFields = Record<string, Field>;
const forms = FIELDS as Record<string, FormFields>;

let coalitions: Coalition[] = [];
export function setPrefillData(data: DataFile): void {
  coalitions = data.coalitions;
}

/** Same as the sheet script's slug_(): tags are stored as slugs of the checkbox labels. */
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const humanize = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Organization types as the sheet stores them (ORG_TYPES in apps-script/Code.gs).
const ORG_TYPES: Record<string, string> = {
  "501c3": "Nonprofit — 501(c)(3)", "501c4": "Nonprofit — 501(c)(4)", volunteer: "Volunteer group", youth_org: "Youth organization",
  school_club: "School club", university: "College / university group", faith_org: "Faith community", professional: "Professional association",
  union: "Union", media: "Media", regional_gov: "Government / regional body",
};

/** A whole form link stays well under the length browsers and Google accept. */
const URL_BUDGET = 7000;

class Answers {
  params = new URLSearchParams();
  constructor(private f: FormFields, private base: string) {}
  private room(extra: string): boolean {
    return this.base.length + this.params.toString().length + encodeURIComponent(extra).length + 40 < URL_BUDGET;
  }
  text(title: string, v: string | undefined | null) {
    const q = this.f[title];
    const s = (v ?? "").trim();
    if (!q || !s || !this.room(s)) return; // too long for a link: left blank, so the sheet keeps it as it is
    this.params.set(q.entry, s);
  }
  /** One of the question's choices (exact, else the same words ignoring case). */
  choice(title: string, v: string | undefined | null) {
    const q = this.f[title];
    if (!q || !v) return;
    const hit = q.choices?.find((c) => c === v) ?? q.choices?.find((c) => c.toLowerCase() === v.toLowerCase());
    if (hit) this.params.set(q.entry, hit);
  }
  /** Ticks every matching checkbox; returns the values that matched none. */
  checks(title: string, values: string[], match: (choice: string, v: string) => boolean): string[] {
    const q = this.f[title];
    if (!q) return values;
    const left: string[] = [];
    for (const v of values) {
      const hit = q.choices?.find((c) => match(c, v));
      if (hit) this.params.append(q.entry, hit);
      else left.push(v);
    }
    return left;
  }
  yesNo(title: string, v: boolean | undefined) {
    if (v === undefined) return; // unknown: let the person answer
    this.choice(title, v ? "Yes" : "No");
  }
  /** Topic tags: ticked where a checkbox matches, the rest typed into "More topics". */
  topics(tags: string[] | undefined) {
    const left = this.checks("Climate topic tags", tags || [], (c, t) => slug(c) === t);
    const more = Object.keys(this.f).find((t) => t.startsWith("More topics"));
    if (more && left.length) this.text(more, left.map(humanize).join(", "));
  }
}

const datePart = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "");
const timePart = (iso?: string | null) => (iso && /T(\d{2}:\d{2})/.exec(iso)?.[1]) || "";
const coalitionLabelOf = (c: Coalition) => (c.abbrev ? `${c.name} (${c.abbrev})` : c.name);

/**
 * Extra answers for a form link (the Organization / Coalition / "Which …" questions are filled by formUrl);
 * `copy` makes a new item from an existing one (an event that happens again): "Add a new …" and no date.
 */
export function prefill(
  kind: "org" | "event" | "project" | "action",
  base: string,
  node: GraphNode | null,
  item: CoalitionEvent | Project | Action | null,
  copy = false,
): URLSearchParams | null {
  const f = forms[kind];
  if (!f) return null;
  const a = new Answers(f, base);
  if (kind === "org" && node?.kind === "org") {
    const o = node as Organization;
    a.text("Organization name", o.name);
    a.text("Short name or abbreviation", o.abbrev);
    a.checks("Type of organization", String(o.type || "").split(/[,;]\s*/).filter(Boolean), (c, t) => c === (ORG_TYPES[t] ?? t));
    a.text("Mission statement and description", o.description);
    a.text("Town or region you focus on", o.geographic_focus);
    a.checks("Coalitions you belong to", o.coalition_ids || [], (c, id) => {
      const co = coalitions.find((x) => x.id === id);
      return !!co && c === coalitionLabelOf(co);
    });
    a.topics(o.topic_tags);
    a.choice("About how many active members do you have?", o.profile?.membership_size);
    a.text("Website", o.website);
    if (o.logo && /^https?:/.test(o.logo)) a.text("Logo image link", o.logo);
    a.text("Public contact information", o.public_contact);
    return a.params;
  }
  if (!item) return a.params;
  const which = Object.keys(f).find((t) => t.startsWith("Which "));
  if (copy && which) a.choice(which, f[which].choices?.[0]);
  if (kind === "event") {
    const e = item as CoalitionEvent;
    a.text("Event name", e.name);
    a.text("Event description", e.description);
    if (!copy) a.text("Date", datePart(e.date));
    a.text("Start time", timePart(e.date));
    a.text("End time", timePart(e.end));
    a.text("Does it repeat? (leave blank for a one-time event)", e.recurrence);
    a.text("Location", e.location);
    a.yesNo("Is this online or remote?", e.online ? true : e.location ? false : undefined);
    a.topics(e.topic_tags);
    if (e.free_food) a.choice("Is free food provided?", "Yes");
    if (e.affiliated_only) a.choice("Who can come / take part?", "Affiliated members only");
    a.text("Link (website, RSVP, or info page)", e.link || e.rsvp_link);
    a.text("Public contact information", e.public_contact);
  } else if (kind === "project") {
    const p = item as Project;
    a.text("Project name", p.name);
    a.text("Project description", p.description);
    a.choice("Status", p.status);
    a.checks("Skills or help needed", p.skills_needed || [], (c, s) => c.toLowerCase() === s.toLowerCase());
    a.text("Location", p.location);
    a.yesNo("Is this online or remote?", p.online ? true : p.location ? false : undefined);
    a.topics(p.topic_tags);
    if (p.free_food) a.choice("Is free food provided?", "Yes");
    if (p.affiliated_only) a.choice("Who can come / take part?", "Affiliated members only");
    a.yesNo("Are you looking for help with this?", p.help_wanted);
    a.text("Link (website, RSVP, or info page)", p.link);
    a.text("Public contact information", p.public_contact);
  } else {
    const x = item as Action;
    a.text("Action or opportunity name", x.name);
    a.text("What people can do", x.description);
    const types = f["Type"]?.choices || [];
    a.choice("Type", x.kind === "role" ? types[1] : types[0]);
    a.choice("Urgency", x.urgency);
    a.text("Deadline (leave blank if none)", datePart(x.deadline));
    a.checks("Skills or help needed", x.skills_needed || [], (c, s) => c.toLowerCase() === s.toLowerCase());
    a.text("Link (website, RSVP, or info page)", x.link);
  }
  return a.params;
}

/** The form's own question ids, which replace the stale ones in forms.config.ts when the two differ. */
export function liveEntry(kind: string, title: string): string | undefined {
  return forms[kind]?.[title]?.entry;
}
