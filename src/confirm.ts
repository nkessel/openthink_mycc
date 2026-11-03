// Group confirmation page (static site). Talks to the Apps Script web app with fetch and no cookies, so it works
// no matter how many Google accounts the browser is signed into. See the API contract in the PR description.
import "./confirm.css";
import { LIVE_DATA_URL } from "./data.config";

type Obj = Record<string, any>;
interface Person { name: string; email: string; phone: string; best: string }
interface Card { id: string; kind: string; [k: string]: any }

const BASE = LIVE_DATA_URL;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

class NetError extends Error {}

async function call(body: Obj | null, query?: string): Promise<Obj> {
  let res: Response;
  try {
    res = body
      ? await fetch(BASE, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), credentials: "omit", redirect: "follow" })
      : await fetch(`${BASE}${BASE.includes("?") ? "&" : "?"}${query}`, { credentials: "omit", redirect: "follow", cache: "no-store" });
  } catch {
    throw new NetError("Couldn't reach the map's server. Check your connection and try again.");
  }
  try {
    return await res.json();
  } catch {
    throw new NetError("Couldn't reach the map's server. Check your connection and try again.");
  }
}

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
function el(h: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = h.trim();
  return t.content.firstElementChild as HTMLElement;
}
function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(+d) ? "a moment ago" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
/** Same as maskEmail_ in apps-script/Confirm.gs. */
export function maskEmail(e: string): string {
  const m = /^([^@]{0,2})[^@]*(@.*)$/.exec(String(e || ""));
  return m ? m[1] + "•••" + m[2] : "";
}
const digits = (s: string) => s.replace(/\D/g, "").length;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function msgPage(text: string) {
  document.body.innerHTML = "";
  const p = document.createElement("p");
  p.className = "msgpage";
  p.textContent = text;
  document.body.appendChild(p);
}

// ---------------------------------------------------------------- routes
const params = new URLSearchParams(location.search);
const T = params.get("t") || "";
const V = params.get("verify") || "";
const HEX = /^[0-9a-f]{32}$/;
if (V && HEX.test(V)) void runVerify(V);
else if (T && HEX.test(T)) void boot(T);
else msgPage("This link doesn't work. Please ask the map's team for a new one.");

async function runVerify(token: string) {
  msgPage("Confirming your email address…");
  try {
    const r = await call({ action: "verify", verify: token });
    msgPage(r.ok ? String(r.message || "Thank you. Your email address is confirmed.") : String(r.error || "This link doesn't work."));
  } catch (e) {
    msgPage((e as Error).message);
  }
}

// ---------------------------------------------------------------- page
async function boot(token: string) {
  let data: Obj;
  try {
    const r = await call(null, `api=confirm&t=${encodeURIComponent(token)}`);
    if (!r.ok) return msgPage(String(r.error || "This link doesn't work."));
    data = r.data;
  } catch (e) {
    return msgPage((e as Error).message);
  }
  start(data, token);
}

const KIND_BASE: Obj = { event: "Event", project: "Project", action: "Action or volunteer role" };
const LABEL: Obj = {
  name: "Name", description: "Description", website: "Website", geographic_focus: "Where you work (towns or region)",
  geographic_scope: "Geographic scope", public_contact: "Public contact (email or phone people can use)", date: "Starts",
  end: "Ends", location: "Where", online: "Online", link: "Web page", rsvp_link: "Sign-up / RSVP link", status: "Status", deadline: "Deadline",
};
const BESTS = ["Email", "Text", "Phone call", "Any"];

function sessionId(): string {
  try {
    const k = sessionStorage.getItem("confirm.sid");
    if (k && HEX.test(k)) return k;
  } catch { /* ignore */ }
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  const id = Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  try { sessionStorage.setItem("confirm.sid", id); } catch { /* ignore */ }
  return id;
}

function start(DATA: Obj, token: string) {
  const sid = sessionId();
  const coalition = DATA.kind === "coalition" || DATA.org?.kind === "coalition";
  const groupWord = coalition ? "coalition" : "organization";
  const KIND: Obj = { ...KIND_BASE, org: coalition ? "Your coalition" : "Your organization" };
  const FIELDS: Obj = DATA.fields || {};
  const orgFields: string[] = (coalition ? FIELDS.coalition : FIELDS.org) || [];
  const cards: Card[] = [DATA.org as Card, ...(DATA.items as Card[])];
  const pointPeople: Obj[] = DATA.pointPeople || [];
  const MAXPP: number = DATA.maxPointPeople || 3;
  const pingMs = (DATA.pingSeconds || 15) * 1000;

  document.title = `${DATA.title} : check your information`;
  $("bar").hidden = false;

  const blank = (): Person => ({ name: "", email: "", phone: "", best: "" });
  let st: Obj = DATA.draft || { org: { decision: "", fields: {} }, items: {} };
  st.org = st.org || { decision: "", fields: {} };
  st.items = st.items || {};
  let who: Person = blank();
  let others: Person[] = [blank(), blank()];
  try {
    const m = JSON.parse(localStorage.getItem("confirm.me") || "null");
    if (m) who = { ...blank(), ...m };
    const o = JSON.parse(localStorage.getItem("confirm.others." + token) || "null");
    if (Array.isArray(o)) others = [0, 1].map((i) => ({ ...blank(), ...(o[i] || {}) }));
  } catch { /* ignore */ }

  let editor = false, submitted = false, busy = false;
  let draftAt: string = DATA.draftAt || "";
  const baseSubmittedAt: string = DATA.submittedAt || ""; // set once from the GET data; only a reload changes it
  let stale = false;
  let lastAutosave = "";
  let rev = 0, savedRev = 0; // rev changes with every edit; savedRev is what the server has
  const editing: Record<string, boolean> = {};

  const dirty = () => rev !== savedRev;
  const touch = () => { rev++; };
  function msg(t: string, bad = false) {
    const s = $("status");
    s.textContent = t;
    s.className = "status" + (bad ? " err" : "");
  }
  function remember() {
    try {
      localStorage.setItem("confirm.me", JSON.stringify(who));
      localStorage.setItem("confirm.others." + token, JSON.stringify(others));
    } catch { /* ignore */ }
  }
  const myName = () => who.name.trim();

  const find = (id: string) => cards.find((c) => c.id === id)!;
  function S(id: string): Obj {
    if (cards[0].id === id) return st.org;
    return (st.items[id] = st.items[id] || { kind: find(id).kind, decision: "", fields: {} });
  }
  function val(c: Card, k: string) {
    const s = S(c.id);
    return s.fields && s.fields[k] !== undefined ? s.fields[k] : c[k];
  }
  const isOn = (v: unknown) => v === true || v === "TRUE";
  function when(c: Card) {
    const d = val(c, "date");
    if (!d) return "";
    const x = new Date(d);
    return isNaN(+x) ? String(d) : x.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // ---- free point-person spaces
  function freeSpaces(): number {
    const masked = pointPeople.map((p) => String(p.email || "").toLowerCase());
    const me = who.email.trim();
    const onFile = me && EMAIL_RE.test(me) && masked.includes(maskEmail(me).toLowerCase());
    return Math.max(0, MAXPP - pointPeople.length - (onFile ? 0 : 1));
  }

  // ---- rendering
  function render() {
    const app = $("app");
    app.innerHTML = "";
    app.appendChild(el(`<div><h1>Check ${esc(DATA.org.name)}’s information</h1><p class="lead">This is what the ${esc(DATA.title)} shows for your group. For each card, choose <b>Approve</b> (it’s right, or right after your edits) or <b>Remove</b> (it shouldn’t be on the map). Nothing changes until you press <b>Finalize and Submit</b>; <b>Save for later</b> keeps your work.</p></div>`));
    if (baseSubmittedAt) app.appendChild(el(`<div class="box done">Thank you: this was submitted on ${esc(new Date(baseSubmittedAt).toLocaleDateString())}. You can check it again and submit any changes.</div>`));
    const pp = pointPeople.length
      ? "Point people on file: " + pointPeople.map((p) => esc(p.name || p.email) + (p.pending ? " (waiting for email confirmation)" : "")).join(", ") + "."
      : "No point person on file yet.";
    app.appendChild(el(`<div class="box"><h2 style="margin-top:0">You</h2><div class="row2">
      <div><label for="pname">Your name</label><input id="pname" autocomplete="name"></div>
      <div><label for="pemail">Your email</label><input id="pemail" type="email" autocomplete="email"></div>
      <div><label for="pphone">Phone (optional)</label><input id="pphone" type="tel" autocomplete="tel"></div>
      <div><label for="pbest">Best way to reach you</label><select id="pbest">${bestOptions()}</select><p class="hint" id="pbest-hint"></p></div>
      </div><p class="pp">${pp} You’ll be added as a point person (up to ${MAXPP} per group); we’ll email you a link to confirm your address. Your phone and email are only seen by the map’s core team, never shown on the map.</p></div>`));
    app.appendChild(el(`<div class="box"><h2 style="margin-top:0">Other point people (optional)</h2>
      <p class="pp">Each person you add gets an email asking them to confirm their address. Their details are only seen by the map’s core team.</p>
      <p class="note" id="others-note" aria-live="polite"></p>${[0, 1].map(otherRow).join("")}</div>`));
    wirePerson("p", () => who, (p) => { who = p; });
    [0, 1].forEach((i) => wirePerson("o" + i, () => others[i], (p) => { others[i] = p; }));
    syncOthers();
    app.appendChild(el(`<h2>Your ${coalition ? "coalition" : "organization"}</h2>`));
    app.appendChild(card(DATA.org as Card));
    app.appendChild(el(`<h2>Events, projects and actions (${DATA.items.length})</h2>`));
    if (!DATA.items.length) app.appendChild(el(`<p class="empty">The map has no events, projects or actions for your ${groupWord} yet. You can add them with the + button on the map.</p>`));
    (DATA.items as Card[]).forEach((c) => app.appendChild(card(c)));
    applyLock();
  }
  const bestOptions = () => `<option value="">No preference</option>` + BESTS.map((b) => `<option>${b}</option>`).join("");
  function otherRow(i: number) {
    return `<div class="other" id="orow${i}"><h3 style="margin:8px 0 0;font-size:1em">Another point person ${i + 1}</h3><div class="row2">
      <div><label for="o${i}name">Name</label><input id="o${i}name" autocomplete="off"></div>
      <div><label for="o${i}email">Email</label><input id="o${i}email" type="email" autocomplete="off"></div>
      <div><label for="o${i}phone">Phone (optional)</label><input id="o${i}phone" type="tel" autocomplete="off"></div>
      <div><label for="o${i}best">Best way to reach them</label><select id="o${i}best">${bestOptions()}</select><p class="hint" id="o${i}best-hint"></p></div></div></div>`;
  }
  const inp = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
  function wirePerson(pre: string, get: () => Person, set: (p: Person) => void) {
    const f = ["name", "email", "phone", "best"] as const;
    const cur = get();
    f.forEach((k) => { inp(pre + k).value = cur[k] || ""; });
    syncBest(pre);
    f.forEach((k) => {
      inp(pre + k).addEventListener(k === "best" ? "change" : "input", () => {
        if (!editor) return;
        if (k === "phone") syncBest(pre);
        set({ name: inp(pre + "name").value.trim(), email: inp(pre + "email").value.trim(), phone: inp(pre + "phone").value.trim(), best: inp(pre + "best").value });
        remember();
        touch();
        if (pre === "p" && k === "email") syncOthers();
      });
    });
  }
  /** Best way to reach stays off (and empty) until the phone has at least 7 digits. */
  function syncBest(pre: string) {
    const ok = digits(inp(pre + "phone").value) >= 7;
    const sel = inp(pre + "best");
    if (!ok) sel.value = "";
    sel.disabled = !ok || !editor;
    $(pre + "best-hint").textContent = ok ? "" : "Add a phone number first";
  }
  function syncOthers() {
    const free = freeSpaces();
    [0, 1].forEach((i) => {
      const on = i < free && editor;
      ["name", "email", "phone"].forEach((k) => { inp(`o${i}${k}`).disabled = !on; });
      $("orow" + i).classList.toggle("off", i >= free);
      if (on) syncBest("o" + i);
      else inp(`o${i}best`).disabled = true;
    });
    $("others-note").textContent = free <= 0 ? (pointPeople.length >= MAXPP ? `Your group already has ${MAXPP} point people, so no more can be added here.` : "No space left: one place is kept for you.") : `${free} space${free === 1 ? "" : "s"} left`;
  }

  function card(c: Card): HTMLElement {
    const s = S(c.id), ed = !!editing[c.id], k = c.kind === "org" || c.kind === "coalition" ? "org" : c.kind;
    const keys: string[] = k === "org" ? orgFields : FIELDS[k] || [];
    const edited = s.fields && Object.keys(s.fields).length;
    const box = el(`<div class="box card${s.decision === "remove" ? " removed" : ""}" id="card-${esc(c.id)}"></div>`);
    const head = `<div class="kind">${esc(KIND[k])}${edited ? '<span class="edited-tag">edited</span>' : ""}</div><h3>${esc(val(c, "name") || "(no name)")}</h3>`;
    const meta = [when(c), val(c, "location"), isOn(val(c, "online")) ? "online" : "", val(c, "status"), val(c, "deadline") ? "deadline " + val(c, "deadline") : "", val(c, "geographic_focus"), val(c, "geographic_scope"), val(c, "website") || val(c, "link")].filter(Boolean).map(esc).join(" · ");
    if (!ed) {
      box.innerHTML = head + (meta ? `<div class="meta">${meta}</div>` : "") + (val(c, "description") ? `<p class="desc">${esc(val(c, "description"))}</p>` : `<p class="desc empty">No description yet.</p>`) + `<button type="button" class="edit-btn" aria-label="Edit ${esc(val(c, "name") || "this card")}">Edit</button>`;
    } else {
      let f = "";
      keys.forEach((key) => {
        const v = val(c, key), id = `f-${esc(c.id)}-${key}`;
        if (key === "description") f += `<label for="${id}">${LABEL[key]}</label><textarea id="${id}" data-k="${key}">${esc(v)}</textarea>`;
        else if (key === "online") f += `<label><input type="checkbox" style="width:auto" data-k="online"${isOn(v) ? " checked" : ""}> Online</label>`;
        else if (key === "status") f += `<label for="${id}">${LABEL[key]}</label><select id="${id}" data-k="status">${["active", "planning", "paused", "done"].map((o) => `<option${o === v ? " selected" : ""}>${o}</option>`).join("")}</select>`;
        else {
          const type = key === "date" || key === "end" ? "datetime-local" : key === "deadline" ? "date" : "text";
          const vv = type === "datetime-local" ? String(v || "").slice(0, 16) : type === "date" ? String(v || "").slice(0, 10) : v;
          f += `<label for="${id}">${LABEL[key] || esc(key)}</label><input id="${id}" type="${type}" data-k="${key}" value="${esc(vv)}">`;
        }
      });
      box.innerHTML = `<div class="kind">${esc(KIND[k])} · editing</div>${f}<div class="decide"><button type="button" class="primary done-btn">Done editing</button><button type="button" class="cancel-btn">Cancel</button></div>`;
    }
    if (!ed) {
      box.appendChild(el(`<div class="decide" role="group" aria-label="Decision"><button type="button" class="ok" aria-pressed="${s.decision === "approve"}">✓ Approve</button>${k === "org" ? "" : `<button type="button" class="rm" aria-pressed="${s.decision === "remove"}">Remove</button>`}</div>`));
    }
    box.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b || !editor) return;
      if (b.classList.contains("edit-btn")) { editing[c.id] = true; rerender(c); const i = document.querySelector(`#card-${CSS.escape(c.id)} [data-k]`) as HTMLElement | null; i?.focus(); return; }
      if (b.classList.contains("done-btn")) {
        const fs: Obj = {};
        box.querySelectorAll<HTMLInputElement>("[data-k]").forEach((i) => {
          const key = i.getAttribute("data-k")!, v = i.type === "checkbox" ? i.checked : i.value.trim(), orig = c[key];
          const differs = i.type === "checkbox" ? v !== isOn(orig) : String(v) !== String(orig || "").slice(0, i.type === "datetime-local" ? 16 : i.type === "date" ? 10 : 9999);
          if (differs) fs[key] = v;
        });
        s.fields = fs; s.decision = "approve"; touch(); editing[c.id] = false; return rerender(c);
      }
      if (b.classList.contains("cancel-btn")) { editing[c.id] = false; return rerender(c); }
      if (b.classList.contains("ok")) { s.decision = s.decision === "approve" ? "" : "approve"; touch(); return rerender(c); }
      if (b.classList.contains("rm")) { s.decision = s.decision === "remove" ? "" : "remove"; touch(); return rerender(c); }
    });
    return box;
  }
  function rerender(c: Card) {
    const old = document.getElementById("card-" + c.id);
    if (!old) return;
    const n = card(c);
    old.replaceWith(n);
    if (!editor) lockWithin(n);
  }

  // ---- read-only mode
  function lockWithin(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>("input,textarea,select,button").forEach((x) => ((x as HTMLInputElement).disabled = true));
  }
  function applyLock() {
    if (editor) {
      ($("save") as HTMLButtonElement).disabled = false;
      ($("submit") as HTMLButtonElement).disabled = false;
      return;
    }
    lockWithin($("app"));
    ($("save") as HTMLButtonElement).disabled = true;
    ($("submit") as HTMLButtonElement).disabled = true;
  }
  function showBanner(text: string | null) {
    const b = $("banner");
    b.innerHTML = "";
    b.className = text ? "banner" : "";
    if (!text) return;
    const span = document.createElement("span");
    span.textContent = text;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Take over";
    btn.addEventListener("click", () => void takeover(text));
    b.append(span, btn);
    b.setAttribute("role", "status");
  }
  let holder = "Someone";
  function becomeViewer(heldBy: string, since: string, lost = false, tookAt = "") {
    editor = false;
    holder = heldBy || "Someone";
    Object.keys(editing).forEach((k) => delete editing[k]);
    showBanner(lost
      ? `${holder} took over editing${tookAt ? " at " + timeOf(tookAt) : ""}. Your changes ${lastAutosave ? "up to " + lastAutosave : "up to the last automatic save"} were kept.`
      : `${holder} is editing this page right now${since ? " (since " + timeOf(since) + ")" : ""}. You can look, or take over.`);
    render();
  }
  function becomeEditor(r: Obj) {
    editor = true;
    showBanner(null);
    if (r.draft) { st = r.draft; st.org = st.org || { decision: "", fields: {} }; st.items = st.items || {}; }
    if (r.draftAt !== undefined) draftAt = r.draftAt || "";
    savedRev = rev;
    render();
    checkStale(r);
  }
  /** Someone else submitted since this page loaded: stop everything, keep the page readable. */
  function checkStale(r: Obj): boolean {
    if (r.submittedAt === undefined || (r.submittedAt || "") === baseSubmittedAt) return false;
    becomeStale(r.submittedAt || "");
    return true;
  }
  function becomeStale(at: string) {
    stale = true;
    editor = false;
    Object.keys(editing).forEach((k) => delete editing[k]);
    const b = $("banner");
    b.innerHTML = "";
    b.className = "banner";
    b.setAttribute("role", "status");
    const span = document.createElement("span");
    span.textContent = `Someone else submitted this page${at ? " at " + timeOf(at) : ""}, so what you see is out of date. Reload to see what's on the map now.`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    b.append(span, btn);
    applyLock();
  }
  async function takeover(_: string) {
    if (!confirm(`${holder} may lose their last few seconds of changes. Take over?`)) return;
    msg("Taking over…");
    try {
      const r = await call({ action: "takeover", token, sid, name: myName() });
      if (!r.ok) return msg(String(r.error || "Something went wrong. Please try again."), true);
      becomeEditor(r);
      msg("You are editing now.");
    } catch (e) { msg((e as Error).message, true); }
  }

  // ---- the lock: claim, ping, release
  async function claim() {
    try {
      const r = await call({ action: "claim", token, sid, name: myName() });
      if (!r.ok) { render(); return msg(String(r.error || "Something went wrong."), true); }
      if (r.editor) becomeEditor(r);
      else { becomeViewer(r.heldBy, r.since); checkStale(r); }
    } catch (e) { render(); applyLock(); msg((e as Error).message, true); }
  }
  async function ping() {
    if (busy || submitted || stale) return;
    busy = true;
    const sentRev = rev;
    try {
      const body: Obj = { action: "ping", token, sid, name: myName(), draftAt };
      const sendState = editor && dirty();
      if (sendState) body.state = buildState();
      const r = await call(body);
      if (!r.ok) { if (r.gone) { showBanner(null); msgPage(String(r.error || "This link doesn't work.")); } return; }
      if (checkStale(r)) return;
      if (r.editor) {
        if (!editor) { editor = true; showBanner(null); if (r.draftAt !== undefined) draftAt = r.draftAt || ""; render(); }
        if (sendState) {
          savedRev = sentRev;
          if (r.savedAt) draftAt = r.savedAt;
          lastAutosave = timeOf(r.savedAt || new Date().toISOString());
          msg("Saved automatically at " + lastAutosave);
        }
      } else {
        const wasEditor = editor;
        if (r.draftAt !== undefined) draftAt = r.draftAt || draftAt;
        if (r.draft) { st = r.draft; st.org = st.org || { decision: "", fields: {} }; st.items = st.items || {}; }
        if (wasEditor || r.lost) becomeViewer(r.heldBy, r.since, !!r.lost, r.since);
        else if (r.draft) { holder = r.heldBy || holder; render(); }
        else { holder = r.heldBy || holder; }
      }
    } catch { /* quiet: next ping will retry */ }
    finally { busy = false; }
  }
  setInterval(() => void ping(), pingMs);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void ping(); });
  window.addEventListener("pagehide", () => {
    if ((!editor && !stale) || submitted) return;
    try { navigator.sendBeacon(BASE, new Blob([JSON.stringify({ action: "release", token, sid })], { type: "text/plain;charset=utf-8" })); } catch { /* ignore */ }
  });
  window.addEventListener("beforeunload", (e) => { if (editor && dirty() && !submitted) { e.preventDefault(); e.returnValue = ""; } });

  // ---- state, save, submit
  function buildState(): Obj {
    const free = freeSpaces();
    return {
      who: { ...who },
      others: others.slice(0, 2).filter((o, i) => i < free && EMAIL_RE.test(o.email)).map((o) => ({ ...o, best: digits(o.phone) >= 7 ? o.best : "" })),
      org: st.org,
      items: st.items,
    };
  }
  function ready(): boolean {
    if (!who.name || !EMAIL_RE.test(who.email)) {
      msg("Please enter your name and email at the top first.", true);
      inp(who.name ? "pemail" : "pname").focus();
      return false;
    }
    return true;
  }
  $("save").addEventListener("click", async () => {
    if (!editor || busy) return;
    msg("Saving…");
    const sentRev = rev;
    try {
      const r = await call({ action: "save", token, sid, state: buildState() });
      if (!r.ok) return msg(String(r.error || "Something went wrong. Please try again."), true);
      savedRev = sentRev;
      if (r.savedAt) draftAt = r.savedAt;
      msg("Saved. Open this same link to pick up where you left off.");
    } catch (e) { msg((e as Error).message, true); }
  });
  $("reload").addEventListener("click", () => location.reload());
  $("submit").addEventListener("click", async () => {
    if (!editor || busy) return;
    if (!ready()) return;
    if (Object.values(editing).some(Boolean)) return msg("Press “Done editing” on the open card first.", true);
    const n = cards.filter((c) => !S(c.id).decision).length;
    if (n && !confirm(`${n} card(s) have no decision yet and will be left as they are. Submit anyway?`)) return;
    msg("Submitting…");
    const btn = $("submit") as HTMLButtonElement;
    btn.disabled = true;
    busy = true;
    try {
      const r = await call({ action: "submit", token, sid, state: buildState(), baseSubmittedAt });
      if (!r.ok) {
        btn.disabled = false;
        msg(String(r.error || "Something went wrong. Please try again."), true);
        if (r.conflict) $("reload").hidden = false;
        return;
      }
      submitted = true;
      savedRev = rev;
      showBanner(null);
      $("app").innerHTML = `<div class="box done"><h1>Thank you!</h1><p>Your changes are on the map (${esc(r.summary)}). Check your email for a link to confirm your address as a point person.</p><p>You can open this link again any time to make more changes.</p></div>`;
      $("bar").remove();
    } catch (e) { btn.disabled = false; msg((e as Error).message, true); }
    finally { busy = false; }
  });

  void claim();
}
