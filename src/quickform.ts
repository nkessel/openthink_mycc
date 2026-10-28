// Fill it in on the map, send it with the Google Form (10/15 meeting): the + menu opens a short form here, with
// the group picked from a list as you type, and "Continue" opens the real Google Form with every answer already
// filled in, so the last step is just Submit. Nothing is sent from the site itself; sign-in, access checks and the
// review queue stay exactly as they are (Google Forms + apps-script/Code.gs).
import FIELDS from "./forms.fields.json";
import type { DataFile, GraphNode } from "./types";
import { FORMS } from "./forms.config";
import { coalitionLabel, orgLabel } from "./fab";
import { h } from "./dom";

type Field = { entry: string; type: number; choices?: string[] };
const forms = FIELDS as Record<string, Record<string, Field>>;
type Kind = "org" | "event" | "project" | "action";

const TITLES: Record<Kind, string> = {
  org: "Update an organization",
  event: "Add an event",
  project: "Add a project",
  action: "Add an action or volunteer opportunity",
};
// Questions that need no answer when adding something new from the map.
const SKIP = (t: string) => /^Remove from the map/.test(t);
const URL_BUDGET = 7000;

let data: DataFile | null = null;
export function setQuickFormData(d: DataFile): void {
  data = d;
}

/** Opens the on-map form. Returns false when this kind has no form fields (the caller then links straight to Google). */
export function openQuickForm(kind: Kind, context: GraphNode | null): boolean {
  const fields = forms[kind];
  const base = FORMS[kind]?.url;
  if (!fields || !base || !data) return false;

  const inputs: { title: string; f: Field; get: () => string[] }[] = [];
  const body = h("div", { class: "qf-body" });
  const orgNames = data.organizations.map((o) => orgLabel(o)).sort((a, b) => a.localeCompare(b));
  const listId = `qf-orgs-${kind}`;
  body.appendChild(h("datalist", { id: listId }, ...orgNames.map((n) => h("option", { value: n }))));

  for (const [title, f] of Object.entries(fields)) {
    if (SKIP(title)) continue;
    const isWhich = /^Which /.test(title);
    if (isWhich && kind !== "org") {
      // adding from the map: always "➕ Add a new …"
      const v = f.choices?.[0] ?? "";
      inputs.push({ title, f, get: () => (v ? [v] : []) });
      continue;
    }
    const row = h("label", { class: "qf-row" }, h("span", { class: "qf-label" }, title));
    let get: () => string[];
    if (f.type === 1) {
      const ta = h("textarea", { rows: "3" }) as HTMLTextAreaElement;
      row.appendChild(ta);
      get = () => [ta.value.trim()];
    } else if ((f.type === 2 || f.type === 3) && f.choices?.length) {
      const sel = h("select", {}, h("option", { value: "" }, "—"), ...f.choices.map((c) => h("option", { value: c }, c))) as HTMLSelectElement;
      if (title === "Coalition" && context?.kind === "coalition") sel.value = coalitionLabel(context);
      row.appendChild(sel);
      get = () => [sel.value];
    } else if (f.type === 4 && f.choices?.length) {
      const box = h("div", { class: "qf-checks" });
      const checks = f.choices.map((c) => {
        const cb = h("input", { type: "checkbox", value: c }) as HTMLInputElement;
        box.appendChild(h("label", { class: "qf-check" }, cb, h("span", {}, c)));
        return cb;
      });
      row.appendChild(box);
      get = () => checks.filter((c) => c.checked).map((c) => c.value);
    } else {
      const type = f.type === 9 ? "date" : f.type === 10 ? "time" : "text";
      const inp = h("input", { type }) as HTMLInputElement;
      // the group: picked from the list as you type (the same names the form matches)
      if (title === "Organization" || (kind === "org" && isWhich)) {
        inp.setAttribute("list", listId);
        inp.setAttribute("autocomplete", "off");
        if (context?.kind === "org") inp.value = orgLabel(context);
      }
      row.appendChild(inp);
      get = () => [inp.value.trim()];
    }
    body.appendChild(row);
    inputs.push({ title, f, get });
  }

  const note = h("p", { class: "qf-note" }, "Only what you fill in is sent; blanks keep what's already on the map. You'll sign in with Google and press Submit on the last page.");
  const go = h("button", { type: "button", class: "qf-go" }, "Continue to the Google Form →") as HTMLButtonElement;
  const cancel = h("button", { type: "button", class: "qf-cancel" }, "Cancel");
  const direct = h("a", { class: "qf-direct", href: base, target: "_blank", rel: "noopener" }, "or open the empty form");
  const dialog = h("div", { class: "qf", role: "dialog", "aria-modal": "true", "aria-label": TITLES[kind] },
    h("div", { class: "qf-head" }, h("h2", {}, TITLES[kind])), body, note,
    h("div", { class: "qf-foot" }, cancel, direct, go));
  const shade = h("div", { class: "qf-shade" }, dialog);
  const close = () => shade.remove();
  cancel.addEventListener("click", close);
  shade.addEventListener("click", (e) => { if (e.target === shade) close(); });
  shade.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });
  go.addEventListener("click", async () => {
    const params = new URLSearchParams();
    const tooLong: string[] = [];
    for (const { title, f, get } of inputs) {
      for (const v of get()) {
        if (!v) continue;
        const next = `${base}?${params.toString()}&${f.entry}=${encodeURIComponent(v)}`;
        if (next.length > URL_BUDGET) { tooLong.push(`${title}:\n${v}`); continue; }
        params.append(f.entry, v);
      }
    }
    params.set("usp", "pp_url");
    if (tooLong.length) {
      // a long description won't fit in a link: copy it so it can be pasted into the form
      try { await navigator.clipboard.writeText(tooLong.join("\n\n")); } catch { /* no clipboard */ }
      alertLong(tooLong.length);
    }
    window.open(`${base}${base.includes("?") ? "&" : "?"}${params.toString()}`, "_blank", "noopener");
    close();
  });
  document.body.appendChild(shade);
  (body.querySelector("input:not([type=hidden]), textarea, select") as HTMLElement | null)?.focus();
  return true;
}

function alertLong(n: number) {
  const t = h("div", { class: "update-note", role: "status" }, h("span", {}, `${n === 1 ? "One answer was" : `${n} answers were`} too long for the link: copied, paste it into the form.`));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
}
