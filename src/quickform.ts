// Fill it in on the map (10/15 meeting): the + menu opens a short form here, with the group picked from a list as
// you type. Signed in (Nov 5, src/auth.ts: Google or a login link by email), Submit sends it straight to the sheet
// script, which runs the same access checks and review queue as the Google Forms (apps-script/SignIn.gs). Not
// signed in: "Confirm with email" emails a login link that sends the form, or "Continue" opens the real Google
// Form with every answer already filled in.
import FIELDS from "./forms.fields.json";
import type { DataFile, GraphNode } from "./types";
import { FORMS } from "./forms.config";
import { coalitionLabel, orgLabel } from "./fab";
import { h } from "./dom";
import { emailBox, googleButton, googleEnabled, onSessionChange, session, signOut, submitSignedIn, type Answers } from "./auth";

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

  // Answers by question title, the way the sheet script reads a Google Form response (apps-script/SignIn.gs).
  const answers = (): Answers => {
    const out: Answers = {};
    for (const { title, f, get } of inputs) {
      const vals = get().filter(Boolean);
      if (vals.length) out[title] = f.type === 4 ? vals : vals[0];
    }
    return out;
  };
  const whichMissing = () => !Object.keys(answers()).some((t) => /^Which /.test(t));

  const note = h("p", { class: "qf-note" });
  const extra = h("div", { class: "qf-email" });
  extra.hidden = true;
  const status = h("p", { class: "qf-status", role: "status", "aria-live": "polite" });
  const foot = h("div", { class: "qf-foot" });
  const cancel = h("button", { type: "button", class: "qf-cancel" }, "Cancel");
  const direct = h("a", { class: "qf-direct", href: base, target: "_blank", rel: "noopener" }, "or open the empty form");
  const toGoogle = h("button", { type: "button", class: "qf-alt" }, "Continue to the Google Form →") as HTMLButtonElement;
  const confirm = h("button", { type: "button", class: "qf-go" }, "Confirm with email") as HTMLButtonElement;
  const submit = h("button", { type: "button", class: "qf-go" }, "Submit") as HTMLButtonElement;
  const done = h("button", { type: "button", class: "qf-go" }, "Close") as HTMLButtonElement;
  let finished = false;

  // Signed in (src/auth.ts): Submit sends it straight to the map. Not signed in: "Confirm with email" (or Google
  // sign-in), with the Google Form kept as a backup.
  function renderFoot() {
    if (finished) { note.replaceChildren(); extra.hidden = true; foot.replaceChildren(done); done.focus(); return; }
    const s = session();
    if (s) {
      const out = h("button", { type: "button", class: "qf-link" }, "Sign out");
      out.addEventListener("click", () => signOut());
      note.replaceChildren(`Signed in as ${s.email} (`, out, "). Only what you fill in is sent; blanks keep what's already on the map. If you're a point person for this group it goes straight on the map; otherwise the map team checks it first.");
      extra.hidden = true;
      foot.replaceChildren(cancel, direct, submit);
    } else {
      note.textContent = "Only what you fill in is sent; blanks keep what's already on the map. Point people: confirm with your email to send it straight to the map, or continue in the Google Form.";
      foot.replaceChildren(cancel, direct, toGoogle, confirm);
    }
  }

  const dialog = h("div", { class: "qf", role: "dialog", "aria-modal": "true", "aria-label": TITLES[kind] },
    h("div", { class: "qf-head" }, h("h2", {}, TITLES[kind])), body, note, extra, status, foot);
  const shade = h("div", { class: "qf-shade" }, dialog);
  const stopWatching = onSessionChange(renderFoot);
  const close = () => { stopWatching(); shade.remove(); };
  cancel.addEventListener("click", close);
  done.addEventListener("click", close);
  shade.addEventListener("click", (e) => { if (e.target === shade) close(); });
  shade.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });

  confirm.addEventListener("click", () => {
    if (whichMissing()) { status.textContent = "Please fill in which organization this is about first."; return; }
    status.textContent = "";
    if (!extra.childElementCount) {
      const gbox = h("div", { class: "acct-google" });
      googleButton(gbox, (r) => { status.textContent = r.ok ? "" : r.error || "Google sign-in didn't work."; });
      extra.append(
        h("p", { class: "qf-note" }, "We'll email you a link. Open it and press Log in within 15 minutes: that sends this form and keeps you signed in on that device for 30 days."),
        emailBox(status, () => ({ kind, answers: answers() }), () => { finished = true; renderFoot(); }),
        ...(googleEnabled() ? [h("span", { class: "acct-label" }, "Or sign in with Google, then press Submit"), gbox] : []),
      );
    }
    extra.hidden = false;
    (extra.querySelector("input") as HTMLInputElement | null)?.focus();
  });

  submit.addEventListener("click", async () => {
    if (whichMissing()) { status.textContent = "Please fill in which organization this is about first."; return; }
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
  renderFoot();
  document.body.appendChild(shade);
  (body.querySelector("input:not([type=hidden]), textarea, select") as HTMLElement | null)?.focus();
  return true;
}

function alertLong(n: number) {
  const t = h("div", { class: "update-note", role: "status" }, h("span", {}, `${n === 1 ? "One answer was" : `${n} answers were`} too long for the link: copied, paste it into the form.`));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
}
