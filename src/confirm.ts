// Group confirmation page (static site). Talks to the Apps Script web app with fetch and no cookies, so it works
// no matter how many Google accounts the browser is signed into. See the API contract in the PR description.
import "./confirm.css";
import { LIVE_DATA_URL } from "./data.config";
import { applyKindStyle } from "./kinds.config";
import { typeIcon, type IconKind } from "./icons";

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
  // Loading screen (round 4, Nov 19): the map's server (Google Apps Script) can take several seconds to wake up.
  const note = document.getElementById("loading-note");
  const slow = [setTimeout(() => { if (note) note.textContent = "Still loading: the map’s server can take a few seconds to wake up."; }, 5000),
    setTimeout(() => { if (note) note.textContent = "Almost there. Thanks for your patience!"; }, 14000)];
  try {
    const r = await call(null, `api=confirm&t=${encodeURIComponent(token)}`);
    slow.forEach(clearTimeout);
    if (!r.ok) return msgPage(String(r.error || "This link doesn't work."));
    data = r.data;
  } catch (e) {
    return msgPage((e as Error).message);
  }
  start(data, token);
}

const KIND_BASE: Obj = { event: "Event", project: "Project", action: "Action", volunteer: "Volunteer role" };
/** Sections of the review page (Nov 6 round 3 design, built Nov 17): one per type, each with its own + button. */
const SECTIONS: { key: IconKind; title: string; one: string; add: string }[] = [
  { key: "event", title: "Events", one: "event", add: "Add an event" },
  { key: "project", title: "Projects", one: "project", add: "Add a project" },
  { key: "action", title: "Actions", one: "action", add: "Add an action" },
  { key: "volunteer", title: "Volunteer roles", one: "volunteer role", add: "Add a volunteer role" },
];
const LABEL: Obj = {
  name: "Name", description: "Description", website: "Website", social_links: "Social media (links to your group's own accounts, separated by commas)", geographic_focus: "Where you work (towns or region)",
  geographic_scope: "Geographic scope", public_contact: "Public contact (email or phone people can use)", date: "Starts",
  end: "Ends", location: "Where", online: "Online", link: "Web page", rsvp_link: "Sign-up / RSVP link", status: "Status", deadline: "Deadline",
  // Round 4 (Nov 19): every field the map shows
  abbrev: "Short name or acronym", type: "Type of group", remote: "No public location (don’t show a pin on the geographic map)",
  topic_tags: "Topics (separated by commas)", focus_tags: "Focus areas (separated by commas)", youth_serving: "Youth-serving group",
  school_club: "School or campus club", membership_size: "Active membership (about how many people)",
  recurrence: "Repeats (for example: Every Tuesday, 6–7 PM)", skills_needed: "Skills you’re looking for (separated by commas)",
  help_wanted: "Looking for help with this", free_food: "Free food provided", affiliated_only: "Only for members or affiliates", urgency: "How urgent",
};
/** Short names for the "add missing info" pills on the group card. */
const PILL: Obj = {
  description: "Description", abbrev: "Short name", type: "Type of group", website: "Website", social_links: "Social media",
  public_contact: "Public contact", geographic_focus: "Where you work", geographic_scope: "Geographic scope", topic_tags: "Topics",
  focus_tags: "Focus areas", membership_size: "Membership size",
};
const BOOLS = ["online", "remote", "youth_serving", "school_club", "free_food", "affiliated_only", "help_wanted"];
const CHOICES: Record<string, [string, string][]> = {
  status: [["active", "Active"], ["planning", "Planning"], ["completed", "Completed"]],
  urgency: [["", "Not set"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]],
  type: [["unknown", "Not set"], ["501c3", "501(c)(3) nonprofit"], ["501c4", "501(c)(4)"], ["school_club", "School club"], ["campus_group", "Campus group"],
    ["youth_org", "Youth organization"], ["faith_org", "Faith organization"], ["union", "Union"], ["business", "Business"], ["university", "University"],
    ["municipal", "Municipal"], ["volunteer", "Volunteer group"], ["professional", "Professional association"], ["media", "Media"], ["coalition", "Coalition"]],
};
const BESTS = ["Email", "Text", "Phone call", "Any"];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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
  let cards: Card[] = [DATA.org as Card, ...(DATA.items as Card[])];
  /** New items added with the + buttons live in the draft as items "new_<n>" until submitted. */
  const isNew = (id: string) => /^new_\d+$/.test(id);
  function syncNewCards() {
    const added = Object.keys(st.items).filter(isNew).map((id) => ({ id, kind: st.items[id].kind, role: !!st.items[id].role, isNew: true } as Card));
    cards = [DATA.org as Card, ...(DATA.items as Card[]), ...added];
  }
  /** Which section a card belongs to: actions split into actions and volunteer roles. */
  const sectionOf = (c: Card): IconKind => {
    const t = st.items[c.id] && st.items[c.id].newType; // changed with the tag ▾ (round 3)
    if (t) return t as IconKind;
    return (c.kind === "action" ? (c.role ? "volunteer" : "action") : c.kind) as IconKind;
  };
  const kindOfSec = (sec: IconKind) => (sec === "volunteer" ? "action" : sec);
  /** Point people for one item (round 3): kept in this browser like the other point people, sent with Submit only. */
  interface ItemPerson { name: string; email: string; phone: string; best: string; scope: "item" | "group" }
  let itemPeople: Record<string, ItemPerson[]> = {};
  /** Item point person flow (round 4): "" = button, "ask" = Me / Someone else, "other" = the form. */
  const ippMode: Record<string, "" | "ask" | "other"> = {};
  try { itemPeople = JSON.parse(localStorage.getItem("confirm.itempeople." + token) || "{}") || {}; } catch { /* ignore */ }
  const saveItemPeople = () => { try { localStorage.setItem("confirm.itempeople." + token, JSON.stringify(itemPeople)); } catch { /* ignore */ } };
  applyKindStyle();
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
  const touch = () => { rev++; showProgress(); };
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
  function showProgress() {
    const p = document.getElementById("progress");
    if (!p) return;
    const n = cards.length, a = cards.filter((c) => S(c.id).decision === "approve").length;
    p.querySelector("b")!.textContent = `${a} of ${n} approved`;
    (p.querySelector(".pbar span") as HTMLElement).style.width = n ? `${Math.round((100 * a) / n)}%` : "0";
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
    syncNewCards();
    const app = $("app");
    app.innerHTML = "";
    app.appendChild(el(`<div><h1>Check ${esc(DATA.org.name)}’s information</h1><p class="lead">All of this group information was retrieved from online sources. Approve what’s right, edit what isn’t, and add anything we missed with the <b>+</b> buttons. Approved information goes live when you press <b>Finalize and Submit</b> (at the end of the page); <b>Save for later</b> keeps your work.</p></div>`));
    if (baseSubmittedAt) app.appendChild(el(`<div class="box done">Thank you: this was submitted on ${esc(new Date(baseSubmittedAt).toLocaleDateString())}. You can check it again and submit any changes.</div>`));
    app.appendChild(el(`<div class="progress" id="progress"><b></b><div class="pbar" aria-hidden="true"><span></span></div></div>`));
    const pp = pointPeople.length
      ? "Point people on file: " + pointPeople.map((p) => esc(p.name || p.email) + (p.pending ? " (waiting for email confirmation)" : "")).join(", ") + "."
      : "No point person on file yet.";
    app.appendChild(el(`<h2>Your ${coalition ? "coalition" : "organization"}</h2>`));
    app.appendChild(card(DATA.org as Card));
    // Point people (round 4, Nov 19): right after the group's own card, with what a point person is and can do.
    const gname = esc(DATA.org.name);
    app.appendChild(el(`<div class="box pp-box" id="point-people"><h2 style="margin-top:0">Point people for ${gname}</h2>
      <p>Point people are the people ${gname} chooses to keep its page on the map up to date. They are the group’s editors on the map: each point person gets their own link and can change everything for ${gname} at any time, including its description, links, events, projects, actions and volunteer roles. A group can have up to ${MAXPP}.</p>
      <p class="pp">Someone who only runs one event or project can be a point person for just that item: press <b>Edit</b> on its card below and use <b>Point people for this event</b> (or project). We email every new point person a link to confirm their address. Their email and phone are only seen by the map’s core team, never shown on the map.</p>
      <p class="pp"><b>${pp}</b></p>
      <h3>You${pointPeople.length ? "" : " (the first point person)"}</h3><div class="row2">
      <div><label for="pname">Your name</label><input id="pname" autocomplete="name"></div>
      <div><label for="pemail">Your email</label><input id="pemail" type="email" autocomplete="email"></div>
      <div><label for="pphone">Phone (optional)</label><input id="pphone" type="tel" autocomplete="tel"></div>
      <div><label for="pbest">Best way to reach you</label><select id="pbest">${bestOptions()}</select><p class="hint" id="pbest-hint"></p></div>
      </div><p class="hint">Needed to submit. You’ll be added as a point person for ${gname} if there’s space.</p>
      <h3 style="margin-top:18px">Others on your team (optional)</h3><p class="note" id="others-note" aria-live="polite"></p>${[0, 1].map(otherRow).join("")}</div>`));
    wirePerson("p", () => who, (p) => { who = p; });
    [0, 1].forEach((i) => wirePerson("o" + i, () => others[i], (p) => { others[i] = p; }));
    syncOthers();
    app.appendChild(el(`<p class="hint typehint">To change an item’s type, click its type tag (▾).</p>`));
    // One section per type, each with a + button (round 3, option A: a round button next to the count).
    SECTIONS.forEach((sec) => {
      const list = cards.slice(1).filter((c) => sectionOf(c) === sec.key);
      const h = el(`<h2 class="sec sec-${sec.key}" id="sec-${sec.key}"><span class="sec-icon"></span>${sec.title} <span class="count">(${list.length})</span><button type="button" class="plus" aria-label="${sec.add}" title="${sec.add}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2v12M2 8h12"/></svg></button></h2>`);
      h.querySelector(".sec-icon")!.appendChild(typeIcon(sec.key, 20));
      h.querySelector(".plus")!.addEventListener("click", () => addItem(sec.key));
      app.appendChild(h);
      if (!list.length) app.appendChild(el(`<p class="empty" id="empty-${sec.key}">None on the map yet. Press <b>+</b> to add one.</p>`));
      list.forEach((c) => app.appendChild(card(c)));
    });
    // Approve all (Nathan, Nov 17): under the last cards that ask for approval. Marks every card approved, except ones marked Remove.
    app.appendChild(el(`<div class="box approve-all"><button type="button" class="primary" id="approve-all">✓ Approve all</button><p class="hint">Approves every card above that you haven’t marked Remove. You can still change any card before you press <b>Finalize and Submit</b>.</p></div>`));
    $("approve-all").addEventListener("click", () => {
      if (!editor) return;
      if (Object.values(editing).some(Boolean)) return msg("Press “Done editing” on the open card first.", true);
      cards.forEach((c) => { const s = S(c.id); if (s.decision !== "remove") s.decision = "approve"; });
      touch();
      cards.forEach(rerender);
      msg(`Approved ${cards.filter((c) => S(c.id).decision === "approve").length} card(s). Review anything you like, then press Finalize and Submit.`);
    });
    // Feedback for the map team (Nathan, Nov 17): sent with Finalize and Submit, saved with the draft.
    app.appendChild(el(`<div class="box"><h2 style="margin-top:0"><label for="fb">Ideas or comments for us (optional)</label></h2>
      <p class="pp">What would make the map most useful for ${esc(DATA.org.name)}? Anything else you’d like to share with the map’s team? We read every note.</p>
      <textarea id="fb" rows="4" maxlength="3000"></textarea></div>`));
    const fb = $("fb") as HTMLTextAreaElement;
    fb.value = String(st.feedback || "");
    fb.addEventListener("input", () => { st.feedback = fb.value; touch(); });
    showProgress();
    applyLock();
  }
  /** + button: a new, empty card of that type, open for editing. It's added to the map only if approved and named. */
  function addItem(sec: IconKind) {
    if (!editor) return;
    if (Object.values(editing).some(Boolean)) return msg("Press “Done editing” on the open card first.", true);
    let n = 1;
    while (st.items["new_" + n]) n++;
    const id = "new_" + n;
    st.items[id] = { kind: sec === "volunteer" ? "action" : sec, role: sec === "volunteer", decision: "", fields: {}, isNew: true };
    editing[id] = true;
    touch();
    render();
    const box = document.getElementById("card-" + id);
    box?.scrollIntoView({ block: "center" });
    (box?.querySelector("[data-k]") as HTMLElement | null)?.focus();
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
    const sec = k === "org" ? null : sectionOf(c);
    const one = k === "org" ? "group information" : SECTIONS.find((x) => x.key === sec)!.one;
    const fresh = isNew(c.id);
    const keys: string[] = k === "org" ? orgFields : FIELDS[kindOfSec(sec!)] || [];
    const edited = !fresh && s.fields && Object.keys(s.fields).length;
    const box = el(`<div class="box card${sec ? " k-" + sec : ""}${s.decision === "remove" ? " removed" : ""}" id="card-${esc(c.id)}"></div>`);
    const moved = sec && !fresh && s.newType ? `<span class="edited-tag">type changed</span>` : "";
    const tag = sec
      ? `<span class="tagwrap"><button type="button" class="tag tagbtn" aria-haspopup="true" aria-expanded="false" aria-label="Type: ${esc(KIND_BASE[sec])}. Change type">${esc(KIND_BASE[sec])} <span aria-hidden="true">▾</span></button><span class="typemenu" role="menu" hidden>${SECTIONS.map((x) => `<button type="button" role="menuitem" class="typeopt k-${x.key}" data-type="${x.key}"${x.key === sec ? ' aria-current="true"' : ""}><span class="topt-icon"></span>${esc(KIND_BASE[x.key])}</button>`).join("")}</span></span>${moved}`
      : `<span class="kind">${esc(KIND.org)}</span>`;
    const head = `<div class="tagrow">${tag}${fresh ? '<span class="edited-tag">new</span>' : edited ? '<span class="edited-tag">edited</span>' : ""}</div><h3>${esc(val(c, "name") || "(no name)")}</h3>`;
    const typeName = (t: string) => (CHOICES.type.find((x) => x[0] === t) || [t, t])[1];
    const meta = [val(c, "abbrev"), k === "org" && val(c, "type") && val(c, "type") !== "unknown" ? typeName(String(val(c, "type"))) : "", when(c), val(c, "recurrence"), val(c, "location"), isOn(val(c, "online")) ? "online" : "", val(c, "status"), val(c, "urgency") ? val(c, "urgency") + " urgency" : "", val(c, "deadline") ? "deadline " + val(c, "deadline") : "", val(c, "geographic_focus"), val(c, "geographic_scope"), val(c, "website") || val(c, "link"), val(c, "social_links"), val(c, "public_contact") ? "contact: " + val(c, "public_contact") : "", val(c, "membership_size") ? "about " + val(c, "membership_size") + " members" : ""].filter(Boolean).map(esc).join(" · ");
    const flags = [["youth_serving", "Youth-serving"], ["school_club", "School club"], ["remote", "No public location"], ["free_food", "Free food"], ["affiliated_only", "Members only"]]
      .filter(([f]) => keys.includes(f) && isOn(val(c, f))).map(([, l]) => l).concat(kindOfSec(sec || "event") === "project" && keys.includes("help_wanted") && !isOn(val(c, "help_wanted")) ? ["Not looking for help"] : []);
    const topics = String(val(c, "topic_tags") || val(c, "focus_tags") || c.topic_tags || "").split(/[,;]\s*/).filter(Boolean);
    const skills = String(val(c, "skills_needed") || "").split(/[,;]\s*/).filter(Boolean);
    const people = k === "org"
      ? pointPeople.map((p) => esc(p.name || p.email) + (p.pending ? " (waiting to confirm)" : ""))
      : [...(c.pointPeople || []).map((p: Obj) => esc(p.name || p.email) + (p.pending ? " (waiting to confirm)" : "")), ...(itemPeople[c.id] || []).map((p) => esc(p.name) + " (new" + (p.scope === "group" ? ", whole group" : "") + ")")];
    if (!ed) {
      box.innerHTML = head + (meta ? `<div class="meta">${meta}</div>` : "") + (val(c, "description") ? `<p class="desc">${esc(val(c, "description"))}</p>` : `<p class="desc empty">No description yet.</p>`)
        + (topics.length || flags.length ? `<div class="topics">${flags.map((t) => `<span class="tpill flag">${esc(t)}</span>`).join("")}${topics.map((t) => `<span class="tpill">${esc(t)}</span>`).join("")}</div>` : "")
        + (skills.length ? `<p class="who">Skills wanted: ${skills.map(esc).join(", ")}</p>` : "")
        + (people.length ? `<p class="who">${k === "org" ? "Point people (can edit everything for this group)" : "Point people"}: ${people.join(", ")}</p>` : "");
    } else {
      let f = "";
      keys.forEach((key) => {
        const v = val(c, key), id = `f-${esc(c.id)}-${key}`;
        if (key === "description") f += `<label for="${id}">${LABEL[key]}</label><textarea id="${id}" data-k="${key}">${esc(v)}</textarea>`;
        else if (BOOLS.includes(key)) f += `<label class="check"><input type="checkbox" id="${id}" data-k="${key}"${isOn(v) ? " checked" : ""}> ${esc(LABEL[key])}</label>`;
        else if (CHOICES[key]) {
          const opts = CHOICES[key].slice(), cur = String(v || (key === "status" ? "active" : key === "type" ? "unknown" : ""));
          if (!opts.some((o) => o[0] === cur)) opts.push([cur, cur.replace(/_/g, " ")]); // a value set elsewhere stays selectable
          f += `<label for="${id}">${LABEL[key]}</label><select id="${id}" data-k="${key}">${opts.map(([o, l]) => `<option value="${esc(o)}"${o === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
        }
        else {
          const type = key === "date" || key === "end" ? "datetime-local" : key === "deadline" ? "date" : "text";
          const vv = type === "datetime-local" ? String(v || "").slice(0, 16) : type === "date" ? String(v || "").slice(0, 10) : v;
          f += `<label for="${id}">${LABEL[key] || esc(key)}${key === "name" && fresh ? " (required)" : ""}</label><input id="${id}" type="${type}" data-k="${key}" value="${esc(vv)}">`;
        }
      });
      const title = fresh ? `New ${one}` : `${k === "org" ? "Group information" : KIND_BASE[sec!]} · editing`;
      if (sec) {
        const pid = esc(c.id);
        const mode = ippMode[c.id] || "";
        f += `<fieldset class="ipp"><legend>Point people for this ${esc(one)}</legend>
          <p class="hint">The point person is the main contact for this ${esc(one)}: the person who keeps it up to date on the map, and who the map team contacts about it. They can update it any time without editing the rest of ${esc(DATA.org.name)}’s page. Their email and phone are never shown on the map.</p>
          <ul class="ipp-list"></ul>
          ${mode === "" ? `<button type="button" class="ipp-start">+ Add a point person for this ${esc(one)}</button>` : ""}
          ${mode === "ask" ? `<div class="ipp-ask"><p><b>Who looks after this ${esc(one)}?</b></p><div class="decide" style="margin-top:4px"><button type="button" class="ipp-me">Me</button><button type="button" class="ipp-other">Someone else</button><button type="button" class="ipp-cancel">Cancel</button></div><p class="hint ipp-note" aria-live="polite"></p></div>` : ""}
          <div class="ipp-add"${mode === "other" ? "" : " hidden"}><div class="row2"><div><label for="ip-${pid}-name">Name</label><input id="ip-${pid}-name" autocomplete="off"></div>
          <div><label for="ip-${pid}-email">Email</label><input id="ip-${pid}-email" type="email" autocomplete="off"></div>
          <div><label for="ip-${pid}-phone">Phone (optional)</label><input id="ip-${pid}-phone" type="tel" autocomplete="off"></div></div>
          <fieldset class="scope"><legend>What can they edit?</legend>
          <label><input type="radio" name="ip-${pid}-scope" value="item" checked> Just this ${esc(one)} <span class="hint">(recommended)</span></label>
          <label><input type="radio" name="ip-${pid}-scope" value="group"> Everything for ${esc(DATA.org.name)} <span class="hint">(makes them a point person for the whole group)</span></label></fieldset>
          <div class="decide" style="margin-top:6px"><button type="button" class="ipp-btn">Add point person</button><button type="button" class="ipp-cancel">Cancel</button></div></div></fieldset>`;
      }
      box.innerHTML = `<div class="tagrow">${sec ? `<span class="tag">${esc(title)}</span>` : `<span class="kind">${esc(title)}</span>`}</div>${f}<div class="decide"><button type="button" class="primary done-btn">${fresh ? `Add ${esc(one)}` : "Done editing"}</button><button type="button" class="cancel-btn">Cancel</button></div>`;
    }
    if (sec) box.querySelector(".tag")!.prepend(typeIcon(sec, 15));
    box.querySelectorAll<HTMLElement>(".typeopt").forEach((o) => o.querySelector(".topt-icon")!.appendChild(typeIcon(o.getAttribute("data-type") as IconKind, 16)));
    const ippList = () => {
      const ul = box.querySelector(".ipp-list");
      if (!ul) return;
      const on = (c.pointPeople || []).map((p: Obj) => `<li>${esc(p.name || p.email)}${p.pending ? " (waiting to confirm)" : ""}</li>`);
      const mine = (itemPeople[c.id] || []).map((p, i) => `<li>${esc(p.name)} · ${esc(p.email)} · ${p.scope === "group" ? "whole group" : "just this " + esc(one)} <button type="button" class="ipp-rm" data-i="${i}" aria-label="Remove ${esc(p.name)}">Remove</button></li>`);
      ul.innerHTML = on.concat(mine).join("") || `<li class="hint">No point person for this ${esc(one)} yet.</li>`;
    };
    ippList();
    if (!ed && k === "org") {
      // Round 4 (Nov 19): coloured pills for what the group's card is missing; each opens Edit at that field.
      const uniq = keys.filter((f) => PILL[f] && (f === "type" ? !val(c, f) || val(c, f) === "unknown" : !String(val(c, f) || "").trim()));
      if (uniq.length) box.appendChild(el(`<div class="addinfo"><span class="hint">Add missing info:</span>${uniq.map((f, i) => `<button type="button" class="pill-add c${i % 6}" data-f="${f}">+ ${esc(PILL[f])}</button>`).join("")}</div>`));
    }
    if (!ed) {
      const approved = s.decision === "approve";
      box.appendChild(el(`<div class="decide" role="group" aria-label="Decision"><button type="button" class="ok" aria-pressed="${approved}">✓ ${approved ? `${k === "org" ? "Group information" : esc(cap(one))} approved` : `Approve ${esc(one)}`}</button><button type="button" class="edit-btn" aria-label="Edit ${esc(val(c, "name") || "this card")}">Edit</button>${k === "org" ? "" : `<button type="button" class="rm" aria-pressed="${s.decision === "remove"}">${fresh ? "Delete" : "Remove from map"}</button>`}</div>`));
    }
    box.addEventListener("keydown", (e) => {
      const m = box.querySelector(".typemenu") as HTMLElement | null;
      if (e.key === "Escape" && m && !m.hidden) { m.hidden = true; const t = box.querySelector(".tagbtn") as HTMLElement; t.setAttribute("aria-expanded", "false"); t.focus(); }
    });
    const drop = () => { delete st.items[c.id]; delete editing[c.id]; delete itemPeople[c.id]; saveItemPeople(); syncNewCards(); touch(); render(); };
    box.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b || !editor) return;
      if (b.classList.contains("tagbtn")) {
        const m = box.querySelector(".typemenu") as HTMLElement, open = m.hidden;
        m.hidden = !open; b.setAttribute("aria-expanded", String(open));
        if (open) (m.querySelector("[aria-current]") as HTMLElement | null)?.focus();
        return;
      }
      if (b.classList.contains("typeopt")) {
        const t = b.getAttribute("data-type") as IconKind, orig = (c.kind === "action" ? (c.role ? "volunteer" : "action") : c.kind) as IconKind;
        if (fresh) { s.kind = kindOfSec(t); s.role = t === "volunteer"; delete s.newType; }
        else if (t === orig) delete s.newType;
        else s.newType = t;
        touch(); render();
        const title = SECTIONS.find((x) => x.key === t)!.title;
        msg(t === orig || fresh ? `Moved to ${title}.` : `Moved to ${title}. The type changes on the map when you press Finalize and Submit.`);
        (document.querySelector(`#card-${CSS.escape(c.id)} .tagbtn`) as HTMLElement | null)?.focus();
        return;
      }
      if (b.classList.contains("ipp-start")) { ippMode[c.id] = "ask"; rerender(c); (document.querySelector(`#card-${CSS.escape(c.id)} .ipp-me`) as HTMLElement | null)?.focus(); return; }
      if (b.classList.contains("ipp-cancel")) { ippMode[c.id] = ""; rerender(c); (document.querySelector(`#card-${CSS.escape(c.id)} .ipp-start`) as HTMLElement | null)?.focus(); return; }
      if (b.classList.contains("ipp-other")) { ippMode[c.id] = "other"; rerender(c); (document.querySelector(`#ip-${CSS.escape(c.id)}-name`) as HTMLElement | null)?.focus(); return; }
      if (b.classList.contains("ipp-me")) {
        const note = box.querySelector(".ipp-note") as HTMLElement;
        if (!who.name || !EMAIL_RE.test(who.email)) {
          note.innerHTML = `First add your name and email under <a href="#point-people">Point people</a> (near the top), then come back and press <b>Me</b>.`;
          note.querySelector("a")!.addEventListener("click", (ev) => { ev.preventDefault(); $("point-people").scrollIntoView({ block: "start" }); inp(who.name ? "pemail" : "pname").focus(); });
          return;
        }
        const masked = pointPeople.map((p) => String(p.email || "").toLowerCase());
        const onFile = masked.includes(maskEmail(who.email).toLowerCase());
        if (onFile || pointPeople.length < MAXPP) {
          note.textContent = `You’re ${onFile ? "already" : "being added as"} a point person for all of ${DATA.org.name}, so you can already edit this ${one}. Nothing else to do.`;
          return;
        }
        const list = (itemPeople[c.id] = itemPeople[c.id] || []);
        if (list.some((p) => p.email.toLowerCase() === who.email.toLowerCase())) { note.textContent = "You’re already on the list for this " + one + "."; return; }
        if (list.length + (c.pointPeople || []).length >= MAXPP) { note.textContent = `Up to ${MAXPP} point people per ${one}.`; return; }
        list.push({ name: who.name, email: who.email, phone: who.phone, best: who.best, scope: "item" });
        saveItemPeople(); touch(); ippMode[c.id] = ""; rerender(c);
        msg(`You’ll be the point person for this ${one} when you press Finalize and Submit.`);
        return;
      }
      if (b.classList.contains("ipp-btn")) {
        const g = (x: string) => (box.querySelector(`#ip-${CSS.escape(c.id)}-${x}`) as HTMLInputElement);
        const name = g("name").value.trim(), email = g("email").value.trim(), phone = g("phone").value.trim();
        const scope = ((box.querySelector(`input[name="ip-${CSS.escape(c.id)}-scope"]:checked`) as HTMLInputElement | null)?.value || "item") as "item" | "group";
        if (!name || !EMAIL_RE.test(email)) { msg("Please enter the point person’s name and email.", true); (name ? g("email") : g("name")).focus(); return; }
        if (phone && digits(phone) < 7) { msg("Please check the phone number.", true); g("phone").focus(); return; }
        const list = (itemPeople[c.id] = itemPeople[c.id] || []);
        if (list.length + (c.pointPeople || []).length >= MAXPP) { msg(`Up to ${MAXPP} point people per ${one}.`, true); return; }
        list.push({ name, email, phone, best: "", scope });
        saveItemPeople(); touch(); ippList();
        ippMode[c.id] = ""; rerender(c);
        msg(`${name} will be added when you press Finalize and Submit; we’ll email them to confirm.`);
        return;
      }
      if (b.classList.contains("ipp-rm")) {
        (itemPeople[c.id] || []).splice(Number(b.getAttribute("data-i")), 1);
        saveItemPeople(); touch(); ippList(); return;
      }
      if (b.classList.contains("pill-add")) {
        editing[c.id] = true; rerender(c);
        const i = document.querySelector(`#card-${CSS.escape(c.id)} [data-k="${b.getAttribute("data-f")}"]`) as HTMLElement | null;
        i?.scrollIntoView({ block: "center" }); i?.focus();
        return;
      }
      if (b.classList.contains("edit-btn")) { editing[c.id] = true; rerender(c); const i = document.querySelector(`#card-${CSS.escape(c.id)} [data-k]`) as HTMLElement | null; i?.focus(); return; }
      if (b.classList.contains("done-btn")) {
        const fs: Obj = {};
        box.querySelectorAll<HTMLInputElement>("[data-k]").forEach((i) => {
          const key = i.getAttribute("data-k")!, v = i.type === "checkbox" ? i.checked : i.value.trim(), orig = c[key];
          const differs = i.type === "checkbox" ? v !== isOn(orig) : String(v) !== String(orig || "").slice(0, i.type === "datetime-local" ? 16 : i.type === "date" ? 10 : 9999);
          if (differs) fs[key] = v;
        });
        if (fresh && !String(fs.name || "").trim()) { msg(`Please give the new ${one} a name.`, true); (box.querySelector('[data-k="name"]') as HTMLElement | null)?.focus(); return; }
        s.fields = fs; s.decision = "approve"; touch(); editing[c.id] = false; return rerender(c);
      }
      if (b.classList.contains("cancel-btn")) { if (fresh && !String((s.fields || {}).name || "").trim()) return drop(); editing[c.id] = false; return rerender(c); }
      if (b.classList.contains("ok")) { s.decision = s.decision === "approve" ? "" : "approve"; touch(); return rerender(c); }
      if (b.classList.contains("rm")) { if (fresh) return drop(); s.decision = s.decision === "remove" ? "" : "remove"; touch(); return rerender(c); }
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
  let vArgs = { since: "", lost: false, tookAt: "" };
  const viewerText = () => vArgs.lost
    ? `${holder} took over editing${vArgs.tookAt ? " at " + timeOf(vArgs.tookAt) : ""}. Your changes ${lastAutosave ? "up to " + lastAutosave : "up to the last automatic save"} were kept.`
    : `${holder} is editing this page right now${vArgs.since ? " (since " + timeOf(vArgs.since) + ")" : ""}. You can look, or take over.`;
  /** The editor typed their name (or changed): refresh the banner text without redrawing the page. */
  function holderNow(name: string) {
    const h = name || "Someone";
    if (h === holder) return;
    holder = h;
    if (!editor && !stale) showBanner(viewerText());
  }
  function becomeViewer(heldBy: string, since: string, lost = false, tookAt = "") {
    editor = false;
    holder = heldBy || "Someone";
    vArgs = { since, lost, tookAt };
    Object.keys(editing).forEach((k) => delete editing[k]);
    showBanner(viewerText());
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
      const body: Obj = { action: "ping", token, sid, name: myName(), draftAt, baseSubmittedAt };
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
        else if (r.draft) { holderNow(r.heldBy); render(); }
        else holderNow(r.heldBy);
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
      itemPeople: Object.fromEntries(Object.entries(itemPeople).filter(([id, l]) => l.length && cards.some((c) => c.id === id) && S(id).decision !== "remove")),
    };
  }
  function ready(): boolean {
    if (!who.name || !EMAIL_RE.test(who.email)) {
      msg("Please enter your name and email under Point people first.", true);
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
      itemPeople = {}; saveItemPeople();
      savedRev = rev;
      showBanner(null);
      $("app").innerHTML = `<div class="box done"><h1>Thank you!</h1><p>Your changes are on the map (${esc(r.summary)}). Check your email for a link to confirm your address as a point person.</p><p>You can open this link again any time to make more changes.</p></div>`;
      $("bar").remove();
    } catch (e) { btn.disabled = false; msg((e as Error).message, true); }
    finally { busy = false; }
  });

  void claim();
}
