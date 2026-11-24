// The map's own form (Nov 23, boards 89.2 / 90 / 91 / 92.1): the + menu and the "Edit this …" buttons open it here
// instead of a Google Form. Essentials first, "＋ Add more details" for the rest; the review page's pieces (end-time
// list, location suggestions, topic pills, toggles). Signed in (src/auth.ts), "Add to map" sends it straight to the
// sheet script, which runs the same access checks and review queue as the Google Forms (apps-script/SignIn.gs). Not
// signed in, "Send with email" emails a login link that sends it. The Google Form stays as a small backup link,
// opened with every answer filled in.
import FIELDS from "./forms.fields.json";
import type { Action, CoalitionEvent, DataFile, GraphNode, Organization, Project } from "./types";
import { FORMS } from "./forms.config";
import { formUrl, orgLabel } from "./fab";
import { h } from "./dom";
import { attachPlaceSuggest } from "./placeSuggest";
import { emailBox, googleButton, googleEnabled, onSessionChange, session, signOut, submitSignedIn, type Answers } from "./auth";

type Field = { entry: string; type: number; choices?: string[] };
const forms = FIELDS as Record<string, Record<string, Field>>;
type Kind = "org" | "event" | "project" | "action";
type Item = CoalitionEvent | Project | Action;

const NOUN: Record<Kind, string> = { org: "organization", event: "event", project: "project", action: "action or volunteer opportunity" };
const SKIP = (t: string) => /^Remove from the map/.test(t);
const URL_BUDGET = 7000;

// Friendlier labels than the Google Form's question titles. Anything not listed keeps its title.
const LABEL: Record<string, string> = {
  "Event name": "Event name", "Event description": "What's it about?", "Project description": "What's it about?",
  "What people can do": "What can people do?", "Action or opportunity name": "Name",
  "Link (website, RSVP, or info page)": "Link (website, RSVP or info page)", "Public contact information": "Public contact (email or phone)",
  "Climate topic tags": "Topics", "Does it repeat? (leave blank for a one-time event)": "Repeats", Location: "Where", "Skills or help needed": "Skills or help needed", "Deadline (leave blank if none)": "Deadline",
  "Mission statement and description": "About the group", "Town or region you focus on": "Town or region you focus on",
  "Headquarters address or town (for the map pin)": "Address or town (for the map pin)", "Coalitions you belong to": "Coalitions",
  "About how many active members do you have?": "Active members", "Point person — phone (optional)": "Point person — phone",
};
const MORE_TOPICS = (t: string) => t.startsWith("More topics");
// Shown before "＋ Add more details" (everything else goes under it).
const ESSENTIAL: Record<Kind, RegExp> = {
  event: /^(Organization|Event name|Date|Start time|End time|Does it repeat|Location|Is this online)/,
  project: /^(Organization|Project name|Project description|Status|Location|Is this online)/,
  action: /^(Organization|Action or opportunity name|What people can do|Type|Deadline)/,
  org: /^(Organization name|Mission statement|Website|Headquarters|Climate topic tags|More topics)/,
};
// Yes/No questions shown as a single toggle: [label, value when on, value when off].
const TOGGLES: Record<string, [string, string, string]> = {
  "Is this online or remote?": ["Online", "Yes", "No"],
  "Is free food provided?": ["Free food", "Yes", "No"],
  "Who can come / take part?": ["Members only", "Affiliated members only", "Open to the public"],
  "Are you looking for help with this?": ["Looking for help", "Yes", "No"],
};

let data: DataFile | null = null;
export function setQuickFormData(d: DataFile): void {
  data = d;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const clock = (m: number) => { const hh = Math.floor(m / 60) % 24, mm = m % 60; return `${hh % 12 || 12}:${pad(mm)} ${hh < 12 ? "AM" : "PM"}`; };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = ["", "1st", "2nd", "3rd", "4th", "5th"];

/**
 * Opens the map's form. `item` edits that event/project/action (or, with `copy`, adds a new one like it); with no
 * item it adds a new one. For an organization with no group open, the group is picked first. Returns false when this
 * kind has no form fields (the caller then follows its link to the Google Form).
 */
export function openQuickForm(kind: Kind, context: GraphNode | null, item: Item | null = null, opts: { copy?: boolean } = {}): boolean {
  const fields = forms[kind];
  const base = FORMS[kind]?.url;
  if (!fields || !base || !data) return false;
  const editing = !!item && !opts.copy;
  const orgs = data.organizations;
  const orgByLabel = new Map(orgs.map((o) => [orgLabel(o), o] as const));

  // Everything the map already knows, as the Google Form link would carry it: entry id -> values.
  const known = new Map<string, string[]>();
  const learn = (ctx: GraphNode | null) => {
    known.clear();
    const url = formUrl(kind, ctx, item as never, opts);
    if (!url) return;
    for (const [k, v] of new URL(url).searchParams) if (k.startsWith("entry.")) known.set(k, [...(known.get(k) || []), v]);
  };
  learn(context);

  const inputs: { title: string; f: Field; get: () => string[]; set: (v: string[]) => void }[] = [];
  const essentials = h("div", { class: "qf-sec" });
  const extras = h("div", { class: "qf-sec qf-extras" });
  extras.hidden = true;
  const body = h("div", { class: "qf-body" }, essentials);
  const listId = `qf-orgs-${kind}`;
  body.appendChild(h("datalist", { id: listId }, ...orgs.map((o) => h("option", { value: orgLabel(o) }))));
  const titles = Object.keys(fields).filter((t) => !SKIP(t));
  const label = (t: string) => LABEL[t] ?? t;

  // ---- the group (org forms: "Which organization…"; others: "Organization")
  const groupTitle = kind === "org" ? titles.find((t) => /^Which /.test(t))! : "Organization";
  const groupInput = h("input", { type: "text", list: listId, autocomplete: "off", placeholder: "Start typing a group's name" }) as HTMLInputElement;
  const groupChip = h("button", { type: "button", class: "qf-chip", title: "Change group" });
  const groupBox = h("div", { class: "qf-row" }, h("span", { class: "qf-label" }, kind === "org" ? "Which group?" : "Group"), groupChip, groupInput);
  const showGroup = (o: Organization | null) => {
    groupChip.hidden = !o;
    groupInput.hidden = !!o;
    groupInput.value = o ? orgLabel(o) : groupInput.value;
    if (o) groupChip.replaceChildren(h("span", {}, o.name), h("span", { class: "qf-x", "aria-hidden": "true" }, "✕"));
  };
  groupChip.addEventListener("click", () => { showGroup(null); groupInput.value = ""; groupInput.focus(); lock(); });
  const startOrg = context?.kind === "org" ? (context as Organization) : null;
  essentials.appendChild(groupBox);
  inputs.push({ title: groupTitle, f: fields[groupTitle], get: () => [groupInput.value.trim()], set: () => {} });
  // Editing an item: its host group, as formUrl filled it in.
  const hostVal = known.get(fields[groupTitle]?.entry)?.[0];
  showGroup(startOrg ?? (hostVal ? orgByLabel.get(hostVal) ?? null : null));
  if (!startOrg && hostVal && !orgByLabel.get(hostVal)) groupInput.value = hostVal;

  // "Which event/project/action…": the item being edited, or "➕ Add a new …".
  const whichTitle = kind !== "org" ? titles.find((t) => /^Which /.test(t)) : undefined;
  if (whichTitle) {
    const v = known.get(fields[whichTitle].entry)?.[0] || (editing ? "" : fields[whichTitle].choices?.[0] ?? "");
    inputs.push({ title: whichTitle, f: fields[whichTitle], get: () => (v ? [v] : []), set: () => {} });
  }

  // ---- every other question
  const rows = new Map<string, HTMLElement>();
  let endSel: HTMLSelectElement | null = null, startIn: HTMLInputElement | null = null, dateIn: HTMLInputElement | null = null, repeatSel: HTMLSelectElement | null = null;
  const togglesRow = (where: HTMLElement) => {
    let r = where.querySelector(":scope > .qf-toggles") as HTMLElement | null;
    if (!r) { r = h("div", { class: "qf-toggles" }); where.appendChild(r); }
    return r;
  };
  for (const title of titles) {
    if (title === groupTitle || title === whichTitle) continue;
    const f = fields[title];
    const where = ESSENTIAL[kind].test(title) || (kind === "org" && MORE_TOPICS(title)) ? essentials : extras;
    let row: HTMLElement | null = h("label", { class: "qf-row" }, h("span", { class: "qf-label" }, label(title)));
    let get: () => string[];
    let set: (v: string[]) => void;
    if (TOGGLES[title]) {
      const [txt, on, off] = TOGGLES[title];
      const b = h("button", { type: "button", class: "qf-tog", "aria-pressed": "false" }, txt) as HTMLButtonElement;
      let touched = false;
      b.addEventListener("click", () => { touched = true; b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); });
      get = () => (touched ? [b.getAttribute("aria-pressed") === "true" ? on : off] : []);
      set = (v) => { b.setAttribute("aria-pressed", String(v[0] === on)); };
      togglesRow(title === "Is this online or remote?" ? (rows.get("Location") ?? where) : where).appendChild(b);
      row = null;
    } else if (f.type === 1) {
      const ta = h("textarea", { rows: "3" }) as HTMLTextAreaElement;
      row.appendChild(ta);
      get = () => [ta.value.trim()]; set = (v) => { ta.value = v[0] ?? ""; };
    } else if (f.type === 4 && f.choices?.length) {
      // checkboxes -> pills (topics, skills, types, coalitions)
      const box = h("div", { class: "qf-pills" });
      const pills = f.choices.map((c) => {
        const p = h("button", { type: "button", class: "qf-pill", "aria-pressed": "false" }, c) as HTMLButtonElement;
        p.addEventListener("click", () => p.setAttribute("aria-pressed", String(p.getAttribute("aria-pressed") !== "true")));
        box.appendChild(p);
        return p;
      });
      if (pills.length > 12) {
        // long lists (topics, skills): the first dozen, then "+ N more"
        const rest = pills.slice(12);
        rest.forEach((p) => (p.hidden = true));
        const all = h("button", { type: "button", class: "qf-pill qf-all" }, `+ ${rest.length} more`);
        all.addEventListener("click", () => { rest.forEach((p) => (p.hidden = false)); all.remove(); });
        box.appendChild(all);
      }
      row = h("div", { class: "qf-row" }, h("span", { class: "qf-label" }, label(title)), box);
      get = () => pills.filter((p) => p.getAttribute("aria-pressed") === "true").map((p) => p.textContent || "");
      set = (v) => pills.forEach((p) => { const on = v.includes(p.textContent || ""); p.setAttribute("aria-pressed", String(on)); if (on) p.hidden = false; });
    } else if ((f.type === 2 || f.type === 3) && f.choices?.length && f.choices.length <= 5) {
      // a few choices -> one-of pills (tap again to clear)
      const box = h("div", { class: "qf-pills" });
      const pills = f.choices.map((c) => {
        const p = h("button", { type: "button", class: "qf-pill one", "aria-pressed": "false" }, c) as HTMLButtonElement;
        p.addEventListener("click", () => { const was = p.getAttribute("aria-pressed") === "true"; pills.forEach((x) => x.setAttribute("aria-pressed", "false")); p.setAttribute("aria-pressed", String(!was)); });
        box.appendChild(p);
        return p;
      });
      row = h("div", { class: "qf-row" }, h("span", { class: "qf-label" }, label(title)), box);
      get = () => pills.filter((p) => p.getAttribute("aria-pressed") === "true").map((p) => p.textContent || "");
      set = (v) => pills.forEach((p) => p.setAttribute("aria-pressed", String(v[0] === p.textContent)));
    } else if ((f.type === 2 || f.type === 3) && f.choices?.length) {
      const sel = h("select", {}, h("option", { value: "" }, "—"), ...f.choices.map((c) => h("option", { value: c }, c))) as HTMLSelectElement;
      row.appendChild(sel);
      get = () => [sel.value]; set = (v) => { sel.value = v[0] ?? ""; };
    } else if (title === "End time") {
      endSel = h("select", {}) as HTMLSelectElement;
      row.appendChild(endSel);
      get = () => [endSel!.value]; set = (v) => { endSel!.dataset.want = v[0] ?? ""; fillEnd(); };
    } else if (/^Does it repeat/.test(title)) {
      repeatSel = h("select", {}) as HTMLSelectElement;
      const other = h("input", { type: "text", placeholder: "e.g. every Tuesday except in summer", hidden: "" }) as HTMLInputElement;
      repeatSel.addEventListener("change", () => { other.hidden = repeatSel!.value !== "other"; if (!other.hidden) other.focus(); });
      row.append(repeatSel, other);
      get = () => [repeatSel!.value === "other" ? other.value.trim() : repeatSel!.value];
      set = (v) => { fillRepeat(v[0] ?? ""); if (repeatSel!.value === "other") { other.hidden = false; other.value = v[0] ?? ""; } };
    } else {
      const type = f.type === 9 ? "date" : f.type === 10 ? "time" : /email/i.test(title) ? "email" : /phone/i.test(title) ? "tel" : /Website|Link|link$/.test(title) ? "url" : "text";
      const inp = h("input", { type }) as HTMLInputElement;
      if (title === "Location" || /^Headquarters/.test(title)) { row.appendChild(inp); attachPlaceSuggest(inp); }
      else row.appendChild(inp);
      if (title === "Date") dateIn = inp;
      if (title === "Start time") startIn = inp;
      get = () => [inp.value.trim()]; set = (v) => { inp.value = v[0] ?? ""; };
    }
    if (row) { where.appendChild(row); rows.set(title, row); }
    inputs.push({ title, f, get, set });
  }

  // When: date, start time and end time side by side, then "Does it repeat?"
  if (dateIn && startIn && endSel) {
    const when = h("div", { class: "qf-row" }, h("span", { class: "qf-label" }, "When"));
    const line = h("div", { class: "qf-when" }, dateIn, startIn, endSel);
    when.appendChild(line);
    const dRow = rows.get("Date")!;
    dRow.replaceWith(when);
    rows.get("Start time")?.remove();
    rows.get("End time")?.remove();
    startIn.setAttribute("aria-label", "Start time"); dateIn.setAttribute("aria-label", "Date"); endSel.setAttribute("aria-label", "End time");
    startIn.addEventListener("input", () => fillEnd());
    dateIn.addEventListener("input", () => fillRepeat(repeatSel?.value === "other" ? "other" : ""));
  }
  function fillEnd() {
    if (!endSel) return;
    const want = endSel.dataset.want ?? endSel.value;
    const s = startIn ? toMin(startIn.value) : null;
    const opts: [string, string][] = [["", "Ends…"]];
    if (s != null) for (let m = s + 30; m <= Math.min(s + 12 * 60, 24 * 60 - 1); m += 30) opts.push([fromMin(m), `until ${clock(m)} (${(m - s) / 60} h)`]);
    else for (let m = 6 * 60; m < 24 * 60; m += 30) opts.push([fromMin(m), `until ${clock(m)}`]);
    if (want && !opts.some(([v]) => v === want)) { const w = toMin(want); if (w != null) opts.push([want, `until ${clock(w)}`]); }
    endSel.replaceChildren(...opts.map(([v, t]) => h("option", { value: v }, t)));
    endSel.value = want || "";
    delete endSel.dataset.want;
  }
  function fillRepeat(want: string) {
    if (!repeatSel) return;
    const d = dateIn?.value ? new Date(`${dateIn.value}T12:00`) : null;
    const day = d ? DAYS[d.getDay()] : "";
    const nth = d ? Math.ceil(d.getDate() / 7) : 0;
    const opts: [string, string][] = [["", "Does not repeat"]];
    if (day) opts.push([`Every ${day}`, `Every ${day}`], [`Every other ${day}`, `Every other ${day}`], [`Every ${NTH[nth]} ${day} of the month`, `Every ${NTH[nth]} ${day} of the month`]);
    opts.push(["other", "Something else…"]);
    const keep = want || (repeatSel.value !== "other" ? repeatSel.value : "other");
    repeatSel.replaceChildren(...opts.map(([v, t]) => h("option", { value: v }, t)));
    repeatSel.value = opts.some(([v]) => v === keep) ? keep : keep ? "other" : "";
  }
  fillEnd();
  fillRepeat("");

  // Topic pills sit with "More topics" under them.
  const topicsRow = rows.get("Climate topic tags");
  const moreTitle = titles.find(MORE_TOPICS);
  if (topicsRow && moreTitle && rows.get(moreTitle)) {
    const more = rows.get(moreTitle)!;
    (more.querySelector(".qf-label") as HTMLElement).textContent = "More topics (separate with commas)";
    more.classList.add("qf-sub");
    topicsRow.after(more);
  }

  // Fill in what the map knows.
  const fill = () => { for (const i of inputs) { const v = known.get(i.f?.entry); if (v) i.set(v); } fillEnd(); };
  fill();

  // ---- "＋ Add more details"
  const names = Array.from(extras.querySelectorAll(":scope > .qf-row > .qf-label, :scope > .qf-toggles > .qf-tog")).map((x) => (x.textContent || "").replace(/ \(.*/, "")).slice(0, 5);
  const moreBtn = h("button", { type: "button", class: "qf-more" }, h("span", {}, "＋ Add more details"), h("small", {}, names.join(", ")));
  moreBtn.addEventListener("click", () => { moreBtn.remove(); extras.hidden = false; (extras.querySelector("input, textarea, select, button") as HTMLElement | null)?.focus(); });
  if (extras.childElementCount) body.append(moreBtn, extras);

  // ---- org form with no group: pick it first, then its details fill in
  const lockable = Array.from(body.children).filter((c) => c !== essentials && c.tagName !== "DATALIST") as HTMLElement[];
  const essentialRest = () => Array.from(essentials.children).filter((c) => c !== groupBox) as HTMLElement[];
  function lock() {
    if (kind !== "org") return;
    for (const el of [...essentialRest(), ...lockable]) { el.classList.add("qf-locked"); el.setAttribute("inert", ""); }
  }
  function unlock() {
    for (const el of [...essentialRest(), ...lockable]) { el.classList.remove("qf-locked"); el.removeAttribute("inert"); }
  }
  if (kind === "org" && !startOrg) lock();
  const pick = () => {
    const o = orgByLabel.get(groupInput.value.trim());
    if (!o) return;
    showGroup(o);
    if (kind === "org") { learn({ ...o, kind: "org" } as unknown as GraphNode); fill(); unlock(); (essentialRest()[0]?.querySelector("input, textarea") as HTMLElement | null)?.focus(); }
  };
  groupInput.addEventListener("change", pick);
  groupInput.addEventListener("input", pick); // picking from the list fires "input"

  // ---- answers, checks, footer
  const answers = (): Answers => {
    const out: Answers = {};
    for (const { title, f, get } of inputs) {
      const vals = get().filter(Boolean);
      if (vals.length) out[title] = f.type === 4 ? vals : vals[0];
    }
    return out;
  };
  const status = h("p", { class: "qf-status", role: "status", "aria-live": "polite" });
  const needs = (el: HTMLElement, msg: string) => {
    status.textContent = msg;
    el.classList.remove("qf-need"); void el.offsetWidth; el.classList.add("qf-need");
    el.addEventListener("input", () => el.classList.remove("qf-need"), { once: true });
    el.focus();
  };
  const nameTitle = titles.find((t) => /\bname\b/i.test(t) && !/^Which |Point person/.test(t));
  const check = (): boolean => {
    if (!groupInput.value.trim()) { needs(groupChip.hidden ? groupInput : groupChip, kind === "org" ? "Please pick the group first." : "Please pick the group this is for."); return false; }
    if (kind !== "org" && !editing && nameTitle && !answers()[nameTitle]) {
      const el = rows.get(nameTitle)?.querySelector("input") as HTMLElement | null;
      if (el) { needs(el, "Please add a name first."); return false; }
    }
    status.textContent = "";
    return true;
  };

  const note = h("p", { class: "qf-note" });
  const extra = h("div", { class: "qf-email" });
  extra.hidden = true;
  const foot = h("div", { class: "qf-foot" });
  const cancel = h("button", { type: "button", class: "qf-cancel" }, "Cancel");
  const send = h("button", { type: "button", class: "qf-go" }, "Send with email") as HTMLButtonElement;
  const submit = h("button", { type: "button", class: "qf-go" }, editing || kind === "org" ? "Save changes" : "Add to map") as HTMLButtonElement;
  const done = h("button", { type: "button", class: "qf-go" }, "Close") as HTMLButtonElement;
  const toGoogle = h("button", { type: "button", class: "qf-gf" }, "Prefer Google Forms? Open it with your answers →");
  const gfRow = h("div", { class: "qf-gfrow" }, toGoogle);
  let finished = false;

  function renderFoot() {
    if (finished) { note.replaceChildren(); extra.hidden = true; gfRow.hidden = true; foot.replaceChildren(done); done.focus(); return; }
    const s = session();
    if (s) {
      const out = h("button", { type: "button", class: "qf-link" }, "Sign out");
      out.addEventListener("click", () => signOut());
      note.replaceChildren(`Signed in as ${s.email} · `, out);
      extra.hidden = true;
      foot.replaceChildren(cancel, submit);
    } else {
      note.textContent = "Point people: we'll email you a link to confirm, then it goes straight onto the map.";
      foot.replaceChildren(cancel, send);
    }
  }

  const heading = editing ? `Edit ${kind === "action" ? "action" : NOUN[kind]}` : kind === "org" ? "Update an organization" : `Add ${kind === "event" ? "an" : "a"} ${kind === "action" ? "action" : NOUN[kind]}`;
  const sub = kind === "org" && !startOrg ? "Pick the group first; its current details fill in for you to change." : opts.copy ? "A new event with these details; pick its date." : "";
  const dialog = h("div", { class: "qf", role: "dialog", "aria-modal": "true", "aria-label": heading, tabindex: "-1" },
    h("div", { class: "qf-head" }, h("h2", {}, heading), ...(sub ? [h("p", { class: "qf-subtitle" }, sub)] : [])), body, note, extra, status, foot, gfRow);
  const shade = h("div", { class: "qf-shade" }, dialog);
  const stopWatching = onSessionChange(renderFoot);
  const close = () => {
    stopWatching();
    if (shade.classList.contains("closing")) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { shade.remove(); return; }
    shade.classList.add("closing");
    setTimeout(() => shade.remove(), 190);
  };
  cancel.addEventListener("click", close);
  done.addEventListener("click", close);
  shade.addEventListener("click", (e) => { if (e.target === shade) close(); });
  shade.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });

  send.addEventListener("click", () => {
    if (!check()) return;
    if (!extra.childElementCount) {
      const gbox = h("div", { class: "acct-google" });
      googleButton(gbox, (r) => { status.textContent = r.ok ? "" : r.error || "Google sign-in didn't work."; });
      extra.append(
        h("p", { class: "qf-note" }, "We'll email you a link. Open it and press Log in within 15 minutes: that sends this and keeps you signed in on that device for 30 days."),
        emailBox(status, () => ({ kind, answers: answers() }), () => { finished = true; renderFoot(); }),
        ...(googleEnabled() ? [h("span", { class: "acct-label" }, "Or sign in with Google, then press Add to map"), gbox] : []),
      );
    }
    extra.hidden = false;
    (extra.querySelector("input") as HTMLInputElement | null)?.focus();
  });

  submit.addEventListener("click", async () => {
    if (!check()) return;
    submit.disabled = true;
    status.textContent = "Sending…";
    const r = await submitSignedIn(kind, answers());
    submit.disabled = false;
    status.textContent = r.ok ? r.message : r.error || "That didn't work. Please try again.";
    if (r.ok) { finished = true; renderFoot(); }
  });

  toGoogle.addEventListener("click", async () => {
    const params = new URLSearchParams();
    const tooLong: string[] = [];
    for (const { title, f, get } of inputs) {
      for (const v of get()) {
        if (!v || !f) continue;
        const next = `${base}?${params.toString()}&${f.entry}=${encodeURIComponent(v)}`;
        if (next.length > URL_BUDGET) { tooLong.push(`${title}:\n${v}`); continue; }
        params.append(f.entry, v);
      }
    }
    params.set("usp", "pp_url");
    if (tooLong.length) {
      try { await navigator.clipboard.writeText(tooLong.join("\n\n")); } catch { /* no clipboard */ }
      alertLong(tooLong.length);
    }
    window.open(`${base}${base.includes("?") ? "&" : "?"}${params.toString()}`, "_blank", "noopener");
    close();
  });
  renderFoot();
  document.body.appendChild(shade);
  const first = kind === "org" && !startOrg ? groupInput : (essentialRest()[0]?.querySelector("input, textarea, select") as HTMLElement | null);
  if (editing) dialog.focus(); else (groupChip.hidden && kind !== "org" ? groupInput : first)?.focus();
  return true;
}

function alertLong(n: number) {
  const t = h("div", { class: "update-note", role: "status" }, h("span", {}, `${n === 1 ? "One answer was" : `${n} answers were`} too long for the link: copied, paste it into the form.`));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
}
