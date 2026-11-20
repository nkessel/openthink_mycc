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
  clearInterval((window as unknown as { __loadingTimer?: number }).__loadingTimer);
  document.body.innerHTML = "";
  const p = document.createElement("p");
  p.className = "msgpage";
  p.textContent = text;
  document.body.appendChild(p);
}

/** The page as last loaded on this device (speed, Nov 20): shown at once on the next visit while a fresh copy loads. */
const keepKey = (token: string): string => "confirm.data." + token;
const sameData = (a: Obj, b: Obj) => { const x = (d: Obj) => JSON.stringify({ ...d, draft: null, draftAt: "" }); return x(a) === x(b); };
/** Set by start(): what to do when the fresh copy differs from the remembered one. */
let onNewer: (() => void) | null = null;

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
  await null; // let the rest of this module load first (its constants are defined below the routes)
  let data: Obj;
  // Round 5 (Nov 19): ask for the editing lock at the same time as the data (they used to run one after the other).
  let me = "";
  try { me = String((JSON.parse(localStorage.getItem("confirm.me") || "null") || {}).name || "").trim(); } catch { /* ignore */ }
  const claimP: Promise<Obj> = call({ action: "claim", token, sid: sessionId(), name: me }).catch((e) => ({ ok: false, error: (e as Error).message }));
  const fresh = call(null, `api=confirm&t=${encodeURIComponent(token)}`);
  let kept: Obj | null = null;
  try { kept = JSON.parse(localStorage.getItem(keepKey(token)) || "null"); } catch { /* ignore */ }
  if (kept && kept.org) {
    // Repeat visit: show the remembered page now; swap in the fresh copy if anything changed.
    finishLoading();
    start(kept, token, claimP);
    fresh.then((r) => {
      if (!r.ok) return;
      try { localStorage.setItem(keepKey(token), JSON.stringify(r.data)); } catch { /* ignore */ }
      if (!sameData(kept!, r.data)) onNewer?.();
    }).catch(() => { /* the remembered page stays */ });
    return;
  }
  // Loading screen (round 4, Nov 19): the map's server (Google Apps Script) can take several seconds to wake up.
  const note = document.getElementById("loading-note");
  const steps: [number, string][] = [[1800, "Reading your group’s information…"], [4500, "Gathering events, projects and actions…"], [8000, "Putting your page together…"], [15000, "Still working: the map’s server is slow right now. Thanks for your patience!"]];
  const slow = steps.map(([ms, text]) => setTimeout(() => { if (note) note.textContent = text; }, ms));
  try {
    const r = await fresh;
    slow.forEach(clearTimeout);
    if (!r.ok) return msgPage(String(r.error || "This link doesn't work."));
    data = r.data;
  } catch (e) {
    return msgPage((e as Error).message);
  }
  try { localStorage.setItem(keepKey(token), JSON.stringify(data)); } catch { /* ignore */ }
  finishLoading();
  start(data, token, claimP);
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
  abbrev: "Short name or acronym", type: "Type of group", remote: "",
  hq_address: "Address for your map pin (a street address, or just a town)",
  topic_tags: "Topics", focus_tags: "Focus areas", youth_serving: "Youth group",
  school_club: "School or campus club", membership_size: "Active membership (about how many people)",
  recurrence: "Repeats (for example: Every Tuesday, 6–7 PM)", skills_needed: "Skills you’re looking for (separated by commas)",
  help_wanted: "Looking for help with this", free_food: "Free food provided", affiliated_only: "Only for members or affiliates", urgency: "How urgent",
};
/** Short names for the "add missing info" pills on the group card. */
const PILL: Obj = {
  description: "Description", abbrev: "Short name", type: "Type of group", website: "Website", social_links: "Social media",
  public_contact: "Public contact", geographic_focus: "Where you work", geographic_scope: "Geographic scope", topic_tags: "Topics",
  focus_tags: "Focus areas", membership_size: "Membership size", hq_address: "Map pin address",
  location: "Location", link: "Web page", skills_needed: "Skills wanted", end: "End time", recurrence: "Repeats", rsvp_link: "Sign-up link",
  deadline: "Deadline", urgency: "Urgency",
};
/** Main social platforms, from what the groups' own websites link to (Nov 13 check): Facebook 105, Instagram 76,
 *  X/Twitter 46, LinkedIn 43, YouTube 41; then Bluesky 16 and TikTok 15, which go under Other. */
const handle = (v: string) => v.replace(/^@/, "").trim();
const asUrl = (v: string) => (/^[^\s]+\.[a-z]{2,}(\/|$)/i.test(v.replace(/^https?:\/\//i, "")) ? (/^https?:\/\//i.test(v) ? v : "https://" + v) : "");
const SOCIAL: { id: string; label: string; re: RegExp; hint: string; url: (v: string) => string; more?: boolean }[] = [
  { id: "instagram", label: "Instagram", re: /instagram\.com/i, hint: "instagram.com/yourgroup or @yourgroup", url: (v) => asUrl(v) || (/^@?[\w.]{1,30}$/.test(v) ? "https://www.instagram.com/" + handle(v) : "") },
  { id: "facebook", label: "Facebook", re: /facebook\.com|fb\.com/i, hint: "facebook.com/yourgroup", url: (v) => asUrl(v) || (/^@?[\w.-]{1,50}$/.test(v) ? "https://www.facebook.com/" + handle(v) : "") },
  { id: "x", label: "X (Twitter)", re: /(^|[/.])(x|twitter)\.com/i, hint: "x.com/yourgroup or @yourgroup", url: (v) => asUrl(v) || (/^@?\w{1,15}$/.test(v) ? "https://x.com/" + handle(v) : "") },
  { id: "linkedin", label: "LinkedIn", re: /linkedin\.com/i, hint: "linkedin.com/company/yourgroup", url: (v) => asUrl(v) || (/^[\w-]{2,100}$/.test(v) ? "https://www.linkedin.com/company/" + v : "") },
  { id: "youtube", label: "YouTube", re: /youtube\.com|youtu\.be/i, hint: "youtube.com/@yourgroup or @yourgroup", url: (v) => asUrl(v) || (/^@?[\w.-]{3,30}$/.test(v) ? "https://www.youtube.com/@" + handle(v) : "") },
  // Under "Other social" (round 6): the next most common, then any other link.
  { id: "bluesky", label: "Bluesky", more: true, re: /bsky\.app/i, hint: "bsky.app/profile/yourgroup or @yourgroup.bsky.social", url: (v) => asUrl(v.replace(/^@/, "")) && !/^@?[\w-]+\.bsky\.social$/i.test(v) ? asUrl(v) : (/^@?[\w.-]{3,60}$/.test(v) ? "https://bsky.app/profile/" + handle(v) : "") },
  { id: "tiktok", label: "TikTok", more: true, re: /tiktok\.com/i, hint: "tiktok.com/@yourgroup or @yourgroup", url: (v) => asUrl(v) || (/^@?[\w.]{2,24}$/.test(v) ? "https://www.tiktok.com/@" + handle(v) : "") },
  { id: "threads", label: "Threads", more: true, re: /threads\.(net|com)/i, hint: "threads.net/@yourgroup or @yourgroup", url: (v) => asUrl(v) || (/^@?[\w.]{1,30}$/.test(v) ? "https://www.threads.net/@" + handle(v) : "") },
  { id: "mastodon", label: "Mastodon", more: true, re: /mastodon|mstdn/i, hint: "mastodon.social/@yourgroup (the full link)", url: (v) => asUrl(v) },
  { id: "linktree", label: "Linktree", more: true, re: /linktr\.ee/i, hint: "linktr.ee/yourgroup", url: (v) => asUrl(v) || (/^@?[\w.]{2,30}$/.test(v) ? "https://linktr.ee/" + handle(v) : "") },
  { id: "other", label: "Other link", more: true, re: /$^/, hint: "Paste the full link", url: (v) => asUrl(v) },
];
/** Brand colours, lightened to read on the dark page (round 7). YouTube's red is softened so it isn't read as "remove". */
const BRAND: Record<string, string> = { instagram: "#f06292", facebook: "#5b9cf5", x: "#e5e7eb", linkedin: "#4fa3e0", youtube: "#ff7a7a", bluesky: "#4aa8ff", tiktok: "#5ee8e3", threads: "#d1d5db", mastodon: "#8b8cff", linktree: "#5be37a", other: "#a1a8b3" };
/** Missing-info pills per card kind (round 7): the most-used as pills, the rest behind "+ N more". */
const MAIN_PILLS: Record<string, string[]> = {
  org: ["description", "website", "public_contact", "topic_tags"], coalition: ["description", "website", "focus_tags"],
  event: ["description", "location", "link", "topic_tags"], project: ["description", "link", "skills_needed", "topic_tags"],
  action: ["description", "link", "deadline", "skills_needed"],
};
const LESSER_PILLS: Record<string, string[]> = {
  org: ["abbrev", "type", "geographic_focus", "hq_address", "membership_size"], coalition: ["abbrev", "geographic_scope"],
  event: ["end", "recurrence", "rsvp_link", "public_contact"], project: ["location", "public_contact"], action: ["urgency"],
};
const BOOLS = ["online", "remote", "youth_serving", "school_club", "free_food", "affiliated_only", "help_wanted"];
const CHOICES: Record<string, [string, string][]> = {
  status: [["active", "Active"], ["planning", "Planning"], ["completed", "Completed"]],
  urgency: [["", "Not set"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]],
  type: [["unknown", "Not set"], ["501c3", "501(c)(3) nonprofit"], ["501c4", "501(c)(4)"], ["school_club", "School club"], ["campus_group", "Campus group"],
    ["youth_org", "Youth organization"], ["faith_org", "Faith organization"], ["union", "Union"], ["business", "Business"], ["university", "University"],
    ["municipal", "Municipal"], ["volunteer", "Volunteer group"], ["professional", "Professional association"], ["media", "Media"], ["coalition", "Coalition"],
    // Round 7 (Nov 20): two types already in our data that the menu was missing, and Other
    ["informal_group", "Informal / grassroots group"], ["government", "Government agency"], ["other", "Other"]],
};
const BESTS = ["Email", "Text", "Phone call", "Any"];
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---- Round 7 (Nov 20, design canvas): boxed yes/no questions, topic picker, multi-type
/** Yes/no fields asked as a clear checkbox row: heading, the box, then why we ask (below the box). */
const ASK: Record<string, { text: string; why: string }> = {
  youth_serving: { text: "Yes, most of our members, or the people we serve, are age 25 or younger <span class=\"hint\">(e.g. high school, college or young-adult groups)</span>", why: "Why we ask: so young people can find you with the map’s youth filter." },
  remote: { text: "Don’t show a pin for us <span class=\"hint\">(check this if you have no public location)</span>", why: "Why we ask: a pin helps people nearby find you." },
};
/** Topic tags are stored as slugs (climate_policy) and shown as words (Climate policy). */
const topicSlug = (t: string) => t.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
const splitList = (v: unknown) => String(v || "").split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
/** Topic names for slugs (filled from the Wikipedia topic list once it loads; else "climate_policy" → "Climate policy"). */
const TOPIC_LABEL: Record<string, string> = {};
const topicName = (t: string) => TOPIC_LABEL[topicSlug(String(t))] || cap(String(t).trim().replace(/_/g, " "));
/** Suggestions (round 7): the map's Wikipedia topic list (Turibius's schema: 13 main topics and the topics under them),
 *  ranked by how many groups' items it's found in, plus any topic a group already typed. Loaded once, when needed. */
let TOPICS: Promise<[string, number][]> | null = null;
function mapTopics(): Promise<[string, number][]> {
  if (TOPICS) return TOPICS;
  const base = import.meta.env.BASE_URL;
  const n: Record<string, number> = {};
  const wiki = fetch(base + "topics-wiki.json", { credentials: "omit" }).then((r) => r.json()).then((d: Obj) => {
    const used: Record<string, number> = {};
    (d.records || []).forEach((r: Obj) => (r.topics || []).forEach((q: string) => { used[q] = (used[q] || 0) + 1; }));
    (d.parents || []).forEach((p: Obj) => {
      const ps = topicSlug(p.label); TOPIC_LABEL[ps] = p.label;
      n[ps] = Math.max(n[ps] || 0, 1000 + (p.children || []).reduce((a: number, ch: Obj) => a + (used[ch.id] || 0), 0)); // main topics first
      (p.children || []).forEach((ch: Obj) => { const cs = topicSlug(ch.label); TOPIC_LABEL[cs] = ch.label; n[cs] = Math.max(n[cs] || 0, used[ch.id] || 0); });
    });
  }).catch(() => undefined);
  const tags = fetch(base + "data.json", { credentials: "omit" }).then((r) => r.json()).then((d: Obj) => {
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (!o || typeof o !== "object") return;
      for (const k of ["topic_tags", "focus_tags"]) {
        const v = (o as Obj)[k];
        (Array.isArray(v) ? v : splitList(v)).forEach((t: string) => { const s = topicSlug(String(t)); if (s) n[s] = (n[s] || 0) + 1; });
      }
      Object.values(o).forEach(walk);
    };
    walk(d);
  }).catch(() => undefined);
  TOPICS = Promise.all([wiki, tags]).then(() => Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return TOPICS;
}
/** Shown next to a suggestion: main topics say so; others say how often they're used. */
const topicNote = (n: number) => (n >= 1000 ? "main topic" : n ? `used ${n} time${n === 1 ? "" : "s"} on the map` : "");

/** A pill picker (topics or group types): pills with ✕, a box to type in, suggestions under it. Keeps its value in a
 *  hidden input with data-k (or data-pk), so the card's Done/Add code reads it like any other field. */
function picker(id: string, key: string, value: string, attr: "data-k" | "data-pk"): HTMLElement {
  const isType = key === "type";
  const wrap = el(`<div class="picker${isType ? " ptype" : ""}"><input type="hidden" id="${id}" ${attr}="${key}"><div class="pbox"><span class="ptoks"></span><input class="pin" id="${id}-q" autocomplete="off" aria-autocomplete="list" placeholder="${isType ? "Pick a type…" : "Type a topic…"}"></div><div class="psug" role="listbox" hidden></div><div class="ppop"></div></div>`);
  const hidden = wrap.querySelector(`#${CSS.escape(id)}`) as HTMLInputElement;
  const toks = wrap.querySelector(".ptoks") as HTMLElement, q = wrap.querySelector(".pin") as HTMLInputElement;
  const sug = wrap.querySelector(".psug") as HTMLElement, pop = wrap.querySelector(".ppop") as HTMLElement;
  let list = isType ? splitList(value).filter((t) => t !== "unknown") : splitList(value).map(topicSlug).filter(Boolean);
  let vocab: [string, number][] = isType ? CHOICES.type.filter(([o]) => o !== "unknown").map(([o]) => [o, 0]) : [];
  const name = (t: string) => (isType ? (CHOICES.type.find((x) => x[0] === t) || [t, topicName(t)])[1] : topicName(t));
  let hi = 0;
  const max = isType ? 4 : 20;
  const sync = () => {
    hidden.value = isType ? list.join(",") : list.join(", ");
    toks.innerHTML = list.map((t, i) => `<span class="ptok">${esc(name(t))}<button type="button" class="px" data-i="${i}" aria-label="Remove ${esc(name(t))}">✕</button></span>`).join("");
    const rest = vocab.filter(([t]) => !list.includes(t));
    pop.innerHTML = list.length >= max ? "" : !isType && !q.value && rest.length ? `<span class="hint">Popular:</span>${rest.slice(0, 4).map(([t]) => `<button type="button" class="pchip" data-t="${esc(t)}">+ ${esc(name(t))}</button>`).join("")}` : "";
    q.placeholder = list.length >= max ? `Up to ${max}` : list.length ? (isType ? "Add another type…" : "Add another…") : isType ? "Pick a type…" : "Type a topic…";
    q.disabled = list.length >= max || hidden.disabled;
  };
  const add = (t: string) => {
    const s = isType ? t : topicSlug(t);
    if (!s || list.includes(s) || list.length >= max) return;
    list.push(s); q.value = ""; sug.hidden = true; sync();
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const show = () => {
    const term = topicSlug(q.value);
    const hits = vocab.filter(([t]) => !list.includes(t) && (!term || t.includes(term) || name(t).toLowerCase().includes(q.value.trim().toLowerCase()))).slice(0, isType ? 20 : 6);
    const exact = hits.some(([t]) => t === term) || list.includes(term);
    const rows = hits.map(([t, n]) => `<div class="popt" role="option" data-t="${esc(t)}"><span>${esc(name(t))}</span>${topicNote(n) ? `<span class="hint">${topicNote(n)}</span>` : ""}</div>`);
    if (!isType && term && !exact) rows.push(`<div class="popt new" role="option" data-t="${esc(term)}"><span>+ Add “${esc(q.value.trim())}” as a new topic</span><span class="hint">if nothing fits</span></div>`);
    sug.innerHTML = rows.join("");
    hi = Math.min(hi, Math.max(0, rows.length - 1));
    sug.querySelectorAll(".popt").forEach((o, i) => o.classList.toggle("hi", i === hi));
    sug.hidden = !rows.length || (!q.value && !isType) || document.activeElement !== q;
  };
  q.addEventListener("input", () => { hi = 0; show(); sync(); });
  q.addEventListener("focus", () => { if (isType) show(); });
  q.addEventListener("blur", () => setTimeout(() => { sug.hidden = true; }, 150));
  q.addEventListener("keydown", (e) => {
    const opts = Array.from(sug.querySelectorAll<HTMLElement>(".popt"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); hi = (hi + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % Math.max(1, opts.length); show(); return; }
    if (e.key === "Enter" || e.key === "," || (e.key === "Tab" && q.value.trim())) {
      if (!q.value.trim() && e.key !== "Enter") return;
      e.preventDefault();
      const pick = !sug.hidden && opts[hi] ? opts[hi].getAttribute("data-t")! : isType ? "" : q.value;
      if (pick) add(pick);
      return;
    }
    if (e.key === "Backspace" && !q.value && list.length) { list.pop(); sync(); hidden.dispatchEvent(new Event("input", { bubbles: true })); }
    if (e.key === "Escape") { sug.hidden = true; }
  });
  wrap.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest(".popt")) e.preventDefault(); });
  wrap.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const o = t.closest(".popt"), x = t.closest(".px"), c = t.closest(".pchip");
    if (o) { add(o.getAttribute("data-t")!); q.focus(); }
    else if (c) { add(c.getAttribute("data-t")!); }
    else if (x) { list.splice(Number(x.getAttribute("data-i")), 1); sync(); hidden.dispatchEvent(new Event("input", { bubbles: true })); q.focus(); }
    else if (t.closest(".pbox")) q.focus();
  });
  if (!isType) void mapTopics().then((v) => { vocab = v; sync(); });
  sync();
  return wrap;
}

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

/** Fills the loading bar before the page appears. */
function finishLoading() {
  const bar = document.getElementById("loading-bar");
  clearInterval((window as unknown as { __loadingTimer?: number }).__loadingTimer);
  const eta = document.getElementById("loading-eta");
  if (eta) eta.textContent = "Done!";
  if (bar) { bar.style.transition = "width .25s ease-out"; bar.style.width = "100%"; }
}

function start(DATA: Obj, token: string, claimP?: Promise<Obj>) {
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
  /** Extra point person rows shown (round 5: behind "+ Add another point person"). */
  let othersShown = others.filter((o) => o.name || o.email).length;
  /** Who the point person is (round 7): me, me and others, or someone else (then the visitor isn't added). */
  let ppMode: "me" | "team" | "else" = othersShown ? "team" : "me";
  try { const m = localStorage.getItem("confirm.ppmode." + token); if (m === "me" || m === "team" || m === "else") ppMode = m; } catch { /* ignore */ }
  if (ppMode !== "me" && !othersShown) othersShown = 1;
  /** Description cards opened with "Show all", and the open pill rows (round 7). */
  const expanded: Record<string, boolean> = {};
  let rowOpen: "" | "social" | "social2" | "more" = "";
  let pillCard = "";
  const pillDraft: Record<string, string> = {};
  let caretFrom = -1, lastRow = "", pfWasOpen = false;
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
    p.querySelector("b")!.textContent = `${a} of ${n}`;
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
    return Math.max(0, MAXPP - pointPeople.length - (onFile || ppMode === "else" ? 0 : 1));
  }

  // ---- steps (round 7): the same four steps at the top and on the Next button
  const steps = () => [
    { id: "step-1", label: `Review your ${coalition ? "coalition" : "group"}` },
    { id: "point-people", label: "Add point people" },
    { id: "step-3", label: "Review events, projects & actions" },
    { id: "step-4", label: "Submit" },
  ];
  /** The step whose part of the page is on screen (the last one whose top has passed 40% of the window). */
  function stepNow(): number {
    const line = innerHeight * 0.4;
    let n = 0;
    steps().forEach((x, i) => { const e = document.getElementById(x.id); if (e && e.getBoundingClientRect().top <= line) n = i; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) n = steps().length - 1;
    return n;
  }
  function goStep(i: number) {
    const x = steps()[i], e = document.getElementById(x.id);
    if (!e) return;
    e.scrollIntoView({ block: "start", behavior: calm.matches ? "auto" : "smooth" });
    if (i === steps().length - 1) ($("submit") as HTMLElement).focus({ preventScroll: true });
  }
  function syncSteps() {
    const n = stepNow(), all = steps(), nx = document.getElementById("next");
    document.querySelectorAll<HTMLElement>(".steps .step").forEach((b, i) => { if (i === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); });
    if (!nx) return;
    const last = n >= all.length - 1;
    nx.hidden = last;
    if (!last) { nx.textContent = innerWidth < 560 ? "Next ↓" : `Next: ${all[n + 1].label} ↓`; nx.title = `Next: ${all[n + 1].label}`; }
  }

  // ---- rendering
  function render() {
    syncNewCards();
    const app = $("app");
    app.innerHTML = "";
    app.appendChild(el(`<div><h1>Check ${esc(DATA.org.name)}’s information</h1><p class="lead">All of this group information was retrieved from online sources. Approve what’s right, edit what isn’t, and add anything we missed with the <b>+</b> buttons. Approved information goes live when you press <b>Finalize and Submit</b> (at the end of the page); <b>Save for later</b> keeps your work.</p>
      <div class="steps">${steps().map((x, i) => `<button type="button" class="step" data-i="${i}"><span class="num">${i + 1}</span>${esc(x.label)}</button>`).join("")}</div></div>`));
    app.querySelectorAll<HTMLElement>(".step").forEach((b) => b.addEventListener("click", () => goStep(Number(b.getAttribute("data-i")))));
    if (baseSubmittedAt) app.appendChild(el(`<div class="box done">Thank you: this was submitted on ${esc(new Date(baseSubmittedAt).toLocaleDateString())}. You can check it again and submit any changes.</div>`));
    // Round 7: the progress count sits in the bar at the bottom, next to Submit.
    if (!document.getElementById("progress")) {
      $("bar").prepend(el(`<div class="progress" id="progress"><span class="ptext"><b></b> cards approved</span><div class="pbar" aria-hidden="true"><span></span></div></div>`));
      // Next (round 7, Nathan): walks through the steps; its label names the next one.
      const nx = el(`<button type="button" id="next" class="nextbtn"></button>`);
      document.getElementById("progress")!.after(nx);
      nx.addEventListener("click", () => goStep(Math.min(steps().length - 1, stepNow() + 1)));
      let raf = 0;
      window.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncSteps(); }); }, { passive: true });
    }
    requestAnimationFrame(syncSteps);
    const onFileNames = pointPeople.map((p) => esc(p.name || p.email) + (p.pending ? " (waiting to confirm)" : "")).join(", ");
    // Nov 20 (Nathan): each part of the page is titled with its step, in the same words as the steps at the top.
    const stepTitle = (n: number, id?: string) => `<h2 class="steph"${id ? ` id="${id}"` : ""}><span class="num">${n}</span>${esc(steps()[n - 1].label)}</h2>`;
    app.appendChild(el(stepTitle(1, "step-1")));
    app.appendChild(card(DATA.org as Card));
    // Point people (round 7, Nov 20 design canvas, option B): a question, the description, details under Learn more.
    const gname = esc(DATA.org.name);
    app.appendChild(el(`<div class="box pp-box" id="point-people">${stepTitle(2)}<p class="ppq"><b>Who is your group’s point person?</b></p>
      <p>Point people are your group’s main contacts and editors on the map: each gets a personal link to update your group’s description, events, projects and actions any time.</p>
      <button type="button" class="fold" id="pp-more" aria-expanded="false">Learn more ▸</button>
      <div class="foldbody" id="pp-more-body" hidden><p class="pp">A group can have up to ${MAXPP} point people. Someone who only runs one event or project can be the point person for just that item: press <b>Edit</b> on its card below. We email every new point person a link to confirm their address. Emails and phone numbers are only seen by the map’s core team, never shown on the map.${onFileNames ? ` <b>Already on file: ${onFileNames}.</b>` : ""}</p></div>
      <div class="decide ppmode" role="group" aria-label="Who is the point person?"><button type="button" data-m="me">Me</button><button type="button" data-m="team">Me and others</button><button type="button" data-m="else">Someone else</button></div>
      <div class="row2" style="margin-top:6px">
      <div><label for="pname">Your name</label><input id="pname" autocomplete="name"></div>
      <div><label for="pemail">Your email</label><input id="pemail" type="email" autocomplete="email"></div></div>
      <p class="hint" id="pp-self-note"></p>
      <div class="row2">
      <div><label for="pphone">Phone (optional)</label><input id="pphone" type="tel" autocomplete="tel"></div>
      <div><label for="pbest">Best way to reach you</label><select id="pbest">${bestOptions()}</select><p class="hint" id="pbest-hint"></p></div></div>
      <p class="note" id="others-note" aria-live="polite"></p>${[0, 1].map(otherRow).join("")}
      <button type="button" class="add-other" id="add-other">+ Add another point person</button>
      <div class="decide pp-savebar"><button type="button" class="primary" id="pp-save">Save point person</button><span class="hint" id="pp-saved" aria-live="polite"></span></div></div>`));
    $("pp-save").addEventListener("click", () => {
      if (!editor) return;
      if (!who.name || !EMAIL_RE.test(who.email)) { $("pp-saved").textContent = "Add your name and email first."; inp(who.name ? "pemail" : "pname").focus(); return; }
      if (ppMode !== "me" && (!others[0].name || !EMAIL_RE.test(others[0].email))) { $("pp-saved").textContent = "Add the point person’s name and email first."; inp(others[0].name ? "o0email" : "o0name").focus(); return; }
      $("pp-saved").textContent = "Saving…";
      void saveNow().then((ok) => { $("pp-saved").textContent = ok ? `✓ Saved. ${ppMode === "else" ? "They’ll" : "You’ll"} be added when you press Finalize and Submit.` : "Couldn’t save. Please try again."; });
    });
    const fold = (btn: string, body: string, open?: boolean) => {
      const b = $(btn), d = $(body), box = $("point-people");
      const set = (on: boolean, anim: boolean) => {
        const h0 = box.offsetHeight;
        d.hidden = !on; b.setAttribute("aria-expanded", String(on));
        if (btn === "pp-more") b.textContent = on ? "Learn more ▾" : "Learn more ▸";
        else b.hidden = on;
        if (anim) { glide(box, h0); if (on) d.classList.add("reveal"); }
      };
      set(!!open, false);
      b.addEventListener("click", () => set(d.hidden, true));
    };
    fold("pp-more", "pp-more-body");
    $("point-people").querySelectorAll<HTMLButtonElement>(".ppmode button").forEach((b) => b.addEventListener("click", () => {
      if (!editor) return;
      const box = $("point-people"), h0 = box.offsetHeight;
      ppMode = b.getAttribute("data-m") as typeof ppMode;
      try { localStorage.setItem("confirm.ppmode." + token, ppMode); } catch { /* ignore */ }
      if (ppMode !== "me" && othersShown === 0) othersShown = 1;
      touch(); syncOthers(); glide(box, h0);
      if (ppMode !== "me") { $("orow0").classList.add("reveal"); inp("o0name").focus({ preventScroll: true }); } else inp("pname").focus({ preventScroll: true });
    }));
    $("add-other").addEventListener("click", () => {
      if (!editor) return;
      othersShown = Math.min(2, othersShown + 1);
      const ppb = $("point-people"), h0 = ppb.offsetHeight;
      syncOthers();
      glide(ppb, h0);
      const row = $("orow" + (othersShown - 1));
      row.classList.add("reveal");
      inp(`o${othersShown - 1}name`).focus({ preventScroll: true });
    });
    wirePerson("p", () => who, (p) => { who = p; });
    [0, 1].forEach((i) => wirePerson("o" + i, () => others[i], (p) => { others[i] = p; }));
    syncOthers();
    app.appendChild(el(stepTitle(3, "step-3")));
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
    app.appendChild(el(stepTitle(4, "step-4")));
    app.appendChild(el(`<div class="box approve-all" id="approve-all-box"><button type="button" class="primary" id="approve-all">✓ Approve all</button><p class="hint">Approves every card you haven’t marked Remove.</p></div>`));
    $("approve-all").addEventListener("click", () => {
      if (!editor) return;
      if (Object.values(editing).some(Boolean)) return msg("Press “Done editing” on the open card first.", true);
      cards.forEach((c) => { const s = S(c.id); if (s.decision !== "remove") s.decision = "approve"; });
      touch();
      cards.forEach(rerender);
      msg(`Approved ${cards.filter((c) => S(c.id).decision === "approve").length} card(s). Review anything you like, then press Finalize and Submit.`);
    });
    // Feedback for the map team (Nathan, Nov 17): sent with Finalize and Submit, saved with the draft.
    app.appendChild(el(`<div class="box"><h2 style="margin-top:0"><label for="fb">Ideas or comments for the development team (optional)</label></h2>
      <p class="pp">What would make the map most useful for ${esc(DATA.org.name)}? Anything else you’d like to share with the map’s team? We read every note.</p>
      <textarea id="fb" class="grow" rows="2" maxlength="3000"></textarea></div>`));
    const fb = $("fb") as HTMLTextAreaElement;
    fb.value = String(st.feedback || "");
    const grow = () => { fb.style.height = "auto"; fb.style.height = fb.scrollHeight + 2 + "px"; };
    fb.addEventListener("input", () => { st.feedback = fb.value; touch(); grow(); });
    requestAnimationFrame(grow);
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
    (box?.querySelector("[data-k]") as HTMLElement | null)?.focus({ preventScroll: true });
  }
  const bestOptions = () => `<option value="">No preference</option>` + BESTS.map((b) => `<option>${b}</option>`).join("");
  function otherRow(i: number) {
    return `<div class="other" id="orow${i}"><div class="ohead"><h3 id="ohead${i}">Point person</h3><span class="hint" id="oroom${i}"></span></div><div class="row2">
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
    const team = ppMode !== "me";
    $("point-people").querySelectorAll<HTMLButtonElement>(".ppmode button").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-m") === ppMode)));
    $("pp-self-note").textContent = ppMode === "else" ? "We need your name and email to submit. You won’t be listed as a point person." : "";
    [0, 1].forEach((i) => {
      $("orow" + i).hidden = !team || i >= othersShown;
      $("ohead" + i).textContent = ppMode === "else" ? `Point person ${i + 1}` : `Point person ${i + 2}`;
      const left = Math.min(2, free) - (i + 1);
      $("oroom" + i).textContent = i === othersShown - 1 && left > 0 ? `· room for ${left} more` : "";
    });
    ($("add-other") as HTMLButtonElement).hidden = !team || othersShown >= Math.min(2, free);
    [0, 1].forEach((i) => {
      const on = i < free && editor;
      ["name", "email", "phone"].forEach((k) => { inp(`o${i}${k}`).disabled = !on; });
      $("orow" + i).classList.toggle("off", i >= free);
      if (on) syncBest("o" + i);
      else inp(`o${i}best`).disabled = true;
    });
    $("others-note").textContent = team && free <= 0 ? (pointPeople.length >= MAXPP ? `Your group already has ${MAXPP} point people, so no more can be added here.` : "No space left: one place is kept for you.") : "";
  }

  /** The one field a missing-info pill opens, right under the pills (round 5). */
  function pillField(c: Card, f: string): HTMLElement {
    const id = `pf-${esc(c.id)}`;
    let input = "", label: string;
    if (f.startsWith("social:")) {
      const pf = SOCIAL.find((x) => "social:" + x.id === f)!;
      label = pf.id === "other" ? "Link to another social media account or page" : `Your ${pf.label} page`;
      input = `<input id="${id}" data-pk="1" placeholder="${esc(pf.hint)}" autocomplete="off">`;
    } else if (f === "description") {
      label = LABEL[f]; input = `<textarea id="${id}" data-pk="1"></textarea>`;
    } else if (f === "website") {
      label = LABEL[f]; input = `<input id="${id}" data-pk="1" type="url" placeholder="https://" autocomplete="off">`;
    } else {
      label = LABEL[f] || f;
      if (CHOICES[f]) input = `<select id="${id}" data-pk="1">${CHOICES[f].filter(([o]) => o).map(([o, l]) => `<option value="${esc(o)}">${esc(l)}</option>`).join("")}</select>`;
      else if (f !== "type" && f !== "topic_tags" && f !== "focus_tags") input = `<input id="${id}" data-pk="1" type="${f === "end" ? "datetime-local" : f === "deadline" ? "date" : /link$/.test(f) ? "url" : "text"}"${/link$/.test(f) ? ' placeholder="https://"' : f === "skills_needed" ? ' placeholder="e.g. outreach, design"' : ""} autocomplete="off">`;
    }
    // Round 7: a drawer whose arrow points up at the pill; Cancel (muted) sits left of Add.
    const d = el(`<div class="pillfield"><span class="caret" aria-hidden="true"></span><label for="${f === "type" || f === "topic_tags" || f === "focus_tags" ? id + "-q" : id}">${esc(label)}</label>${input}<div class="decide pf-actions"><button type="button" class="pill-cancel textbtn">Cancel</button><button type="button" class="primary pill-save">Add</button><span class="hint pf-enter">Enter to add</span></div></div>`);
    if (f === "type" || f === "topic_tags" || f === "focus_tags") {
      d.insertBefore(picker(id, f, pillDraft[f] || "", "data-pk"), d.querySelector(".pf-actions"));
      (d.querySelector(".pf-enter") as HTMLElement).textContent = f === "type" ? "Pick all that apply" : "Enter adds a topic";
    } else {
      const i = d.querySelector("[data-pk]") as HTMLInputElement;
      i.value = pillDraft[f] || "";
      i.addEventListener("input", () => { pillDraft[f] = i.value; });
      if (i.tagName === "INPUT") i.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); (d.querySelector(".pill-save") as HTMLElement).click(); } });
    }
    return d;
  }
  /** Points the open drawer's arrow at its pill, sliding over from the last pill (round 7). */
  function aimCaret(box: HTMLElement) {
    const d = box.querySelector(".pillfield") as HTMLElement | null, pill = box.querySelector(`.pill-add[aria-expanded="true"]:not([data-f="social:more"]):not([data-row])`) as HTMLElement | null;
    if (!d || !pill) return;
    const x = pill.getBoundingClientRect().left + pill.offsetWidth / 2 - d.getBoundingClientRect().left - 7;
    const caret = d.querySelector(".caret") as HTMLElement;
    caret.style.left = x + "px";
    if (caretFrom >= 0 && Math.abs(caretFrom - x) > 2 && !calm.matches && caret.animate) caret.animate([{ left: caretFrom + "px" }, { left: x + "px" }], { duration: 200, easing: "cubic-bezier(.2,.7,.3,1)" });
    caretFrom = x;
  }
  let pillOpen: string | null = null;
  /** Moves the open pill state to card c (closing the other card's pills). */
  function openPillsOn(c: Card) {
    const prev = pillCard;
    pillCard = c.id; pillOpen = null; rowOpen = ""; lastRow = ""; pfWasOpen = false; caretFrom = -1;
    const pc = prev && cards.find((x) => x.id === prev);
    if (pc) rerender(pc);
  }

  function card(c: Card): HTMLElement {
    const s = S(c.id), ed = !!editing[c.id], k = c.kind === "org" || c.kind === "coalition" ? "org" : c.kind;
    const sec = k === "org" ? null : sectionOf(c);
    const one = k === "org" ? "group information" : SECTIONS.find((x) => x.key === sec)!.one;
    const fresh = isNew(c.id);
    const keys: string[] = k === "org" ? orgFields : FIELDS[kindOfSec(sec!)] || [];
    const edited = !fresh && s.fields && Object.keys(s.fields).length;
    const box = el(`<div class="box card${sec ? " k-" + sec : ""}${s.decision === "remove" ? " removed" : ""}${ed ? " is-editing" : ""}" id="card-${esc(c.id)}"></div>`);
    const moved = sec && !fresh && s.newType ? `<span class="edited-tag">type changed</span>` : "";
    const tag = sec
      ? `<span class="tagwrap"><button type="button" class="tag tagbtn" aria-haspopup="true" aria-expanded="false" aria-label="Type: ${esc(KIND_BASE[sec])}. Change type">${esc(KIND_BASE[sec])} <span aria-hidden="true">▾</span></button><span class="typemenu" role="menu" hidden>${SECTIONS.map((x) => `<button type="button" role="menuitem" class="typeopt k-${x.key}" data-type="${x.key}"${x.key === sec ? ' aria-current="true"' : ""}><span class="topt-icon"></span>${esc(KIND_BASE[x.key])}</button>`).join("")}</span></span>${moved}`
      : `<span class="kind">${esc(KIND.org)}</span>`;
    const head = `<div class="tagrow">${tag}${fresh ? '<span class="edited-tag">new</span>' : edited ? '<span class="edited-tag">edited</span>' : ""}</div><h3>${esc(val(c, "name") || "(no name)")}</h3>`;
    const typeName = (t: string) => (CHOICES.type.find((x) => x[0] === t) || [t, t])[1];
    const meta = [val(c, "abbrev"), k === "org" ? splitList(val(c, "type")).filter((t) => t !== "unknown").map(typeName).join(", ") : "", when(c), val(c, "recurrence"), val(c, "location"), isOn(val(c, "online")) ? "online" : "", val(c, "status"), val(c, "urgency") ? val(c, "urgency") + " urgency" : "", val(c, "deadline") ? "deadline " + val(c, "deadline") : "", val(c, "geographic_focus"), val(c, "geographic_scope"), val(c, "website") || val(c, "link"), val(c, "social_links"), val(c, "public_contact") ? "contact: " + val(c, "public_contact") : "", val(c, "membership_size") ? "about " + val(c, "membership_size") + " members" : ""].filter(Boolean).map(esc).join(" · ");
    // Round 7: labelled rows, so yes/no facts and topics don't look alike.
    const flags = [["youth_serving", "✓ Youth group"], ["remote", "No pin on the map"], ["free_food", "✓ Free food"], ["affiliated_only", "Members only"]]
      .filter(([f]) => keys.includes(f) && isOn(val(c, f))).map(([, l]) => l).concat(kindOfSec(sec || "event") === "project" && keys.includes("help_wanted") && !isOn(val(c, "help_wanted")) ? ["Not looking for help"] : []);
    const topics = splitList(val(c, "topic_tags") || val(c, "focus_tags") || c.topic_tags).map(topicName);
    const skills = String(val(c, "skills_needed") || "").split(/[,;]\s*/).filter(Boolean);
    const people = k === "org"
      ? pointPeople.map((p) => esc(p.name || p.email) + (p.pending ? " (waiting to confirm)" : ""))
      : [...(c.pointPeople || []).map((p: Obj) => esc(p.name || p.email) + (p.pending ? " (waiting to confirm)" : "")), ...(itemPeople[c.id] || []).map((p) => esc(p.name) + " (new" + (p.scope === "group" ? ", whole group" : "") + ")")];
    if (!ed) {
      box.innerHTML = head + (meta ? `<div class="meta">${meta}</div>` : "") + (val(c, "description") ? `<p class="desc${expanded[c.id] ? "" : " clamp"}">${esc(val(c, "description"))}</p><button type="button" class="textbtn showall" hidden>${expanded[c.id] ? "Show less ▴" : "Show all ▾"}</button>` : `<p class="desc empty">No description yet.</p>`)
        + (flags.length ? `<div class="topics"><span class="tlabel">This ${k === "org" ? "group" : esc(one)}:</span>${flags.map((t) => `<span class="tpill flag">${esc(t)}</span>`).join("")}</div>` : "")
        + (topics.length ? `<div class="topics"><span class="tlabel">${coalition && k === "org" ? "Focus areas" : "Topics"}:</span>${topics.map((t) => `<span class="tpill">${esc(t)}</span>`).join("")}</div>` : "")
        + (skills.length ? `<p class="who">Skills wanted: ${skills.map(esc).join(", ")}</p>` : "")
        + (people.length ? `<p class="who">${k === "org" ? "Point people (can edit everything for this group)" : "Point people"}: ${people.join(", ")}</p>` : "");
    } else {
      let f = "";
      keys.forEach((key) => {
        const v = val(c, key), id = `f-${esc(c.id)}-${key}`;
        if (key === "school_club") return; // round 7: set from "Type of group"
        if (key === "description") f += `<label for="${id}">${LABEL[key]}</label><textarea id="${id}" data-k="${key}">${esc(v)}</textarea>`;
        else if (key === "type" || key === "topic_tags" || key === "focus_tags") f += `<label for="${id}-q">${LABEL[key]} <span class="hint">· ${key === "type" ? "pick all that apply" : "type to search ours, or add your own"}</span></label><div class="pk-slot" data-key="${key}"></div>`;
        else if (key === "hq_address") f += `<label for="${id}">${LABEL[key]}</label><input id="${id}" data-k="${key}" value="${esc(v)}" autocomplete="off"><p class="hint">Only used to place your pin. The address itself isn’t shown on the map.</p>`;
        else if (ASK[key]) f += `${LABEL[key] ? `<p class="asklab">${esc(LABEL[key])}</p>` : ""}<label class="askrow"><input type="checkbox" id="${id}" data-k="${key}"${isOn(v) ? " checked" : ""}><span>${ASK[key].text}</span></label><p class="hint">${esc(ASK[key].why)}</p>`;
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
          ${mode === "ask" ? `<div class="ipp-ask reveal"><p><b>Who is the point person?</b></p><div class="decide" style="margin-top:4px"><button type="button" class="ipp-me">Me</button><button type="button" class="ipp-other">Someone else</button><button type="button" class="ipp-cancel textbtn">Cancel</button></div><p class="hint ipp-note" aria-live="polite"></p></div>` : ""}
          <div class="ipp-add reveal"${mode === "other" ? "" : " hidden"}><div class="row2"><div><label for="ip-${pid}-name">Name</label><input id="ip-${pid}-name" autocomplete="off"></div>
          <div><label for="ip-${pid}-email">Email</label><input id="ip-${pid}-email" type="email" autocomplete="off"></div>
          <div><label for="ip-${pid}-phone">Phone (optional)</label><input id="ip-${pid}-phone" type="tel" autocomplete="off"></div></div>
          <fieldset class="scope"><legend>What can they edit?</legend>
          <label><input type="radio" name="ip-${pid}-scope" value="item" checked> Just this ${esc(one)} <span class="hint">(recommended)</span></label>
          <label><input type="radio" name="ip-${pid}-scope" value="group"> Everything for ${esc(DATA.org.name)} <span class="hint">(makes them a point person for the whole group)</span></label></fieldset>
          <div class="decide" style="margin-top:6px"><button type="button" class="ipp-btn">Add point person</button><button type="button" class="ipp-cancel textbtn">Cancel</button></div></div></fieldset>`;
      }
      box.innerHTML = `<div class="tagrow">${sec ? `<span class="tag">${esc(title)}</span>` : `<span class="kind">${esc(title)}</span>`}</div>${f}<div class="decide"><button type="button" class="cancel-btn textbtn">Cancel</button><button type="button" class="primary done-btn">${fresh ? `Add ${esc(one)}` : "Done editing"}</button></div>`;
      box.querySelectorAll<HTMLElement>(".pk-slot").forEach((slot) => { const key = slot.getAttribute("data-key")!; slot.replaceWith(picker(`f-${c.id}-${key}`, key, String(val(c, key) || ""), "data-k")); });
    }
    if (sec) box.querySelector(".tag")!.prepend(typeIcon(sec, 15));
    box.querySelectorAll<HTMLElement>(".typeopt").forEach((o) => o.querySelector(".topt-icon")!.appendChild(typeIcon(o.getAttribute("data-type") as IconKind, 16)));
    const ippList = () => {
      const ul = box.querySelector(".ipp-list");
      if (!ul) return;
      const on = (c.pointPeople || []).map((p: Obj) => `<li>${esc(p.name || p.email)}${p.pending ? " (waiting to confirm)" : ""}</li>`);
      const mine = (itemPeople[c.id] || []).map((p, i) => `<li>${esc(p.name)} · ${esc(p.email)} · ${p.scope === "group" ? "whole group" : "just this " + esc(one)} <button type="button" class="ipp-rm" data-i="${i}" aria-label="Remove ${esc(p.name)}">Remove</button></li>`);
      ul.innerHTML = on.concat(mine).join("");
    };
    ippList();
    // Pills (round 7): the group card and, since Nathan's Nov 20 ask, every existing item card. One card's pills are open at a time.
    if (!ed && !fresh) {
      const po = pillCard === c.id ? pillOpen : null, ro = pillCard === c.id ? rowOpen : "";
      // Round 7 (Nov 20 canvas): the most-used fields as pills, then one Social media pill (main platforms, then More),
      // then "+ N more" for the lesser-used fields. Each pill opens one field in a drawer pointing at it.
      const missing = (f: string) => keys.includes(f) && (f === "type" ? !splitList(val(c, f)).filter((t) => t !== "unknown").length : !String(val(c, f) || "").trim());
      const ks = k === "org" ? (coalition ? "coalition" : "org") : kindOfSec(sec!);
      const online = isOn(val(c, "online"));
      // Nov 20 (Nathan): every missing field shows as its own pill; "+ N more" hid fields groups should fill in.
      const main = (MAIN_PILLS[ks] || []).concat(LESSER_PILLS[ks] || []).filter(missing).filter((f) => (f !== "hq_address" || !isOn(val(c, "remote"))) && (f !== "location" || !online));
      const lesser: string[] = [];
      const have = String(val(c, "social_links") || "");
      const plat = keys.includes("social_links") ? SOCIAL.filter((x) => !x.more && !x.re.test(have)) : [];
      const plat2 = keys.includes("social_links") ? SOCIAL.filter((x) => x.more && (x.id === "other" || !x.re.test(have))) : [];
      const socialOn = keys.includes("social_links");
      let n = 0;
      // Social platforms use their own brand colours (lightened for the dark page), so they're easy to spot.
      const pill = (f: string, label: string, sub = false) => { const b = BRAND[f.replace("social:", "")]; return `<button type="button" class="pill-add${sub ? " sub" : ""}${b ? "" : " c" + n++ % 3}" data-f="${esc(f)}"${b ? ` style="--pc:${b}"` : ""} aria-expanded="${po === f}">+ ${esc(label)}</button>`; };
      const rowPill = (r: string, label: string, open: boolean) => `<button type="button" class="pill-add rowpill" data-row="${r}" aria-expanded="${open}">${esc(label)}</button>`;
      const sOpen = ro === "social" || ro === "social2";
      if (main.length || lesser.length || socialOn) {
        box.appendChild(el(`<div class="addinfo"><span class="hint">Add missing info:</span>${main.map((f) => pill(f, PILL[f])).join("")}${socialOn ? `<button type="button" class="pill-add c3" data-row="social" aria-expanded="${sOpen}">+ Social media ${sOpen ? "▾" : "▸"}</button>` : ""}${lesser.length ? rowPill("more", `+ ${lesser.length} more ${ro === "more" ? "▴" : "▾"}`, ro === "more") : ""}</div>`));
        if (sOpen) box.appendChild(el(`<div class="addinfo more${lastRow === "" ? " reveal" : ""}">${plat.map((x) => pill("social:" + x.id, x.label, true)).join("")}${rowPill("social2", ro === "social2" ? "Less ▴" : "More ▸", ro === "social2")}</div>`));
        if (ro === "social2") box.appendChild(el(`<div class="addinfo more deeper${lastRow !== "social2" ? " reveal" : ""}">${plat2.map((x) => pill("social:" + x.id, x.label, true)).join("")}</div>`));
        if (ro === "more") box.appendChild(el(`<div class="addinfo more${lastRow !== "more" ? " reveal" : ""}">${lesser.map((f) => pill(f, PILL[f], true)).join("")}</div>`));
        const op = po ? box.querySelector(`.pill-add[data-f="${CSS.escape(po)}"]`) : null;
        if (op) {
          const d = pillField(c, po!);
          if (!pfWasOpen) d.classList.add("reveal");
          op.closest(".addinfo")!.after(d); // right under the row its pill is in, so the arrow points at it
        }
      }
      if (pillCard === c.id) { lastRow = rowOpen; pfWasOpen = !!(pillOpen && box.querySelector(".pillfield")); }
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
      if (b && b.classList.contains("showall")) { expanded[c.id] = !expanded[c.id]; rerender(c); return; }
      if (!b || !editor) return;
      if (b.hasAttribute("data-row")) {
        const r = b.getAttribute("data-row") as typeof rowOpen;
        if (pillCard !== c.id) openPillsOn(c);
        rowOpen = r === "social2" ? (rowOpen === "social2" ? "social" : "social2") : rowOpen === r || (r === "social" && rowOpen === "social2") ? "" : r;
        // a field from a row that just closed closes with it
        if (pillOpen && ((pillOpen.startsWith("social:") && !rowOpen.startsWith("social")) || (rowOpen !== "more" && (LESSER_PILLS[k === "org" ? (coalition ? "coalition" : "org") : kindOfSec(sec!)] || []).includes(pillOpen!)) || (rowOpen === "social" && SOCIAL.some((x) => x.more && "social:" + x.id === pillOpen)))) pillOpen = null;
        rerender(c);
        (document.querySelector(`#card-${CSS.escape(c.id)} [data-row="${r}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
        return;
      }
      if (b.classList.contains("tagbtn")) {
        const m = box.querySelector(".typemenu") as HTMLElement, open = m.hidden;
        m.hidden = !open; b.setAttribute("aria-expanded", String(open));
        if (open) (m.querySelector("[aria-current]") as HTMLElement | null)?.focus({ preventScroll: true });
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
        (document.querySelector(`#card-${CSS.escape(c.id)} .tagbtn`) as HTMLElement | null)?.focus({ preventScroll: true });
        return;
      }
      if (b.classList.contains("ipp-start")) { ippMode[c.id] = "ask"; rerender(c); (document.querySelector(`#card-${CSS.escape(c.id)} .ipp-me`) as HTMLElement | null)?.focus({ preventScroll: true }); return; }
      if (b.classList.contains("ipp-cancel")) { ippMode[c.id] = ""; rerender(c); (document.querySelector(`#card-${CSS.escape(c.id)} .ipp-start`) as HTMLElement | null)?.focus({ preventScroll: true }); return; }
      if (b.classList.contains("ipp-other")) { ippMode[c.id] = "other"; rerender(c); (document.querySelector(`#ip-${CSS.escape(c.id)}-name`) as HTMLElement | null)?.focus({ preventScroll: true }); return; }
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
        const f = b.getAttribute("data-f")!;
        if (pillCard !== c.id) openPillsOn(c);
        pillOpen = pillOpen === f ? null : f;
        rerender(c);
        (document.querySelector(`#card-${CSS.escape(c.id)} .pillfield [data-pk]:not([type=hidden]), #card-${CSS.escape(c.id)} .pillfield .pin`) as HTMLElement | null)?.focus({ preventScroll: true });
        return;
      }
      if (b.classList.contains("pill-cancel")) { const f = pillOpen; pillOpen = null; if (f) delete pillDraft[f]; rerender(c); (document.querySelector(`#card-${CSS.escape(c.id)} .pill-add[data-f="${f}"]`) as HTMLElement | null)?.focus({ preventScroll: true }); return; }
      if (b.classList.contains("pill-save")) {
        const i = box.querySelector(".pillfield [data-pk]") as HTMLInputElement;
        const f = pillOpen || "";
        const q = box.querySelector(".pillfield .pin") as HTMLInputElement | null;
        if (q && q.value.trim() && f !== "type") { q.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); } // a typed topic not yet turned into a pill
        let v: string | boolean = i.type === "checkbox" ? i.checked : i.value.trim();
        if (v === "" ) { msg(f === "type" ? "Pick a type first, or press Cancel." : "Type something first, or press Cancel.", true); (q || i).focus(); return; }
        let key = f;
        if (f.startsWith("social:")) {
          const pf = SOCIAL.find((x) => "social:" + x.id === f)!;
          const url = pf.url(String(v));
          if (!url) { msg(pf.id === "other" ? "Please paste the full link (for example bsky.app/profile/yourgroup)." : `Please enter your ${pf.label} link or @handle.`, true); i.focus(); return; }
          key = "social_links";
          const cur = String(val(c, "social_links") || "").trim();
          v = cur ? cur + ", " + url : url;
        }
        s.fields = { ...(s.fields || {}), [key]: v };
        if (key === "type" && keys.includes("school_club")) s.fields.school_club = splitList(v).includes("school_club");
        s.decision = "approve";
        delete pillDraft[f]; pillOpen = null; touch(); rerender(c);
        msg("Added. It goes on the map when you press Finalize and Submit.");
        (document.querySelector(`#card-${CSS.escape(c.id)} .addinfo .pill-add`) as HTMLElement | null)?.focus({ preventScroll: true });
        return;
      }
      if (b.classList.contains("edit-btn")) { editing[c.id] = true; rerender(c); const i = document.querySelector(`#card-${CSS.escape(c.id)} [data-k]`) as HTMLElement | null; i?.focus({ preventScroll: true }); return; }
      if (b.classList.contains("done-btn")) {
        const fs: Obj = {};
        box.querySelectorAll<HTMLInputElement>("[data-k]").forEach((i) => {
          const key = i.getAttribute("data-k")!, v = i.type === "checkbox" ? i.checked : i.value.trim(), orig = c[key];
          const list = key === "type" || key === "topic_tags" || key === "focus_tags";
          const norm = (x: unknown) => splitList(Array.isArray(x) ? x.join(",") : x).map((t) => (key === "type" ? t : topicSlug(t))).filter((t) => t && t !== "unknown").join(",");
          const differs = i.type === "checkbox" ? v !== isOn(orig) : list ? norm(v) !== norm(orig) : String(v) !== String(orig || "").slice(0, i.type === "datetime-local" ? 16 : i.type === "date" ? 10 : 9999);
          if (differs) fs[key] = v;
        });
        if (fs.type !== undefined && keys.includes("school_club")) { const sc = splitList(fs.type).includes("school_club"); if (sc !== isOn(c.school_club)) fs.school_club = sc; }
        if (fresh && !String(fs.name || "").trim()) { msg(`Please give the new ${one} a name.`, true); (box.querySelector('[data-k="name"]') as HTMLElement | null)?.focus({ preventScroll: true }); return; }
        s.fields = fs; s.decision = "approve"; touch(); editing[c.id] = false; return rerender(c);
      }
      if (b.classList.contains("cancel-btn")) { if (fresh && !String((s.fields || {}).name || "").trim()) return drop(); editing[c.id] = false; return rerender(c); }
      if (b.classList.contains("ok")) {
        s.decision = s.decision === "approve" ? "" : "approve"; touch(); rerender(c);
        (document.querySelector(`#card-${CSS.escape(c.id)} .ok`) as HTMLElement | null)?.focus({ preventScroll: true }); return;
      }
      if (b.classList.contains("rm")) { if (fresh) return drop(); s.decision = s.decision === "remove" ? "" : "remove"; touch(); return rerender(c); }
    });
    // Once on the page: show "Show all" only when the description is cut off, and aim the drawer's arrow.
    requestAnimationFrame(() => {
      const d = box.querySelector(".desc.clamp") as HTMLElement | null, sa = box.querySelector(".showall") as HTMLElement | null;
      if (sa) sa.hidden = !(expanded[c.id] || (d && d.scrollHeight > d.clientHeight + 2));
      aimCaret(box);
    });
    return box;
  }
  /** Round 6 (Nov 19): a card that changes size eases to its new height instead of jumping. */
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  function glide(n: HTMLElement, h0: number) {
    const h1 = n.offsetHeight;
    if (calm.matches || Math.abs(h1 - h0) < 4 || !n.animate) return;
    // overflow: clip (not hidden) so focusing a field inside can't scroll the card's content while it eases
    n.style.overflow = "clip";
    n.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 220, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => { n.style.overflow = ""; n.scrollTop = 0; };
  }
  function rerender(c: Card) {
    const old = document.getElementById("card-" + c.id);
    if (!old) return;
    const n = card(c);
    const h0 = old.offsetHeight;
    old.replaceWith(n);
    glide(n, h0);
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
      const r = claimP ? await claimP : await call({ action: "claim", token, sid, name: myName() });
      claimP = undefined;
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
      selfPP: ppMode !== "else",
      others: ppMode === "me" ? [] : others.slice(0, 2).filter((o, i) => i < free && EMAIL_RE.test(o.email)).map((o) => ({ ...o, best: digits(o.phone) >= 7 ? o.best : "" })),
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
    if (ppMode === "else" && (!others[0].name || !EMAIL_RE.test(others[0].email))) {
      msg("Please enter the point person’s name and email (or choose Me).", true);
      inp(others[0].name ? "o0email" : "o0name").focus();
      return false;
    }
    return true;
  }
  async function saveNow(): Promise<boolean> {
    if (!editor || busy) return false;
    msg("Saving…");
    const sentRev = rev;
    try {
      const r = await call({ action: "save", token, sid, state: buildState() });
      if (!r.ok) { msg(String(r.error || "Something went wrong. Please try again."), true); return false; }
      savedRev = sentRev;
      if (r.savedAt) draftAt = r.savedAt;
      msg("Saved. Open this same link to pick up where you left off.");
      return true;
    } catch (e) { msg((e as Error).message, true); return false; }
  }
  $("save").addEventListener("click", () => void saveNow());
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
      try { localStorage.removeItem(keepKey(token)); } catch { /* ignore */ }
      itemPeople = {}; saveItemPeople();
      savedRev = rev;
      showBanner(null);
      $("app").innerHTML = `<div class="box done"><h1>Thank you!</h1><p>Your changes are on the map (${esc(r.summary)}). Check your email for a link to confirm your address as a point person.</p><p>You can open this link again any time to make more changes.</p></div>`;
      $("bar").remove();
    } catch (e) { btn.disabled = false; msg((e as Error).message, true); }
    finally { busy = false; }
  });

  // Newer information than the remembered copy (speed, Nov 20): reload quietly if nothing was touched yet, else ask.
  onNewer = () => {
    if (rev === 0 && !Object.values(editing).some(Boolean)) { location.reload(); return; }
    const b = $("banner");
    b.innerHTML = ""; b.className = "banner"; b.setAttribute("role", "status");
    const span = document.createElement("span");
    span.textContent = "This page has newer information. Save for later, then reload to see it.";
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    b.append(span, btn);
  };
  // Show the page right away (read-only) while the editing lock comes back.
  render();
  msg("Getting the page ready for editing…");
  void claim().then(() => { if (editor && $("status").textContent === "Getting the page ready for editing…") msg(""); });
}
