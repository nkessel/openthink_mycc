// Merge research/fill-1003/out*.json (researched profile details, current events / projects / actions and better
// event links, each with sources) into public/data.json (MA) and public/maps/vt.json (VT).
// Rules: profile fields only fill blanks (type also replaces "unknown"); last_activity takes the newest real date;
// new items are added only when they're not already there (same owner, similar name); past events and past-deadline
// actions are skipped; any text with an email address or phone number is dropped. Sources go to
// research/fill-1003/merged-sources.json (data.json carries no sources). Safe to re-run: it starts from git HEAD.
// Usage: node scripts/merge-fill-1003.mjs [--today=YYYY-MM-DD]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const TODAY = (process.argv.find((a) => a.startsWith("--today=")) || "").slice(8) || new Date().toISOString().slice(0, 10);
const DIR = "research/fill-1003";
const FILES = { ma: "public/data.json", vt: "public/maps/vt.json" };
const fromHead = (f) => JSON.parse(execSync(`git show HEAD:${f}`, { encoding: "utf8", maxBuffer: 64 << 20 }));
const data = { ma: fromHead(FILES.ma), vt: fromHead(FILES.vt) };
const TYPES = new Set(["501c3", "501c4", "coalition", "school_club", "campus_group", "faith_org", "mutual_aid", "government", "business", "union", "informal_group"]);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const clean = (s) => (typeof s === "string" && !EMAIL.test(s) && !PHONE.test(s) ? s.trim() : "");
const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s) => norm(s).split(" ").slice(0, 6).join("_").slice(0, 48);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(s || "") && !isNaN(Date.parse(s.slice(0, 10)));
const url = (s) => (/^https?:\/\/\S+$/.test(s || "") ? s : "");
/** Two names for the same thing: one contains the other, or most of their words match. */
function similar(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wa = new Set(x.split(" ").filter((w) => w.length > 2)), wb = new Set(y.split(" ").filter((w) => w.length > 2));
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.max(1, Math.min(wa.size, wb.size)) >= 0.75;
}
/** Same rule as the Apps Script: `general` is a site's events listing on the same site as `specific`. */
function isListingFor(general, specific) {
  const host = (u) => (/^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(u || "") || [])[1]?.toLowerCase() || "";
  if (!host(general) || host(general) !== host(specific) || general === specific) return false;
  const path = String(general).replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return path === "" || /^(events?|calendar|upcoming(-events)?|event-listings|whats-on|get-involved)$/i.test(path.split("/").pop());
}

const sources = {};
const counts = { fields: 0, last_activity: 0, events: 0, projects: 0, actions: 0, rsvp: 0, links: 0, skipped_past: 0, skipped_dup: 0, skipped_contact: 0, inactive: 0 };
const files = readdirSync(DIR).filter((f) => /^out.*\.json$/.test(f)).sort();
for (const f of files) {
  const out = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  for (const [id, g] of Object.entries(out.groups || {})) {
    const map = g.map === "vt" || id.startsWith("vt_") ? "vt" : "ma";
    const d = data[map];
    const node = d.organizations.find((o) => o.id === id) || d.coalitions.find((c) => c.id === id);
    if (!node) { console.warn("unknown id", id, "in", f); continue; }
    const isOrg = d.organizations.includes(node);
    const fs = g.fields || {};
    const fsrc = (g.field_sources || []).filter(url);
    let touched = false;
    if (fsrc.length) {
      for (const k of ["description", "website", "geographic_focus"]) {
        const v = k === "website" ? url(fs[k]) : clean(fs[k]);
        if (v && !node[k]) { node[k] = v; counts.fields++; touched = true; }
      }
      if (isOrg && fs.type && (!node.type || node.type === "unknown")) {
        const t = String(fs.type).split(",").map((s) => s.trim()).filter((s) => TYPES.has(s));
        if (t.length) { node.type = t.join(", "); counts.fields++; touched = true; }
      }
      if (isDate(fs.last_activity) && fs.last_activity.slice(0, 10) <= TODAY && (!node.last_activity || fs.last_activity.slice(0, 10) > node.last_activity.slice(0, 10))) {
        node.last_activity = fs.last_activity.slice(0, 10); counts.last_activity++; touched = true;
      }
      if (isOrg && fs.inactive === true && (!node.last_activity || node.last_activity < "2025-01-01")) {
        node.profile = { ...(node.profile || {}), inactive: true }; counts.inactive++; touched = true;
      }
      if (touched) sources[id] = [...new Set([...(sources[id] || []), ...fsrc])];
    }
    const used = new Set([...(node.events || []), ...(node.projects || []), ...(node.actions || [])].map((x) => x.id));
    const newId = (k, name) => { let base = `${id}_${k}_${slug(name)}`, i = 2, nid = base; while (used.has(nid)) nid = `${base}_${i++}`; used.add(nid); return nid; };
    const addItem = (kind, raw, build) => {
      const src = (raw.sources || []).filter(url);
      const name = clean(raw.name);
      if (!name || !src.length) return;
      if ((raw.description && !clean(raw.description)) || (raw.location && !clean(raw.location))) { counts.skipped_contact++; return; }
      const list = (node[kind] = node[kind] || []);
      if (list.some((x) => similar(x.name, name) && (kind !== "events" || !x.date || !raw.date || x.date.slice(0, 10) === String(raw.date).slice(0, 10) || raw.recurrence || x.recurrence))) { counts.skipped_dup++; return; }
      const item = build(name, src);
      if (!item) return;
      list.push(item);
      sources[item.id] = src;
      counts[kind]++;
    };
    for (const e of g.events || []) {
      addItem("events", e, (name) => {
        if (!isDate(e.date) || (String(e.date).slice(0, 10) < TODAY && !e.recurrence)) { counts.skipped_past++; return null; }
        const loc = clean(e.location) || (e.online ? "Online" : "");
        const ev = { id: newId("e", name), name, date: String(e.date), location: loc };
        if (isDate(e.end)) ev.end = e.end;
        if (clean(e.description)) ev.description = clean(e.description);
        if (clean(e.recurrence)) ev.recurrence = clean(e.recurrence);
        if (e.online || /^online|zoom|virtual/i.test(loc)) ev.online = true;
        if (url(e.link)) ev.link = e.link;
        if (url(e.rsvp_link)) ev.rsvp_link = e.rsvp_link;
        if (!isOrg && e.host_org_id) ev.host_org_id = e.host_org_id;
        return ev;
      });
    }
    for (const p of g.projects || []) {
      addItem("projects", p, (name) => {
        const pr = { id: newId("p", name), name, description: clean(p.description), status: p.status === "planning" ? "planning" : "active", skills_needed: [] };
        if (url(p.link)) pr.link = p.link;
        return pr;
      });
    }
    for (const a of g.actions || []) {
      addItem("actions", a, (name) => {
        const dl = isDate(a.deadline) ? a.deadline.slice(0, 10) : null;
        if (dl && dl < TODAY) { counts.skipped_past++; return null; }
        const ac = { id: newId("a", name), kind: a.kind === "role" ? "role" : "task", name, skills_needed: [], deadline: dl };
        if (clean(a.description)) ac.description = clean(a.description);
        if (url(a.link)) ac.link = a.link;
        return ac;
      });
    }
    for (const [eid, u] of Object.entries(g.event_updates || {})) {
      const ev = (node.events || []).find((e) => e.id === eid);
      const src = (u.sources || []).filter(url);
      if (!ev || !src.length) continue;
      if (url(u.rsvp_link) && !ev.rsvp_link) { ev.rsvp_link = u.rsvp_link; counts.rsvp++; sources[eid] = src; }
      if (url(u.link) && u.link !== ev.link && (!ev.link || isListingFor(ev.link, u.link) || u.link.startsWith(ev.link.replace(/\/+$/, "")))) {
        ev.link = u.link; counts.links++; sources[eid] = src;
      }
    }
    // the newest thing we now know about the group
    const newest = (node.events || []).map((e) => e.date?.slice(0, 10)).filter((x) => x && x <= TODAY).sort().pop();
    if (newest && (!node.last_activity || newest > node.last_activity)) node.last_activity = newest;
  }
}
writeFileSync(FILES.ma, JSON.stringify(data.ma, null, 2) + "\n");
writeFileSync(FILES.vt, JSON.stringify(data.vt) + "\n");
writeFileSync(`${DIR}/merged-sources.json`, JSON.stringify(sources, null, 1) + "\n");
console.log(files.join(" "), "\n", counts);
