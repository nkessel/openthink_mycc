// Floating "+" button: opens the Google Forms for proposing edits and additions.
// When an org or coalition is open in the drawer, the forms open pre-filled with it.
import type { Coalition, GraphNode, Organization } from "./types";
import { FORMS, type FormLink } from "./forms.config";
import { h } from "./dom";
import { currentMap } from "./maps";

export type FormKind = keyof typeof FORMS;

// Must match the dropdown labels built by buildLabelIndex_ in apps-script/Code.gs:
// plain names, with " [id]" added only when two orgs share a name.
let sharedOrgNames = new Set<string>();
export function setFormLabelData(orgs: Organization[]): void {
  const seen = new Set<string>();
  sharedOrgNames = new Set();
  for (const o of orgs) (seen.has(o.name) ? sharedOrgNames : seen).add(o.name);
}
export const orgLabel = (o: Organization) => (sharedOrgNames.has(o.name) ? `${o.name} [${o.id}]` : o.name);

// Events, projects and actions are labelled the same way as the form's "Which … is this about?" lists
// (LABEL_BASE_ in apps-script/Code.gs): events "Name — Mon D, YYYY", others just the name; " [id]" is added
// only when two items of that kind share a label.
type Item = { id: string; name: string; date?: string; sheet_date?: string };
const sharedItemLabels: Record<string, Set<string>> = { event: new Set(), project: new Set(), action: new Set() };
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function itemBase(kind: "event" | "project" | "action", it: Item): string {
  if (kind !== "event") return it.name;
  const raw = it.sheet_date || it.date || "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return `${it.name} — ${m ? `${SHORT_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : raw}`;
}
export function setItemLabelData(nodes: { events?: Item[]; projects?: Item[]; actions?: Item[] }[]): void {
  for (const kind of ["event", "project", "action"] as const) {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const n of nodes) {
      for (const it of (n[`${kind}s` as "events" | "projects" | "actions"] || []) as Item[]) {
        const b = itemBase(kind, it);
        (seen.has(b) ? shared : seen).add(b);
      }
    }
    sharedItemLabels[kind] = shared;
  }
}
export function itemLabel(kind: "event" | "project" | "action", it: Item): string {
  const b = itemBase(kind, it);
  return sharedItemLabels[kind].has(b) ? `${b} [${it.id}]` : b;
}
export const coalitionLabel = (c: Coalition) => (c.abbrev ? `${c.name} (${c.abbrev})` : c.name);

/** Form URL, pre-filled for the given org/coalition when possible. null = forms not set up. */
export function formUrl(kind: FormKind, context: GraphNode | null = null, item: Item | null = null): string | null {
  // Only Massachusetts has its own forms + sheet; elsewhere every suggestion goes to the feedback form.
  if (!currentMap.editable) return FORMS.feedback.url || null;
  // Sector layers (src/sectors.ts) aren't in the sheet yet, so there's nothing to edit through a form.
  if (kind !== "feedback" && (context as { sector?: string } | null)?.sector) return null;
  const f: FormLink = FORMS[kind];
  if (!f.url) return null;
  const params = new URLSearchParams();
  if (context?.kind === "org") {
    const entry = kind === "org" ? f.orgEntry : f.hostOrgEntry;
    if (entry) params.set(entry, orgLabel(context));
  } else if (context?.kind === "coalition" && f.coalitionEntry) {
    params.set(f.coalitionEntry, coalitionLabel(context));
  }
  if (item && f.itemEntry && (kind === "event" || kind === "project" || kind === "action")) params.set(f.itemEntry, itemLabel(kind, item));
  if (![...params.keys()].length) return f.url;
  params.set("usp", "pp_url");
  return `${f.url}${f.url.includes("?") ? "&" : "?"}${params.toString()}`;
}

export function createFab(parent: HTMLElement, getContext: () => GraphNode | null): void {
  const wrap = h("div", { class: "fab-wrap" });
  const menu = h("div", { class: "fab-menu", role: "menu" });
  const btn = h(
    "button",
    { class: "fab", "aria-label": "Suggest an edit or addition", "aria-expanded": "false", title: "Suggest an edit or addition" },
    "+",
  );
  wrap.appendChild(menu);
  wrap.appendChild(btn);
  parent.appendChild(wrap);

  const setOpen = (open: boolean) => {
    wrap.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (open) render();
  };

  function item(kind: FormKind, label: string, hint: string): HTMLElement {
    const url = formUrl(kind, getContext());
    const el = url
      ? h("a", { class: "fab-item", href: url, target: "_blank", rel: "noopener", role: "menuitem" })
      : h("div", { class: "fab-item disabled", role: "menuitem", "aria-disabled": "true" });
    el.appendChild(h("span", { class: "fab-item-label" }, label));
    el.appendChild(h("span", { class: "fab-item-hint" }, url ? hint : "Form not connected yet"));
    el.addEventListener("click", () => setOpen(false));
    return el;
  }

  function render() {
    menu.replaceChildren();
    if (!currentMap.editable) {
      menu.appendChild(item("feedback", "Suggest a correction or addition", `The ${currentMap.name} map isn't connected to its own forms yet`));
      menu.appendChild(item("feedback", "Send feedback", "Bugs, ideas, questions"));
      return;
    }
    const ctx = getContext();
    const org = ctx?.kind === "org" ? ctx : null;
    const coalition = ctx?.kind === "coalition" ? ctx : null;
    const where = org ? ` · ${org.abbrev || org.name}` : coalition ? ` · ${coalition.abbrev}` : "";
    menu.appendChild(
      item("org", org ? `Update ${org.abbrev || org.name}` : "Add or update an organization",
        "Fill in what's missing or out of date"),
    );
    menu.appendChild(item("event", "Add or edit an event", `Public events${where}`));
    menu.appendChild(item("project", "Add or edit a project", `Projects that need help${where}`));
    menu.appendChild(item("action", "Add or edit an action or volunteer opportunity", `Ways for people to help${where}`));
    menu.appendChild(item("feedback", "Send feedback", "Bugs, ideas, questions"));
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!wrap.classList.contains("open"));
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
}
