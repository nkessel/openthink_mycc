// Tests apps-script/Code.gs in Node with a small fake of the Sheets/Forms/Mail services:
//  1. data.json -> sheet rows -> data.json round-trips exactly
//  2. signed-in point-people can edit only their own orgs/events/projects; everything else
//     goes to Needs Review, is flagged in Change Log, and alerts the admins
//  3. approving a queued submission applies it (and makes a new org's submitter its editor)
//  4. org-to-org connections, event/project locations, org-owned vs coalition-owned items
// Run: npm run test:apps-script
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const J = (x) => JSON.parse(JSON.stringify(x));

// ---- fake spreadsheet: tab name -> 2D array
const book = {};
function sheet(name) {
  if (!book[name]) return null;
  const d = book[name];
  const width = () => d[0].length;
  return {
    getName: () => name,
    getDataRange: () => ({ getValues: () => d.map((r) => r.slice()) }),
    getLastRow: () => d.length,
    getLastColumn: () => width(),
    deleteRow: (r) => d.splice(r - 1, 1),
    getRange: (r, c, nr = 1, nc = 1) => {
     const rng = {
      getValues: () => d.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
      getValue: () => (d[r - 1] || [])[c - 1],
      setValues: (v) =>
        v.forEach((row, i) => {
          while (d.length < r + i) d.push(Array(width()).fill(""));
          row.forEach((x, j) => (d[r - 1 + i][c - 1 + j] = x));
        }),
      setValue: (v) => {
        while (d.length < r) d.push(Array(width()).fill(""));
        d[r - 1][c - 1] = v;
        return rng;
      },
      setNumberFormats: () => {}, setNumberFormat: () => {}, setBackground: () => rng, setFontWeight: () => rng, setFontColor: () => rng,
      insertCheckboxes: () => {},
      getColumn: () => c, getRow: () => r, getNumColumns: () => nc,
      getSheet: () => sheet(name),
     };
     return rng;
    },
  };
}
const ssObj = { getSheetByName: sheet, getUrl: () => "https://sheet", toast: () => {} };
const props = { ADMIN_EMAILS: "admin1@example.org, admin2@example.org, admin3@example.org" };
const mail = [];
const cache = {};
const cacheTtl = {};
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const ctx = {
  console, Math, Date, JSON, String, Number, Array, Object, RegExp, isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: () => ssObj, openById: () => ssObj, getActive: () => ssObj },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => (props[k] = v), deleteProperty: (k) => delete props[k] }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v, ttl) => ((cache[k] = v), (cacheTtl[k] = ttl)), remove: (k) => delete cache[k] }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ getContent: () => s, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutput: (h) => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => "America/New_York", getActiveUser: () => ({ getEmail: () => "" }) },
  MailApp: { sendEmail: (to, subject, body, opts) => mail.push({ to, subject, body, opts }) },
  // Apps Script's Utilities, backed by Node's crypto (bytes come back signed, as in Apps Script)
  Utilities: {
    sleep: () => {},
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => signed(crypto.createHmac("sha256", k).update(v, "utf8").digest()),
    base64EncodeWebSafe: (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    base64DecodeWebSafe: (x) => signed(Buffer.from(x.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
  },
  Maps: { newGeocoder: () => ({ setRegion() { return this; }, geocode: (q) => ({ status: "OK", results: [{ geometry: { location: /Natick/.test(q) ? { lat: 42.2834, lng: -71.3495 } : { lat: 42.36, lng: -71.06 } } }] }) }) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script/Code.gs"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script/Confirm.gs"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script/SignIn.gs"), "utf8"), ctx);
const G = (name) => vm.runInContext(name, ctx);
const Q = G("Q"), COLS = G("COLS");
// A fixed copy of the map's data (the Oct 1 snapshot): public/data.json is refreshed from the live sheet, and the
// checks below expect this exact starting point (Nov 14).
const orig = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/data.json"), "utf8"));
// A coalition event for the edit tests below (the real MYCC call left the map in the Oct 18 event check: no page).
const myccCo = orig.coalitions.find((c) => c.id === "mycc");
if (!myccCo.events.some((e) => e.id === "mycc_e_call_1004")) myccCo.events.push({ id: "mycc_e_call_1004", name: "MYCC full-coalition call",
  date: "2026-10-04T20:00:00", end: "2026-10-04T21:00:00", location: "Zoom", online: true, link: "https://example.org/mycc-call" });

// ---- seed the fake workbook the same way setUp() does
const seeded = ctx.sheetRowsFromData_(orig);
for (const k of Object.keys(COLS)) book[k] = [COLS[k].slice()].concat(J(seeded[k] || []));
book["Editors"].push(
  ["admin1@example.org", "admin", "", "", "", ""],
  ["point@bls.org", "editor", "boston_latin_school_youthcan", "", "", ""],
  ["lead@mycc.org", "editor", "", "mycc", "", ""],
);

// 1) round trip
const norm = (d) => ({
  c: d.coalitions.map((c) => ({ ...c, lat: 0, lng: 0, member_ids: [...c.member_ids].sort() })),
  o: d.organizations.map((o) => ({ ...o, lat: 0, lng: 0 })),
  e: d.edges.map((e) => e.source + ">" + e.target).sort(),
  l: d.org_links || [],
});
const out = ctx.buildDataFile_(ctx.readAll_(), "now");
assert.deepStrictEqual(J(norm(out)), J(norm(orig)));
out.organizations.forEach((o, i) => assert.ok(Math.abs(o.lat - orig.organizations[i].lat) < 1e-4));
console.log("round trip OK");

// 2) submissions
Object.assign(props, { FORM_ORG: "fo", FORM_EVENT: "fe", FORM_PROJECT: "fp", FORM_ACTION: "fa", FORM_FEEDBACK: "ff" });
ctx.refreshDropdowns = () => {};
const submit = (fid, email, ans) =>
  ctx.handleSubmit({
    source: { getId: () => fid },
    response: {
      getRespondentEmail: () => email,
      getItemResponses: () => Object.entries(ans).map(([k, v]) => ({ getItem: () => ({ getTitle: () => k }), getResponse: () => v })),
    },
  });
const NEW_ORG = G("NEW_ORG"), NEW_EVENT = G("NEW_EVENT"), NEW_PROJECT = G("NEW_PROJECT"), NEW_ACTION = G("NEW_ACTION");
// Dropdowns show plain names now; old "[id]" labels (still used below) keep working.
const BLS = "Boston Latin School Youth Climate Action Network";
const MYCC = "Massachusetts Youth Climate Coalition (MYCC)";
{
  const idx = ctx.buildLabelIndex_(ctx.readAll_());
  assert.equal(idx.byLabel.org[BLS], "boston_latin_school_youthcan");
  assert.equal(idx.byLabel.coalition[MYCC], "mycc");
  // same-name orgs get their id appended so each choice is still unique
  const same = Object.keys(idx.byLabel.org).filter((l) => l.startsWith("Citizens Climate Lobby ["));
  const dupes = ctx.readAll_().orgs.filter((o) => o.name === "Citizens Climate Lobby").length;
  assert.equal(same.length, dupes > 1 ? dupes : 0);
}
const log = () => book["Change Log"].slice(1).map((r) => Object.fromEntries(COLS["Change Log"].map((c, i) => [c, r[i]])));
const review = () => book["Needs Review"].slice(1).map((r) => Object.fromEntries(COLS["Needs Review"].map((c, i) => [c, r[i]])));
const data = () => ctx.buildDataFile_(ctx.readAll_(), "now");

// point-person edits their own org (+ connections)
submit("fo", "Point@BLS.org", {
  [Q.whichOrg]: BLS, [Q.orgDesc]: "New description", [Q.tags]: ["Clean energy", "Tree planting", "Youth serving"],
  [Q.logo]: "https://drive.google.com/file/d/abc123/view?usp=sharing",
  [Q.worksWith("Weekly")]: ["Belmont High School Climate Action Club [belmont_high_school_climate_club]"],
  [Q.worksWith("Yearly or less")]: ["Belmont High School Climate Action Club [belmont_high_school_climate_club]", "Andover Climate Lobby [andover_climate_lobby]"],
});
let d = data();
let org = d.organizations.find((o) => o.id === "boston_latin_school_youthcan");
assert.equal(org.description, "New description");
assert.deepEqual(J(org.topic_tags), ["clean_energy", "tree_planting", "youth_serving"]);
assert.equal(org.profile.youth_serving, true);
assert.equal(org.logo, "https://drive.google.com/thumbnail?id=abc123&sz=w400");
const link = d.org_links.find((l) => [l.source, l.target].includes("belmont_high_school_climate_club") && [l.source, l.target].includes("boston_latin_school_youthcan"));
assert.equal(link.frequency, "weekly"); assert.equal(link.weight, 4);
assert.equal(d.org_links.length, 2);
assert.equal(log().at(-1).status, "updated");
assert.equal(log().at(-1).email, "point@bls.org");

// the other org answers monthly → the pair keeps the stronger (weekly) and lists both reporters
submit("fo", "admin1@example.org", {
  [Q.whichOrg]: "Belmont High School Climate Action Club [belmont_high_school_climate_club]",
  [Q.worksWith("Monthly")]: [BLS],
});
d = data();
const pair = d.org_links.find((l) => l.source === "belmont_high_school_climate_club" || l.target === "belmont_high_school_climate_club");
assert.equal(pair.frequency, "weekly"); assert.equal(pair.reported_by.length, 2);

// re-answering replaces that org's list
submit("fo", "point@bls.org", { [Q.whichOrg]: BLS, [Q.worksWith("Monthly")]: ["Andover Climate Lobby [andover_climate_lobby]"] });
d = data();
assert.equal(book["Connections"].filter((r) => r[0] === "boston_latin_school_youthcan").length, 1);
assert.ok(d.org_links.find((l) => l.reported_by.includes("belmont_high_school_climate_club")), "Belmont's own answer stays");

// point-person tries to edit an org they don't manage → queued, flagged, admins emailed, nothing changed
const beforeName = d.organizations.find((o) => o.id === "andover_climate_lobby").name;
submit("fo", "point@bls.org", { [Q.whichOrg]: "Andover Climate Lobby [andover_climate_lobby]", [Q.orgName]: "Hacked" });
assert.equal(data().organizations.find((o) => o.id === "andover_climate_lobby").name, beforeName);
assert.match(review().at(-1).reason, /^UNAUTHORIZED/);
assert.match(log().at(-1).flag, /^UNAUTHORIZED/);
assert.equal(log().at(-1).status, "needs review");
const adminMail = mail.filter((m) => /admin2@example\.org/.test(m.to));
assert.equal(adminMail.length, 1, "one alert to the admins");
// submitters hear back: "on the map" for the applied edits, "waiting for the map team" for the held one
const toBls = mail.filter((m) => m.to === "point@bls.org");
assert.match(toBls.at(-1).body, /waiting for the map team/);
assert.ok(toBls.some((m) => /is on the map/.test(m.subject)), "applied edit confirmed");

// stranger / no email
submit("fe", "", { [Q.whichEvent]: NEW_EVENT, [Q.eventName]: "Anon event", [Q.hostOrg]: BLS });
assert.match(review().at(-1).reason, /^NO EMAIL/);
assert.ok(!JSON.stringify(data()).includes("Anon event"));

// new org by a stranger → review → admin approves → applied + submitter becomes its editor
submit("fo", "new@natick.org", { [Q.whichOrg]: NEW_ORG, [Q.orgName]: "Natick Climate Circle", [Q.orgHq]: "Natick Common, Natick", [Q.orgCoalitions]: [MYCC] });
assert.match(review().at(-1).reason, /^NEW ORG/);
const approveCol = COLS["Needs Review"].indexOf("approve") + 1;
const reviewRow = book["Needs Review"].length;
book["Needs Review"][reviewRow - 1][approveCol - 1] = true;
ctx.onReviewEdit({ range: sheet("Needs Review").getRange(reviewRow, approveCol), user: { getEmail: () => "admin2@example.org" } });
d = data();
const natick = d.organizations.find((o) => o.id === "natick_climate_circle");
assert.ok(natick && Math.abs(natick.lat - 42.2834) < 1e-6, "geocoded HQ");
assert.equal(natick.profile.geo_precision, "exact");
assert.ok(book["Editors"].some((r) => r[0] === "new@natick.org" && r[2] === "natick_climate_circle"));
assert.equal(review().at(-1).status, "approved");
assert.match(log().at(-1).flag, /approved by admin2@example.org/);

// non-admin can't approve
submit("fo", "x@y.org", { [Q.whichOrg]: NEW_ORG, [Q.orgName]: "Sneaky Org" });
const r2 = book["Needs Review"].length;
book["Needs Review"][r2 - 1][approveCol - 1] = true;
ctx.onReviewEdit({ range: sheet("Needs Review").getRange(r2, approveCol), user: { getEmail: () => "point@bls.org" } });
assert.ok(!data().organizations.find((o) => o.name === "Sneaky Org"));

// a new org with no verified email: held, and an admin can't approve it either
submit("fo", "", { [Q.whichOrg]: NEW_ORG, [Q.orgName]: "Unverified Org" });
assert.match(review().at(-1).reason, /^NO EMAIL — a new organization needs a verified email/);
{
  const r3 = book["Needs Review"].length;
  book["Needs Review"][r3 - 1][approveCol - 1] = true;
  ctx.onReviewEdit({ range: sheet("Needs Review").getRange(r3, approveCol), user: { getEmail: () => "admin2@example.org" } });
  assert.ok(!data().organizations.find((o) => o.name === "Unverified Org"), "not added without a verified email");
  assert.equal(book["Needs Review"][r3 - 1][approveCol - 1], false, "approve box unticked");
}

// the approved submitter can now add an org-owned, in-person event with a location
submit("fe", "new@natick.org", {
  [Q.whichEvent]: NEW_EVENT, [Q.hostOrg]: "Natick Climate Circle [natick_climate_circle]", [Q.eventName]: "Song Circle for the Planet",
  [Q.eventDate]: "2026-10-18", [Q.eventTime]: "15:00", [Q.eventEndTime]: "17:30", [Q.location]: "Natick Common", [Q.online]: "No",
});
d = data();
const ev = d.organizations.find((o) => o.id === "natick_climate_circle").events[0];
assert.equal(ev.date, "2026-10-18T15:00:00"); assert.equal(ev.end, "2026-10-18T17:30:00"); assert.ok(Math.abs(ev.lat - 42.2834) < 1e-6); assert.ok(!ev.online);
assert.ok(!d.coalitions.find((c) => c.id === "mycc").events.find((e) => e.name === ev.name), "org-owned, not coalition");

// …but can't put an event under a coalition they don't manage without their org
submit("fe", "new@natick.org", { [Q.whichEvent]: NEW_EVENT, [Q.coalition]: MYCC, [Q.eventName]: "Not mine" });
assert.match(review().at(-1).reason, /^UNAUTHORIZED/);

// coalition lead edits a coalition event (time only) and adds an online project
submit("fe", "lead@mycc.org", { [Q.whichEvent]: "MYCC full-coalition call — Oct 4, 2026 [mycc_e_call_1004]", [Q.eventTime]: "19:30" });
submit("fp", "lead@mycc.org", { [Q.whichProject]: NEW_PROJECT, [Q.coalition]: MYCC, [Q.projectName]: "Virtual Teach-in", [Q.location]: "Zoom", [Q.online]: "Yes",
  [Q.freeFood]: "No", [Q.who]: "Affiliated members only", [Q.helpWanted]: "No" });
submit("fe", "lead@mycc.org", { [Q.whichEvent]: "MYCC full-coalition call — Oct 4, 2026 [mycc_e_call_1004]", [Q.freeFood]: "Yes", [Q.who]: "Open to the public" });
d = data();
const mycc = d.coalitions.find((c) => c.id === "mycc");
assert.equal(mycc.events.find((e) => e.id === "mycc_e_call_1004").date, "2026-10-04T19:30:00");
const vp = mycc.projects.find((p) => p.name === "Virtual Teach-in");
assert.ok(vp.online && vp.lat === undefined, "online project has no pin");
assert.equal(vp.affiliated_only, true, "affiliated-only project flag");
assert.equal(vp.help_wanted, false, "explicit 'no help wanted' is kept");
assert.equal(vp.free_food, undefined, "free food 'No' is just absent");
assert.equal(mycc.events.find((e) => e.id === "mycc_e_call_1004").free_food, true, "free food event flag");
assert.equal(mycc.events.find((e) => e.id === "mycc_e_call_1004").affiliated_only, undefined, "public event has no affiliated flag");

// recurring event + actions form: an org editor adds an action, a non-owner is queued, and an admin removes one
submit("fe", "lead@mycc.org", { [Q.whichEvent]: NEW_EVENT, [Q.coalition]: MYCC, [Q.eventName]: "Weekly vigil", [Q.eventDate]: "2026-10-03", [Q.eventTime]: "12:00", [Q.eventRecurrence]: "Every Saturday, 12-1 PM" });
assert.equal(data().coalitions.find((c) => c.id === "mycc").events.find((e) => e.name === "Weekly vigil").recurrence, "Every Saturday, 12-1 PM");
submit("fa", "lead@mycc.org", { [Q.whichAction]: NEW_ACTION, [Q.coalition]: MYCC, [Q.actionName]: "Testify on the Climate Ed bill", [Q.actionKind]: "Take action (sign, call, comment, show up)", [Q.actionDeadline]: "2026-11-01", [Q.link]: "https://example.org/testify" });
{
  const act = data().coalitions.find((c) => c.id === "mycc").actions.find((x) => x.name === "Testify on the Climate Ed bill");
  assert.ok(act && act.kind === "task" && act.deadline === "2026-11-01" && act.link === "https://example.org/testify" && act.urgency === undefined);
}
submit("fa", "point@bls.org", { [Q.whichAction]: NEW_ACTION, [Q.hostOrg]: BLS, [Q.actionName]: "Volunteer at the Trash Dash", [Q.actionKind]: "Volunteer role or opportunity" });
{
  const act = data().organizations.find((o) => o.id === "boston_latin_school_youthcan").actions.find((x) => x.name === "Volunteer at the Trash Dash");
  assert.ok(act && act.kind === "role" && act.host_org_id === "boston_latin_school_youthcan");
}
submit("fa", "point@bls.org", { [Q.whichAction]: NEW_ACTION, [Q.coalition]: MYCC, [Q.actionName]: "Not mine" });
assert.match(review().at(-1).reason, /^UNAUTHORIZED/);

// admin removes a project
submit("fp", "admin3@example.org", { [Q.whichProject]: "Annual Advocacy Day preparation [mycc_p_advocacy_day]", [Q.remove]: [G("REMOVE_YES")] });
assert.ok(!data().coalitions.find((c) => c.id === "mycc").projects.find((p) => p.id === "mycc_p_advocacy_day"));

// feedback: signed-in email + optional phone saved on the (private) Feedback tab, logged
submit("ff", "Fan@Example.org", { [Q.fbType]: "Idea or feature request", [Q.fbMessage]: "Add a calendar export", [Q.fbPhone]: "508-555-0199" });
assert.equal(book["Feedback"].length, 2);
{
  const fb = Object.fromEntries(book["Feedback"][0].map((h, i) => [h, book["Feedback"][1][i]]));
  assert.equal(fb.email, "fan@example.org"); assert.equal(fb.phone, "508-555-0199");
}
assert.equal(log().at(-1).record_type, "feedback");

// every submission is in the Change Log
const submissions = 21; // incl. the new org held for having no verified email
assert.equal(log().length, submissions, `expected one Change Log row per submission (+ approval), got ${log().length}`);
// the grid version of "who you work with": one row per org, strongest ticked column wins, blank rows = no contact
submit("fo", "point@bls.org", {
  [Q.whichOrg]: BLS,
  [Q.worksWithGrid]: { "Andover Climate Lobby": ["Monthly", "Yearly or less"], "Belmont High School Climate Action Club": ["A few times a year"] },
});
{
  const mine = book["Connections"].filter((r) => r[0] === "boston_latin_school_youthcan").map((r) => r[1] + ":" + r[2]).sort();
  assert.deepEqual(mine, ["andover_climate_lobby:monthly", "belmont_high_school_climate_club:few_per_year"]);
}
// a blank grid keeps the current answers
submit("fo", "point@bls.org", { [Q.whichOrg]: BLS, [Q.orgDesc]: "Only the description changed" });
assert.equal(book["Connections"].filter((r) => r[0] === "boston_latin_school_youthcan").length, 2);

// typing "remote" in the HQ question means no public location
submit("fo", "point@bls.org", { [Q.whichOrg]: BLS, [Q.orgHq]: "Remote" });
{
  const row = ctx.readAll_().orgs.find((o) => o.id === "boston_latin_school_youthcan");
  assert.equal(String(row.remote), "TRUE");
  assert.notEqual(String(row.hq_address), "Remote");
}

// point person: saved privately on the Editors tab, and can then edit that org
submit("fo", "point@bls.org", { [Q.whichOrg]: BLS, [Q.pointName]: "Rae Lin", [Q.pointEmail]: "Rae@BLS.org", [Q.pointPhone]: "617-555-0100" });
{
  const ed = ctx.readAll_().editors.find((r) => r.email === "rae@bls.org");
  assert.ok(ed && String(ed.org_ids).includes("boston_latin_school_youthcan"));
  assert.equal(ed.name, "Rae Lin"); assert.match(String(ed.notes), /phone: 617-555-0100/);
  assert.ok(!JSON.stringify(data()).includes("617-555-0100"), "point-person phone never published");
  // a typed email someone else entered must be confirmed first: pending, allowed nothing, sent a link
  assert.equal(ed.role, "pending");
  const link = mail.filter((m) => m.to === "rae@bls.org" && /confirm your email/.test(m.subject)).pop();
  assert.ok(link, "verification email sent");
  const token = /\?verify=([0-9a-f]+)/.exec(link.body)[1];
  submit("fo", "rae@bls.org", { [Q.whichOrg]: BLS, [Q.orgDesc]: "Edited by the new point person" });
  assert.notEqual(data().organizations.find((o) => o.id === "boston_latin_school_youthcan").description, "Edited by the new point person", "pending editor held");
  assert.match(G("confirmVerification_")(token), /confirmed/);
  assert.equal(ctx.readAll_().editors.find((r) => r.email === "rae@bls.org").role, "editor");
  assert.equal(data().organizations.find((o) => o.id === "boston_latin_school_youthcan").description, "Edited by the new point person", "held edit applied once confirmed");
  assert.match(G("confirmVerification_")(token), /expired|already used/, "one-time link");
  // the submitter's own signed-in email is already verified by Google
  submit("fo", "point@bls.org", { [Q.whichOrg]: BLS, [Q.pointEmail]: "point@bls.org" });
  assert.equal(ctx.readAll_().editors.find((r) => r.email === "point@bls.org").role, "editor");
}

// after an org renames itself, the new plain name picks the same row
submit("fo", "admin1@example.org", { [Q.whichOrg]: "Andover Climate Lobby", [Q.orgName]: "Andover Climate Lobby Group" });
submit("fo", "admin1@example.org", { [Q.whichOrg]: "Andover Climate Lobby Group", [Q.orgDesc]: "Renamed and still found" });
assert.equal(data().organizations.find((o) => o.id === "andover_climate_lobby").description, "Renamed and still found");

console.log("access control, review queue, change log OK");

// 3) round trip again with org-owned items, locations, and org links
const again = ctx.buildDataFile_(
  (() => {
    const rows = ctx.sheetRowsFromData_(J(d));
    const obj = (k) => rows[k].map((r) => Object.fromEntries(COLS[k].map((c, i) => [c, r[i]])));
    return { coalitions: obj("Coalitions"), orgs: obj("Organizations"), connections: obj("Connections"), projects: obj("Projects"), events: obj("Events"), actions: obj("Actions") };
  })(),
  "now",
);
assert.deepStrictEqual(J(norm(again)), J(norm(d)));
console.log("second round trip (org-owned items, locations, links) OK");

// 4) filling missing logos/websites from the repo never overwrites
{
  const orgRows = () => book["Organizations"].slice(1).map((r) => Object.fromEntries(COLS["Organizations"].map((c, i) => [c, r[i]])));
  const target = orgRows().find((o) => !o.logo);
  const withLogo = orgRows().find((o) => o.logo);
  const src = J(orig);
  src.organizations.find((o) => o.id === target.id).logo = "logos/new.png";
  src.organizations.find((o) => o.id === target.id).website = "https://example.org/";
  src.organizations.find((o) => o.id === withLogo.id).logo = "logos/should-not-replace.png";
  const before = log().length;
  const res = ctx.fillLogos_(src);
  const after = orgRows();
  assert.equal(after.find((o) => o.id === target.id).logo, "logos/new.png");
  assert.equal(after.find((o) => o.id === withLogo.id).logo, withLogo.logo);
  assert.ok(res.logos >= 1 && log().length > before);
  // researched descriptions/types/focus fill only empty cells ("unknown" type counts as empty)
  const blank = orgRows().find((o) => !o.description);
  const typed = orgRows().find((o) => o.type && o.type !== "unknown");
  const s2 = J(orig);
  Object.assign(s2.organizations.find((o) => o.id === blank.id), { description: "Researched description.", geographic_focus: "Newton" });
  if (typed) s2.organizations.find((o) => o.id === typed.id).type = "should_not_replace";
  const res2 = ctx.fillLogos_(s2);
  assert.equal(orgRows().find((o) => o.id === blank.id).description, "Researched description.");
  assert.equal(orgRows().find((o) => o.id === blank.id).geographic_focus, "Newton");
  if (typed) assert.equal(orgRows().find((o) => o.id === typed.id).type, typed.type);
  assert.ok(res2.details >= 2);
  // events: blank RSVP filled, general events-page link replaced by the event's own page, other links kept
  const evRows = () => book["Events"].slice(1).map((r) => Object.fromEntries(COLS["Events"].map((c, i) => [c, r[i]])));
  const [e1, e2, e3] = evRows();
  const ec = COLS["Events"];
  const setCell = (id, col, v) => { const row = book["Events"].find((r) => r[0] === id); row[ec.indexOf(col)] = v; };
  setCell(e1.id, "rsvp_link", ""); setCell(e1.id, "link", "https://example.org/events");
  setCell(e2.id, "link", "https://other.org/keep-me");
  setCell(e3.id, "link", "https://www.greenenergy.example/events/"); // a listing; the specific page is /event/<slug>
  const s3 = J(orig);
  const evs = [...s3.coalitions, ...s3.organizations].flatMap((n) => n.events || []);
  Object.assign(evs.find((e) => e.id === e1.id), { rsvp_link: "https://zoom.us/webinar/register/X", link: "https://example.org/events/my-event" });
  Object.assign(evs.find((e) => e.id === e2.id), { link: "https://example.org/somewhere-else" });
  Object.assign(evs.find((e) => e.id === e3.id), { link: "https://greenenergy.example/event/shave-the-peak" });
  const res3 = ctx.fillLogos_(s3);
  const after3 = evRows();
  assert.equal(after3.find((e) => e.id === e1.id).rsvp_link, "https://zoom.us/webinar/register/X");
  assert.equal(after3.find((e) => e.id === e1.id).link, "https://example.org/events/my-event");
  assert.equal(after3.find((e) => e.id === e2.id).link, "https://other.org/keep-me");
  assert.equal(after3.find((e) => e.id === e3.id).link, "https://greenenergy.example/event/shave-the-peak");
  assert.equal(ctx.isListingFor_("https://example.org/news", "https://example.org/event/x"), false);
  assert.ok(res3.rsvp >= 1);
  console.log("fill logos from GitHub OK");
}

// 5) typed answers: organizations and topics are matched against the lists; misses are kept for review
{
  const unmatched = () => book["Unmatched Input"].slice(1).map((r) => Object.fromEntries(COLS["Unmatched Input"].map((c, i) => [c, r[i]])));
  const orgs = ctx.readAll_().orgs;
  const bls = orgs.find((o) => o.id === "boston_latin_school_youthcan");
  // matching engine: typos, case, filler words, short names
  const cands = ctx.buildLabelIndex_(ctx.readAll_()).cands.org;
  assert.equal(ctx.matchTyped_("boston latin school youth climate action netwrk", cands).id, bls.id);
  assert.equal(ctx.matchTyped_("THE Boston Latin School Youth Climate Action Network", cands).id, bls.id);
  assert.equal(ctx.matchTyped_("zzzz not a real group", cands).id, "");

  // org form: typed org name (with a typo) + typed topics (some known, some not) + typed works-with lines
  const other = orgs.find((o) => o.id === "belmont_high_school_climate_club");
  const before = unmatched().length;
  submit("fo", "admin1@example.org", {
    [Q.whichOrg]: "boston latin school youth climate action netwrk",
    [Q.orgType]: ["Nonprofit — 501(c)(3)", "Faith community", "Nonprofit — 501(c)(3)", "Mutual aid"],
    [Q.moreTopics]: "clean energy, Tree planting, quantum basket weaving",
    [Q.worksWithText]: `${other.name} — monthly\nTotally Made Up Collective, yearly`,
  });
  d = data();
  org = d.organizations.find((o) => o.id === bls.id);
  assert.equal(org.type, "501c3, faith_org, mutual_aid", "several org types are kept, comma-separated, without repeats");
  assert.ok(org.topic_tags.includes("clean_energy") && org.topic_tags.includes("tree_planting"), "typed topics matched");
  assert.ok(!org.topic_tags.includes("quantum_basket_weaving"), "unmatched topic is not added");
  const logged = unmatched().slice(before);
  assert.ok(logged.some((r) => r.what === "topic" && r.typed === "quantum basket weaving"), "unmatched topic logged");
  assert.ok(logged.some((r) => r.what === "organization" && /Made Up/.test(r.typed)), "unmatched org line logged");
  const lk = d.org_links.find((l) => [l.source, l.target].includes(other.id) && [l.source, l.target].includes(bls.id));
  assert.equal(lk.frequency, "monthly");

  // event form: a typed host org that matches nothing waits for review (and is kept on the Unmatched tab)
  const n = review().length;
  submit("fe", "admin1@example.org", { [Q.whichEvent]: NEW_EVENT, [Q.hostOrg]: "Imaginary Climate Club", [Q.eventName]: "Ghost event" });
  assert.equal(review().length, n + 1);
  assert.match(review().at(-1).reason, /^UNMATCHED ORG/);
  assert.ok(!JSON.stringify(data()).includes("Ghost event"));
  assert.ok(unmatched().some((r) => r.typed === "Imaginary Climate Club"));

  // a typed host org that does match is applied, and old picked labels still work
  submit("fe", "point@bls.org", { [Q.whichEvent]: NEW_EVENT, [Q.hostOrg]: "boston latin school youth climate action network", [Q.eventName]: "Typed host event" });
  assert.ok(data().organizations.find((o) => o.id === bls.id).events.some((e) => e.name === "Typed host event"));

  // an admin can't approve it until the host org is fixed in the payload
  const idx = book["Needs Review"].findIndex((r, i) => i > 0 && /Ghost event/.test(String(r[COLS["Needs Review"].indexOf("summary")])));
  book["Needs Review"][idx][approveCol - 1] = true;
  ctx.onReviewEdit({ range: sheet("Needs Review").getRange(idx + 1, approveCol), user: { getEmail: () => "admin2@example.org" } });
  assert.ok(!JSON.stringify(data()).includes("Ghost event"), "not applied while the org still matches nothing");
  const pc = COLS["Needs Review"].indexOf("payload");
  const payload = JSON.parse(book["Needs Review"][idx][pc]);
  payload.answers[Q.hostOrg] = "Boston Latin School YouthCAN";
  payload.answers[Q.hostOrg] = bls.name;
  book["Needs Review"][idx][pc] = JSON.stringify(payload);
  book["Needs Review"][idx][approveCol - 1] = true;
  ctx.onReviewEdit({ range: sheet("Needs Review").getRange(idx + 1, approveCol), user: { getEmail: () => "admin2@example.org" } });
  assert.ok(JSON.stringify(data()).includes("Ghost event"), "approved once the org is fixed");
  console.log("typed answers (orgs + topics + unmatched log) OK");
}

// 6) coalitions typed where an organization is asked: a coalition can host items and be edited on the org form;
//    and a held submission is applied once its sender is added on the Editors tab
{
  const coal = ctx.readAll_().coalitions[0];
  // host = a coalition (typed by its short name)
  submit("fp", "admin1@example.org", { [Q.whichProject]: NEW_PROJECT, [Q.hostOrg]: coal.abbrev || coal.name, [Q.projectName]: "Coalition-hosted project" });
  let dd = data();
  assert.ok(dd.coalitions.find((c) => c.id === coal.id).projects.some((p) => p.name === "Coalition-hosted project"), "typed coalition becomes the project's owner");
  // org form used for a coalition: an admin's edit lands on the coalition's own row
  submit("fo", "admin1@example.org", { [Q.whichOrg]: coal.abbrev || coal.name, [Q.orgDesc]: "Updated through the org form" });
  dd = data();
  assert.equal(dd.coalitions.find((c) => c.id === coal.id).description, "Updated through the org form", "coalition edited");
  // an unknown sender's project waits; adding them as an editor of that coalition applies it
  const n0 = review().length;
  submit("fp", "newcomer@example.org", { [Q.whichProject]: NEW_PROJECT, [Q.hostOrg]: coal.abbrev || coal.name, [Q.projectName]: "Held until editor added" });
  assert.equal(review().length, n0 + 1);
  assert.equal(review().at(-1).status, "waiting");
  ctx.appendObject_(sheet("Editors"), { email: "newcomer@example.org", role: "editor", coalition_ids: coal.id });
  ctx.onReviewEdit({ range: sheet("Editors").getRange(2, 1), user: { getEmail: () => "admin2@example.org" } });
  assert.ok(JSON.stringify(data()).includes("Held until editor added"), "applied once the editor is listed");
  assert.match(review().at(-1).status, /^applied/);
  console.log("coalitions as owners + held submissions re-checked OK");
}

// 7. site form config: entry ids come out for typed (TEXT) questions too, and a flaky openById is retried
{
  const T = { LIST: "LIST", TEXT: "TEXT", CHECKBOX: "CHECKBOX", PARAGRAPH_TEXT: "PARAGRAPH_TEXT", MULTIPLE_CHOICE: "MULTIPLE_CHOICE" };
  let n = 100;
  const mkItem = (title, type) => {
    const id = n++;
    const resp = () => ({ id });
    const choice = { getValue: () => "x" };
    return {
      getTitle: () => title, getType: () => type,
      asListItem: () => { if (type !== T.LIST) throw new Error("Invalid conversion for item type: " + type); return { createResponse: resp, getChoices: () => [choice] }; },
      asTextItem: () => ({ createResponse: resp }),
      asParagraphTextItem: () => ({ createResponse: resp }),
      asCheckboxItem: () => ({ createResponse: resp, getChoices: () => [choice] }),
      asMultipleChoiceItem: () => ({ createResponse: resp, getChoices: () => [choice] }),
    };
  };
  const mkForm = (items) => ({
    getItems: () => items,
    getPublishedUrl: () => "https://form",
    createResponse: () => { let id; const r = { withItemResponse: (x) => { id = x.id; return r; }, toPrefilledUrl: () => `https://form?usp=pp_url&entry.${id}=x` }; return r; },
  });
  const forms = {
    o: mkForm([mkItem(Q.whichOrg, T.TEXT)]),
    e: mkForm([mkItem(Q.hostOrg, T.TEXT), mkItem(Q.coalition, T.LIST), mkItem(Q.whichEvent, T.LIST)]),
    p: mkForm([mkItem(Q.hostOrg, T.TEXT), mkItem(Q.coalition, T.LIST), mkItem(Q.whichProject, T.LIST)]),
    a: mkForm([mkItem(Q.hostOrg, T.TEXT), mkItem(Q.coalition, T.LIST), mkItem(Q.whichAction, T.LIST)]),
    f: mkForm([]),
  };
  let flaky = 2;
  ctx.FormApp = { ItemType: T, openById: (id) => { if (id === "e" && flaky-- > 0) throw new Error("Unexpected error while getting the method or property openById on object FormApp."); return forms[id]; } };
  Object.assign(props, { FORM_ORG: "o", FORM_EVENT: "e", FORM_PROJECT: "p", FORM_ACTION: "a", FORM_FEEDBACK: "f" });
  const cfg = J(G("siteFormConfig_")());
  assert.match(cfg.org.orgEntry, /^entry\.\d+$/);
  for (const k of ["event", "project", "action"]) {
    assert.match(cfg[k].hostOrgEntry, /^entry\.\d+$/, k + " host org (typed)");
    assert.match(cfg[k].coalitionEntry, /^entry\.\d+$/);
    assert.match(cfg[k].itemEntry, /^entry\.\d+$/);
  }
  assert.equal(flaky, -1, "retried past two transient failures");
  console.log("site form config with typed questions OK");
}

// 7. Event/project pins: room words stripped, the host's town added, and matches outside Massachusetts rejected.
{
  const clean = G("cleanPlace_");
  assert.equal(clean("George Sherman Hall, 2nd floor"), "George Sherman Hall");
  assert.equal(clean("Room 104, 12 Main St, Lowell"), "12 Main St, Lowell");
  assert.equal(clean("Suite B, 5 Elm St"), "5 Elm St");
  const qs = J(G("geocodeQueries_")("George Sherman Hall, 2nd floor", "Boston"));
  assert.deepEqual(qs, ["George Sherman Hall, Boston, Massachusetts", "George Sherman Hall, Massachusetts"]);
  assert.deepEqual(J(G("geocodeQueries_")("Statewide", "Boston")), []);
  const saved = ctx.Maps;
  const asked = [];
  ctx.Maps = { newGeocoder: () => ({ setRegion() { return this; }, geocode: (q) => {
    asked.push(q);
    // The bare hall name matches a place in Ohio first, then (with the town added) the real one in Boston.
    return /Boston/.test(q) ? { status: "OK", results: [{ geometry: { location: { lat: 42.3134, lng: -71.0386 } } }] }
      : { status: "OK", results: [{ geometry: { location: { lat: 40.0, lng: -83.0 } } }] };
  } }) };
  assert.deepEqual(J(G("geocode_")("George Sherman Hall, 2nd floor", "Boston")), [42.3134, -71.0386]);
  assert.equal(asked.length, 1, "town-first query used");
  assert.equal(G("geocode_")("George Sherman Hall"), null, "out-of-state match rejected");
  ctx.Maps = saved;
  console.log("event pins: cleaned, host town added, out-of-state rejected OK");
}
{
  const t = {
    orgs: [{ id: "cccc_org", hq_address: "Boston" }], coalitions: [],
    events: [
      { _row: 2, id: "ev_mixer", name: "Cross Campus Mixer", host_org_id: "cccc_org", location: "George Sherman Hall, 2nd floor", online: "FALSE", lat: 42.38, lng: -71.42 },
      { _row: 3, id: "ev_ok", name: "Fine", location: "Lowell", online: "FALSE", lat: 42.63, lng: -71.31 },
      { _row: 5, id: "ev_far", name: "Far", location: "12 Main St, Springfield", online: "FALSE", lat: 40, lng: -83 },
      { _row: 6, id: "ev_same", name: "Same", host_org_id: "cccc_org", location: "Campus Center", online: "FALSE", lat: 42.3135, lng: -71.0385 },
      { _row: 4, id: "ev_web", name: "Webinar", location: "Zoom", online: "TRUE", lat: "", lng: "" },
    ],
    projects: [],
  };
  const hints = [];
  const out = J(G("fixPins_")(t, (place, hint) => { hints.push(hint); return [42.3134, -71.0386]; }));
  assert.deepEqual(out.map((o) => o.id), ["ev_mixer", "ev_far"], "Sudbury pin moved; out-of-state moved; close one kept");
  assert.deepEqual(hints, ["Boston", "", "Boston"]);
  console.log("menu: re-place pins outside Massachusetts OK");
}
{
  const T = { TEXT: "TEXT", MULTIPLE_CHOICE: "MC", DATE: "DATE", CHECKBOX: "CB", PARAGRAPH_TEXT: "P", LIST: "L", TIME: "TIME" };
  const req = [];
  const mk = (title, type) => { const typed = { setRequired: (v) => req.push([title, v]) }; return { getTitle: () => title, getType: () => type, asTextItem: () => typed, asMultipleChoiceItem: () => typed, asDateItem: () => typed }; };
  const ev = { getItems: () => [mk(Q.eventName, T.TEXT), mk(Q.freeFood, T.MULTIPLE_CHOICE), mk(Q.location, T.TEXT), mk(Q.eventDate, T.DATE)] };
  const pr = { getItems: () => [mk(Q.helpWanted, T.MULTIPLE_CHOICE), mk(Q.link, T.TEXT)] };
  ctx.FormApp = { ItemType: T, openById: (id) => (id === "e" ? ev : pr) };
  Object.assign(props, { FORM_EVENT: "e", FORM_PROJECT: "p" });
  G("requireKeyQuestions")();
  assert.deepEqual(req.map((r) => r[0]).sort(), [Q.eventDate, Q.eventName, Q.freeFood, Q.helpWanted].sort(), "location stays optional; link is required on the event form only");
  console.log("menu: key questions required OK");
}

// 10. Wikipedia-based topics on the forms: Topics tab rows, seed checkboxes, typed topics matched by name or alias.
{
  const rows = [
    ["hop_distance", "topic", "aliases", "qid", "seeds", "lift_lcb_max"],
    ["1", "Heat pump", "Heat pumps | Air-source heat pump", "Q1", "Q125928", "12"],
    ["0", "Climate change", "Global warming | Climate crisis", "Q125928", "", ""],
    ["1", "Zivildienst", "", "Q2", "Q125928", "3"],
    ["0", "Climate justice", "", "Q1291678", "", ""],
    ["1", "Washington, D.C.", "DC | District of Columbia", "Q61", "Q1291678,Q125928", "9"],
  ];
  const out = J(G("wikiTopicRows_")(rows, 8));
  assert.deepEqual(out.map((r) => r[0]), ["Climate change", "Climate justice", "Heat pump", "Washington, D.C."], "seeds first, low lift dropped");
  assert.equal(out[2][2], "Under Climate change · Wikidata Q1");
  assert.equal(out[3][4], "Climate justice | Climate change", "every seed listed");
  assert.equal(out[3][2], "Under Climate justice, Climate change · Wikidata Q61");
  const t = { topics: out.map((r) => ({ name: r[0], aliases: r[1], notes: r[2] })), coalitions: [], orgs: [], events: [], projects: [] };
  assert.deepEqual(J(G("tagChoices_")(t, "wiki")), ["Climate change", "Climate justice", "Youth serving"]);
  assert.ok(J(G("tagChoices_")(t, "groups")).includes("Clean energy"), "group-based choices unchanged");
  const r = J(G("resolveTopics_")("global warming, heat pumps, District of Columbia, heat pumpp, basket weaving", t));
  assert.deepEqual(r.slugs, ["climate_change", "heat_pump", "washington_d_c", "heat_pump"]);
  assert.deepEqual(r.missed.map((m) => m.typed), ["basket weaving"]);
  // no Wikipedia lookups: wording that isn't on the list (or its aliases) goes to review
  const r2 = J(G("resolveTopics_")("carbon tax on polluters", t));
  assert.deepEqual(r2.slugs, []);
  assert.deepEqual(r2.missed.map((m) => m.typed), ["carbon tax on polluters"]);
  assert.equal(G("typeof wikiSearchTitles_"), "undefined", "Wikipedia search removed");
  // monthly review: a topic name in "resolution" becomes an alias
  const un = [{ what: "topic", typed: "warming of the planet", resolution: "Climate change", status: "new", _row: 2 },
    { what: "topic", typed: "global warming", resolution: "Climate change", status: "new", _row: 3 },
    { what: "topic", typed: "x", resolution: "Not a topic", status: "new", _row: 4 },
    { what: "topic", typed: "y", resolution: "", status: "new", _row: 5 },
    { what: "organization", typed: "z", resolution: "Climate change", status: "new", _row: 6 }];
  const ra = G("reviewedAliases_")(un, t.topics);
  assert.deepEqual(ra.topicUpdates.map((u) => [u.row.name, u.aliases]), [["Climate change", "Global warming | Climate crisis | warming of the planet"]]);
  assert.deepEqual(ra.done.map((r) => r._row), [2, 3]);
  assert.deepEqual(J(ra.unknown), ["Not a topic"]);
  console.log("Wikipedia-based topics on the forms OK");
}
{
  const msg = G("orgConfirmation_")("https://p", "https://e", "");
  assert.match(msg, /Add a project: https:\/\/p/);
  assert.match(msg, /Add an event: https:\/\/e/);
  assert.ok(!/action/.test(msg.split("Next")[1]), "no link for a missing form");
  assert.equal(Q.orgDesc, "Mission statement and description");
  assert.ok(G("FEEDBACK_AREAS").includes("Topics page (Streams or Command room)"));
  console.log("org form next steps, mission statement title, feedback areas OK");
}
{
  const rows = [["from_org","to_org","frequency","kind","said"],
    ["a","b","few_per_year","org","x"], ["b","a","weekly","org","dup reversed"], ["a","c","","org","y"], ["a","zz","","org","missing"],
    ["a","mpf","","coalition","member"], ["b","mpf","","coalition","already"]];
  const t = { orgs: [{ id: "a", coalition_ids: "" }, { id: "b", coalition_ids: "mpf" }, { id: "c" }], coalitions: [{ id: "mpf" }], connections: [{ from_org: "c", to_org: "a" }] };
  const out = J(G("connectionsToAdd_")(rows, t));
  // each group that named the other gets its own row (so "both named each other" can be shown); only exact repeats
  // are skipped (c → a is already there, a → c is new); a blank frequency stays blank (the form didn't ask)
  assert.deepEqual(out.links, [{ from_org: "a", to_org: "b", frequency: "few_per_year" }, { from_org: "b", to_org: "a", frequency: "weekly" }, { from_org: "a", to_org: "c", frequency: "" }], "one row per direction");
  {
    // both directions → one link reported by both; one direction → reported by one
    const d2 = G("buildDataFile_")({ coalitions: [], orgs: [{ id: "a", name: "A", lat: 0, lng: 0 }, { id: "b", name: "B", lat: 0, lng: 0 }, { id: "c", name: "C", lat: 0, lng: 0 }], projects: [], events: [], actions: [],
      connections: [{ from_org: "a", to_org: "b", frequency: "" }, { from_org: "b", to_org: "a", frequency: "" }, { from_org: "c", to_org: "a", frequency: "" }] }, "x");
    const links = J(d2.org_links);
    assert.deepEqual(links.map((l) => [l.source, l.target, l.reported_by.sort().join("+"), l.weight]), [["a", "b", "a+b", 1], ["a", "c", "c", 1]]);
  }
  assert.deepEqual(out.memberships, [{ org: "a", coalition: "mpf" }]);
  assert.equal(out.skipped.length, 1);
  console.log("reviewed connections import OK");
}
{
  // The org form update keeps the typed "works with" box and removes the old grid (it used to add it back).
  const T = { TEXT: "TEXT", PARAGRAPH_TEXT: "P", CHECKBOX: "CB", GRID: "GRID", PAGE_BREAK: "PB" };
  let items = [
    { t: Q.orgType, ty: T.CHECKBOX }, { t: Q.worksWithGrid, ty: T.GRID }, { t: Q.worksWithText, ty: T.PARAGRAPH_TEXT },
  ].map((x, i) => ({ getTitle: () => x.t, getType: () => x.ty, getIndex: () => i, setHelpText() { return this; }, setTitle() { return this; } }));
  const deleted = [];
  const form = { getItems: () => items, deleteItem: (it) => { deleted.push(it.getTitle()); items = items.filter((x) => x !== it); }, moveItem() {} };
  ctx.FormApp = { ItemType: T };
  vm.runInContext("placePointPerson_ = function () {}", ctx);
  G("upgradeOrgForm_")(form);
  assert.deepEqual(deleted, [Q.worksWithGrid]);
  console.log("org form: old works-with grid removed OK");
}
{
  // Event check (Oct 18): listed events and events with no page are hidden; moved links and dates are fixed.
  const rows = [
    { id: "a", name: "Gone", link: "https://x.org/a", _row: 2 },
    { id: "b", name: "No page", link: "somelink", _row: 3 },
    { id: "c", name: "Moved", link: "https://old.org/c", _row: 4 },
    { id: "d", name: "Fine", link: "", rsvp_link: "https://rsvp.org/d", _row: 5 },
    { id: "e", name: "Already hidden", link: "", hidden: "TRUE", _row: 6 },
    { id: "f", name: "Gets its page from the check", link: "", _row: 7 },
  ];
  const ups = G("eventCheckUpdates_")(rows, { checked: "2026-10-18", remove: ["a"], fix: { c: { link: "https://new.org/c" }, d: { rsvp_link: "https://rsvp.org/d" }, f: { link: "https://form.org/f" } } });
  assert.deepEqual(ups.map((u) => [u.row.id, u.updates]), [["a", { hidden: "TRUE" }], ["b", { hidden: "TRUE" }], ["c", { link: "https://new.org/c" }], ["f", { link: "https://form.org/f" }]]);
  console.log("menu: source check OK");
}
{
  // Source check additions: rows for the group (coalition_id or host_org_id), and the same values as fixes.
  const check = { add: { mycc: { projects: [{ id: "p1", name: "Prep", skills_needed: ["a", "b"], link: "https://x.org" }], actions: [{ id: "a1", name: "Join", deadline: null, verified: true, link: "https://f.org" }] }, org1: { events: [{ id: "e1", name: "E", link: "https://e.org" }] } } };
  const adds = G("sourceCheckAdds_")(check, { mycc: true });
  assert.deepEqual(J(adds.projects), [{ id: "p1", name: "Prep", skills_needed: "a, b", link: "https://x.org", coalition_id: "mycc" }]);
  assert.deepEqual(J(adds.actions), [{ id: "a1", name: "Join", deadline: "", verified: "TRUE", link: "https://f.org", coalition_id: "mycc" }]);
  assert.equal(adds.events[0].host_org_id, "org1");
  assert.equal(check.fix.p1.link, "https://x.org");
  const ups = G("eventCheckUpdates_")([{ id: "p1", name: "Old wording", link: "", _row: 2 }], check);
  assert.deepEqual(J(ups.map((u) => u.updates)), [{ name: "Prep", skills_needed: "a, b", link: "https://x.org", coalition_id: "mycc" }]);
  console.log("menu: source check additions OK");
}
{
  // Social justice spreadsheet (Oct 23): its own feed, nothing when it isn't linked yet.
  assert.equal(G("sheetIdFrom_")("https://docs.google.com/spreadsheets/d/1AbC_defGHIjklMNOpqrSTUvwxYZ0123456789/edit#gid=0"), "1AbC_defGHIjklMNOpqrSTUvwxYZ0123456789");
  assert.equal(G("sheetIdFrom_")("not a link"), "");
  delete props.SJ_SHEET_ID;
  assert.equal(G("socialJusticeData_")().unlinked, true);
  props.SJ_SHEET_ID = "sj-sheet"; // the fake opens the same workbook: same tabs, same shape
  const sj = G("socialJusticeData_")();
  assert.ok(Array.isArray(sj.coalitions) && Array.isArray(sj.organizations) && Array.isArray(sj.edges));
  delete props.SJ_SHEET_ID;
  console.log("social justice feed OK");
}
{
  // Group Confirmation Screen (Nov 3): the static page talks to the web app with plain JSON (GET ?api=confirm, doPost).
  // One private link per organization and coalition; one editor at a time (page lock) with autosave; the first submit
  // wins; two more point people; best way to reach cleared without a phone.
  const LC = G("LINK_COLS");
  book["Links"] = [LC.filter((c) => c !== "kind")]; // a sheet made before coalitions had links: the kind column gets added
  props.LINKS_SHEET_ID = "links-sheet"; // the fake opens the same workbook
  const PAGE = "https://ma.climateorgmap.earth/confirm.html";
  assert.equal(G("confirmPageUrl_")(), PAGE);
  const t0 = ctx.readAll_();
  const added = G("addConfirmationLinks_")(ssObj, t0, PAGE);
  assert.equal(book["Links"][0].join(","), LC.join(","), "kind column appended");
  assert.ok(added > 50, "a link per visible org (and coalition)");
  assert.equal(G("addConfirmationLinks_")(ssObj, ctx.readAll_(), PAGE), 0, "running again adds nothing");
  const linkRows = () => book["Links"].slice(1).map((r) => Object.fromEntries(LC.map((c, i) => [c, r[i]])));
  const linkOf = (id, kind = "organization") => linkRows().find((r) => r.org_id === id && r.kind === kind);
  assert.equal(linkRows().filter((r) => r.kind === "coalition").length, t0.coalitions.length, "a link per coalition");
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const get = (t) => JSON.parse(ctx.doGet({ parameter: { api: "confirm", t } }).getContent());
  const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32);

  // addresses: rewriting old-style links and blank kinds (menu: updateConfirmationLinkAddresses)
  {
    const col = (n) => LC.indexOf(n);
    book["Links"][1][col("link")] = "https://script/exec?confirm=" + book["Links"][1][col("token")];
    book["Links"][1][col("kind")] = "";
    props.CONFIRM_PAGE_URL = "https://example.org/c.html";
    G("updateConfirmationLinkAddresses")();
    assert.ok(linkRows().every((r) => r.link === "https://example.org/c.html?t=" + r.token), "every link points at the page");
    assert.equal(linkRows()[0].kind, "organization");
    delete props.CONFIRM_PAGE_URL;
    G("updateConfirmationLinkAddresses")();
    assert.equal(linkRows()[0].link, PAGE + "?t=" + linkRows()[0].token);
  }

  // an organization with events and no point people yet
  const evs = ctx.readAll_().events.filter((e) => e.host_org_id && !ctx.isTrue_(e.hidden));
  const orgId = evs.map((e) => e.host_org_id).find((id) => id !== "boston_latin_school_youthcan" && G("pointPeopleOf_")(id, ctx.readAll_().editors).length === 0);
  const L = linkOf(orgId);
  assert.match(L.token, /^[0-9a-f]{32}$/);
  assert.equal(L.link, PAGE + "?t=" + L.token);
  assert.equal(G("linkRow_")("deadbeef"), null);

  // GET api: data shape for an organization and a coalition
  const g = get(L.token);
  assert.equal(g.ok, true);
  const dd = g.data;
  assert.equal(dd.kind, "organization"); assert.equal(dd.org.id, orgId); assert.equal(dd.org.kind, "org");
  assert.equal(dd.token, L.token); assert.equal(dd.submittedAt, ""); assert.equal(dd.draft, null); assert.equal(dd.draftAt, "");
  assert.equal(dd.maxPointPeople, 3); assert.equal(dd.lockSeconds, 150); assert.equal(dd.pingSeconds, 15);
  assert.deepEqual(Object.keys(dd.fields).sort(), ["action", "coalition", "event", "org", "project"]);
  assert.ok(dd.items.length && dd.items.every((i) => i.id && ["event", "project", "action"].includes(i.kind) && "verified" in i && "needs_info" in i));
  assert.equal(linkOf(orgId).status, "opened");
  assert.equal(maskCheck(), true);
  function maskCheck() { return G("maskEmail_")("nathan@example.org") === "na•••@example.org"; }
  const LCo = linkOf("mycc", "coalition");
  const gc = get(LCo.token).data;
  assert.equal(gc.kind, "coalition"); assert.equal(gc.org.kind, "coalition"); assert.equal(gc.org.id, "mycc");
  assert.deepEqual(Object.keys(gc.org).sort(), ["description", "geographic_scope", "id", "kind", "name", "website"]);
  assert.ok(gc.items.some((i) => i.id === "mycc_e_call_1004" && i.kind === "event"), "coalition-tagged events are its items");
  assert.ok(gc.items.every((i) => ctx.readAll_().events.concat(ctx.readAll_().projects, ctx.readAll_().actions).find((r) => r.id === i.id).coalition_id === "mycc"));
  assert.equal(gc.pointPeople.length, 1, "the coalition's existing point person (Editors coalition_ids)");
  assert.match(get("0".repeat(32)).error, /doesn't work/);
  assert.equal(get("nope").ok, false);

  // old ?confirm= links: a short "moved" page with a link to the new address
  const moved = ctx.doGet({ parameter: { confirm: L.token } }).html;
  assert.match(moved, /This page has moved/);
  assert.ok(moved.includes('target="_top"') && moved.includes('href="' + PAGE + "?t=" + L.token + '"'));
  assert.ok(!/href=/.test(ctx.doGet({ parameter: { confirm: "x<y" } }).html), "no link for a bad token");

  // one editor at a time
  const cl = post({ action: "claim", token: L.token, sid: A, name: "Ann" });
  assert.deepEqual(J({ ...cl, draft: null }), { ok: true, editor: true, draft: null, draftAt: "", submittedAt: "" });
  assert.equal(cacheTtl["lock:" + L.token], 150, "lock lasts 150 s");
  const cl2 = post({ action: "claim", token: L.token, sid: B, name: "Bob" });
  assert.equal(cl2.ok, true); assert.equal(cl2.editor, false); assert.equal(cl2.heldBy, "Ann"); assert.ok(cl2.since);
  assert.equal(post({ action: "claim", token: L.token, sid: A, name: "Ann" }).editor, true, "the holder can claim again");

  // autosave: ping with state writes the shared draft, without personal details
  const who = { name: "Pat Point", email: "Pat@Example.org", phone: "617-555-0142", best: "Text" };
  const state = { who, others: [{ name: "Sam Second", email: "sam@example.org", phone: "", best: "" }], org: { decision: "approve", fields: { description: "Draft text" } }, items: {} };
  const pg = post({ action: "ping", token: L.token, sid: A, name: "Ann", state, draftAt: "" });
  assert.equal(pg.ok, true); assert.equal(pg.editor, true); assert.ok(pg.savedAt);
  const stored = JSON.parse(linkOf(orgId).draft);
  assert.equal(stored.who, undefined); assert.equal(stored.others, undefined);
  assert.equal(stored.org.fields.description, "Draft text");
  assert.ok(!linkOf(orgId).draft.includes("617-555-0142") && !linkOf(orgId).draft.includes("sam@example.org"), "no personal details in the shared draft");
  assert.equal(linkOf(orgId).status, "in progress", "autosave is not Save for later");
  assert.equal(linkOf(orgId).notes, "", "autosave leaves notes alone");
  assert.equal(linkOf(orgId).saved_at, pg.savedAt);
  assert.equal(post({ action: "ping", token: L.token, sid: A, name: "Ann" }).savedAt, undefined, "no state, no save");
  // viewers see the editor's work, and only when it changed
  const vp = post({ action: "ping", token: L.token, sid: B, name: "Bob", draftAt: "" });
  assert.equal(vp.editor, false); assert.equal(vp.heldBy, "Ann"); assert.equal(vp.lost, false); assert.equal(vp.draftAt, pg.savedAt);
  assert.equal(vp.draft.org.fields.description, "Draft text");
  assert.equal("draft" in post({ action: "ping", token: L.token, sid: B, name: "Bob", draftAt: pg.savedAt }), false);
  // not the holder: save and submit are refused
  const rs = post({ action: "save", token: L.token, sid: B, state });
  assert.equal(rs.ok, false); assert.match(rs.error, /Ann is editing this page now\. Press Take over/);
  const rsub = post({ action: "submit", token: L.token, sid: B, state, baseSubmittedAt: "" });
  assert.equal(rsub.ok, false); assert.match(rsub.error, /Ann is editing/);
  assert.equal(linkOf(orgId).status, "in progress");

  // take over: Bob gets the latest draft, Ann hears she lost it
  const to = post({ action: "takeover", token: L.token, sid: B, name: "Bob" });
  assert.equal(to.editor, true); assert.equal(to.draft.org.fields.description, "Draft text"); assert.equal(to.draftAt, pg.savedAt);
  assert.match(linkOf(orgId).notes, /^taken over by Bob at /);
  const ap = post({ action: "ping", token: L.token, sid: A, name: "Ann", state: { org: { decision: "", fields: {} }, items: {} }, draftAt: pg.savedAt });
  assert.equal(ap.editor, false); assert.equal(ap.lost, true); assert.equal(ap.heldBy, "Bob");
  assert.equal(JSON.parse(linkOf(orgId).draft).org.fields.description, "Draft text", "a viewer's ping never saves");
  assert.equal(post({ action: "save", token: L.token, sid: B, state }).ok, true, "the holder can save");
  assert.equal(linkOf(orgId).status, "saved for later"); assert.match(linkOf(orgId).notes, /last saved by pat@example.org/);
  // release frees the lock only for its holder
  post({ action: "release", token: L.token, sid: A });
  assert.equal(post({ action: "claim", token: L.token, sid: A, name: "Ann" }).editor, false);
  assert.deepEqual(J(post({ action: "release", token: L.token, sid: B })), { ok: true });
  // when the lock runs out: quietly retaken if nothing changed since, lost if someone saved meanwhile
  const savedNow = linkOf(orgId).saved_at;
  assert.equal(post({ action: "ping", token: L.token, sid: A, name: "Ann", draftAt: savedNow }).editor, true, "retaken after the lock expired");
  delete cache["lock:" + L.token];
  const stale = post({ action: "ping", token: L.token, sid: B, name: "Bob", draftAt: "2000-01-01T00:00:00.000Z" });
  assert.equal(stale.editor, false); assert.equal(stale.lost, true);
  assert.equal(post({ action: "ping", token: "f".repeat(32), sid: A }).gone, true);
  post({ action: "release", token: L.token, sid: A });

  // submit: the submitter and two more point people (pending, with emails); best cleared without a phone
  assert.equal(G("confirmWho_")({ name: "X", email: "x@example.org", best: "Text" }).best, "", "no phone, no best way");
  assert.equal(G("confirmWho_")({ name: "X", email: "x@example.org", phone: "617-555-0142", best: "Text" }).best, "Text");
  assert.throws(() => G("confirmWho_")({ name: "X", email: "x@example.org", phone: "call me maybe" }), /phone/);
  const second = evs.find((e) => e.host_org_id === orgId);
  const foreign = evs.find((e) => e.host_org_id !== orgId);
  const items = {
    [second.id]: { kind: "event", decision: "approve", fields: { name: "Renamed by the group", date: "2026-11-20T18:30", link: "example.org/x", hidden: "TRUE" } },
    [foreign.id]: { kind: "event", decision: "remove" },
  };
  const st = {
    who, org: { decision: "approve", fields: { description: "Checked by the group" } }, items,
    others: [{ name: "Sam Second", email: "Sam@Example.org", phone: "", best: "Email" }, { name: "Tina Third", email: "tina@example.org", phone: "617-555-0143", best: "Phone call" }, { name: "", email: "", phone: "" }],
  };
  // an incomplete extra person stops everything (nothing half-applied)
  const badOther = post({ action: "submit", token: L.token, sid: A, state: { ...st, others: [{ name: "", email: "z@example.org" }] }, baseSubmittedAt: "" });
  assert.equal(badOther.ok, false); assert.match(badOther.error, /name of the other point person/);
  assert.ok(!ctx.readAll_().events.find((e) => e.id === second.id).verified || ctx.readAll_().events.find((e) => e.id === second.id).name !== "Renamed by the group");
  const before = mail.length;
  const res = post({ action: "submit", token: L.token, sid: A, state: st, baseSubmittedAt: "" });
  assert.equal(res.ok, true); assert.match(res.summary, /approved/); assert.ok(res.submittedAt);
  const e0 = ctx.readAll_().events.find((e) => e.id === second.id);
  assert.equal(e0.name, "Renamed by the group"); assert.equal(e0.date, "2026-11-20T18:30:00"); assert.equal(e0.link, "https://example.org/x");
  assert.ok(ctx.isTrue_(e0.verified)); assert.ok(!ctx.isTrue_(e0.hidden), "only listed fields can change");
  assert.ok(!ctx.isTrue_(ctx.readAll_().events.find((e) => e.id === foreign.id).hidden), "another group's item is untouched");
  assert.equal(ctx.readAll_().orgs.find((o) => o.id === orgId).description, "Checked by the group");
  assert.equal(linkOf(orgId).status, "submitted"); assert.equal(linkOf(orgId).draft, ""); assert.equal(linkOf(orgId).submitted_at, res.submittedAt);
  assert.equal(readLockFor(L.token), null, "submit frees the lock");
  function readLockFor(t) { return cache["lock:" + t] || null; }
  assert.ok(log().some((l) => l.form === "Confirmation screen" && l.record_id === second.id));
  const eds = ctx.readAll_().editors, edOf = (e) => eds.find((r) => String(r.email).toLowerCase() === e);
  for (const e of ["pat@example.org", "sam@example.org", "tina@example.org"]) {
    assert.ok(edOf(e) && ctx.isPending_(edOf(e)) && ctx.list_(edOf(e).org_ids).includes(orgId), e + " pending point person");
    assert.ok(mail.slice(before).some((m) => m.to === e && /confirm your email/.test(m.subject) && m.body.includes(PAGE + "?verify=")), e + " got a verification email");
  }
  assert.match(String(edOf("pat@example.org").notes), /phone: 617-555-0142; best way to reach: Text/);
  assert.ok(!/best way to reach/.test(String(edOf("sam@example.org").notes)), "best cleared without a phone");
  assert.match(String(edOf("tina@example.org").notes), /best way to reach: Phone call/);
  assert.equal(G("pointPeopleOf_")(orgId, eds).length, 3);
  assert.ok(log().some((l) => l.email === "sam@example.org" && l.status === "added" && /another point person/.test(l.changes)));
  assert.ok(res.lines.some((l) => /sam@example.org added as another point person/.test(l)));
  assert.ok(mail.slice(before).some((m) => /checked their information/.test(m.subject)));
  const full = JSON.stringify(get(L.token));
  assert.ok(!full.includes("617-555-014") && !full.includes("sam@example.org"), "no phones or full emails on the page data");
  assert.ok(!JSON.stringify(ctx.buildDataFile_(ctx.readAll_(), "now")).includes("617-555-0142"), "phone never in the public feed");

  // first submit wins: a page built on the old version is refused
  const late = post({ action: "submit", token: L.token, sid: C, state: st, baseSubmittedAt: "" });
  assert.equal(late.ok, false); assert.equal(late.conflict, true);
  assert.match(late.error, /^Pat Point already submitted this page at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\. Reload/);
  assert.ok(!late.error.includes("example.org"));
  // with the current version it goes through; the group is full, and someone already on file is not overwritten
  const before2 = mail.length;
  const res2 = post({ action: "submit", token: L.token, sid: C, baseSubmittedAt: res.submittedAt,
    state: { who: { name: "Pat Point", email: "pat@example.org" }, items: {},
      others: [{ name: "Not Sam", email: "sam@example.org", phone: "617-555-0999", best: "Text" }, { name: "Una Unlucky", email: "una@example.org" }] } });
  assert.equal(res2.ok, true);
  assert.equal(String(edOf("sam@example.org").name), "Sam Second");
  assert.equal(String(ctx.readAll_().editors.find((r) => r.email === "sam@example.org").name), "Sam Second", "existing details not overwritten");
  assert.ok(!/0999/.test(String(ctx.readAll_().editors.find((r) => r.email === "sam@example.org").notes)));
  assert.ok(res2.lines.some((l) => /sam@example.org .*already a point person/.test(l)));
  assert.ok(res2.lines.some((l) => /una@example.org not added.*already has 3/.test(l)));
  assert.ok(!ctx.readAll_().editors.some((r) => r.email === "una@example.org"), "cap of three");
  assert.ok(!mail.slice(before2).some((m) => m.to === "una@example.org"));
  assert.ok(log().some((l) => l.email === "una@example.org" && l.status === "not added" && l.flag === "FULL"));
  assert.ok(log().some((l) => l.email === "sam@example.org" && l.status === "skipped"));
  // an out-of-date page whose lock ran out is not handed the lock back: it is told the page was submitted
  delete cache["lock:" + L.token];
  const staleP = post({ action: "ping", token: L.token, sid: A, name: "Ann", draftAt: "", baseSubmittedAt: "" });
  assert.equal(staleP.editor, false); assert.equal(staleP.submittedAt, res2.submittedAt); assert.equal(cache["lock:" + L.token], undefined, "no lock for a stale page");
  // the verification link works through the page's API
  const tok = /\?verify=([0-9a-f]+)/.exec(mail.find((m) => m.to === "tina@example.org" && /confirm your email/.test(m.subject)).body)[1];
  const vr = post({ action: "verify", verify: tok });
  assert.equal(vr.ok, true); assert.match(vr.message, /confirmed/);
  assert.equal(ctx.readAll_().editors.find((r) => r.email === "tina@example.org").role, "editor");

  // a coalition: its card and its tagged items, not another coalition's
  const cstate = (extra) => ({ who: { name: "Cora Coalition", email: "cora@example.org" }, org: { decision: "approve", fields: { description: "A coalition of youth groups", website: "mycc.example.org", geographic_scope: "Statewide", hidden: "TRUE" } }, items: extra, others: [] });
  const notMycc = ctx.readAll_().events.find((e) => e.id !== "mycc_e_call_1004" && e.coalition_id !== "mycc" && !ctx.isTrue_(e.hidden));
  const cres = post({ action: "submit", token: LCo.token, sid: A, baseSubmittedAt: "", state: cstate({
    mycc_e_call_1004: { kind: "event", decision: "approve", fields: { name: "MYCC call (checked)" } },
    [notMycc.id]: { kind: "event", decision: "remove" },
  }) });
  assert.equal(cres.ok, true);
  const co = ctx.readAll_().coalitions.find((c) => c.id === "mycc");
  assert.equal(co.description, "A coalition of youth groups"); assert.equal(co.website, "https://mycc.example.org"); assert.equal(co.geographic_scope, "Statewide");
  assert.notEqual(co.hidden, "TRUE");
  const ce = ctx.readAll_().events.find((e) => e.id === "mycc_e_call_1004");
  assert.equal(ce.name, "MYCC call (checked)"); assert.ok(ctx.isTrue_(ce.verified));
  assert.ok(!ctx.isTrue_(ctx.readAll_().events.find((e) => e.id === notMycc.id).hidden), "another coalition's item is untouched");
  assert.ok(log().some((l) => l.form === "Confirmation screen" && l.record_type === "coalition" && l.record_id === "mycc" && /description/.test(l.changes)));
  const cora = ctx.readAll_().editors.find((r) => r.email === "cora@example.org");
  assert.ok(cora && ctx.isPending_(cora) && ctx.list_(cora.coalition_ids).includes("mycc") && !String(cora.org_ids), "coalition point person");
  assert.equal(G("pointPeopleOf_")("mycc", ctx.readAll_().editors, "coalition").length, 2);
  assert.equal(G("pointPeopleOf_")("mycc", ctx.readAll_().editors).length, 0, "org lookups don't see coalition ids");
  assert.ok(mail.some((m) => m.to === "cora@example.org" && m.body.includes(PAGE + "?verify=")));
  assert.equal(linkOf("mycc", "coalition").status, "submitted");

  // doPost never throws
  const raw = (contents) => JSON.parse(ctx.doPost({ postData: { contents } }).getContent());
  assert.equal(raw("{not json").ok, false); assert.match(raw("{not json").error, /could not be read/);
  assert.equal(raw("[]").ok, false); assert.equal(raw("").ok, false);
  assert.equal(JSON.parse(ctx.doPost({}).getContent()).ok, false);
  assert.match(post({ action: "claim", token: "short", sid: A }).error, /doesn't work/);
  assert.match(post({ action: "claim", token: "0".repeat(32), sid: A }).error, /doesn't work/);
  assert.equal(post({ action: "ping", token: "0".repeat(32), sid: A }).gone, true);
  assert.equal(post({ action: "claim", token: L.token, sid: "zz" }).ok, false);
  assert.equal(post({ action: "nope", token: L.token, sid: A }).ok, false);
  assert.equal(post({ action: "submit", token: L.token, sid: A, baseSubmittedAt: res2.submittedAt, state: { who: { name: "", email: "x@example.org" } } }).ok, false);
  assert.match(post({ action: "submit", token: L.token, sid: A, baseSubmittedAt: res2.submittedAt, state: { who: { name: "", email: "x@example.org" } } }).error, /name/);
  assert.equal(post({ action: "verify", verify: "zz" }).ok, true);
  delete props.LINKS_SHEET_ID;
  console.log("confirmation screen OK");
}

// 10) sign-in on the map (SignIn.gs): Google, "Confirm with email" login links, sessions, the sender setting
{
  const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).getContent());
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const cred = (c) => c.repeat(120);
  const infos = {
    [cred("a")]: { aud: "cid.apps.googleusercontent.com", iss: "https://accounts.google.com", email: "Point@BLS.org", email_verified: "true", exp },
    [cred("b")]: { aud: "someone-else", iss: "https://accounts.google.com", email: "point@bls.org", email_verified: "true", exp },
    [cred("c")]: { aud: "cid.apps.googleusercontent.com", iss: "https://accounts.google.com", email: "point@bls.org", email_verified: "false", exp },
    [cred("d")]: { aud: "cid.apps.googleusercontent.com", iss: "https://evil.example", email: "point@bls.org", email_verified: "true", exp },
  };
  ctx.UrlFetchApp = { fetch: (url) => {
    const info = infos[decodeURIComponent(url.split("id_token=")[1])];
    return { getResponseCode: () => (info ? 200 : 400), getContentText: () => JSON.stringify(info || { error: "invalid_token" }) };
  } };
  delete props.GOOGLE_CLIENT_ID;
  assert.match(post({ action: "google", credential: cred("a") }).error, /isn't set up/);
  props.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
  for (const c of ["b", "c", "d", "z"]) assert.equal(post({ action: "google", credential: cred(c) }).ok, false, "rejected token " + c);
  assert.equal(post({ action: "google", credential: "short" }).ok, false);
  const g = post({ action: "google", credential: cred("a") });
  assert.ok(g.ok); assert.equal(g.email, "point@bls.org"); assert.equal(g.how, "google");
  assert.ok(Date.parse(g.expires) - Date.now() > 29.9 * 864e5, "30-day session");
  assert.ok(props.SESSION_SECRET, "secret made on first use");

  // signed in, own group: saved straight away, Change Log says it came from the map
  const ev = (name, host) => ({ [Q.whichEvent]: NEW_EVENT, [Q.hostOrg]: host, [Q.eventName]: name, [Q.eventDate]: "2026-12-01" });
  let r = post({ action: "submitForm", session: g.session, kind: "event", answers: ev("Signed-in event", BLS) });
  assert.ok(r.ok); assert.equal(r.status, "live");
  assert.ok(ctx.readAll_().events.some((e) => e.name === "Signed-in event" && e.host_org_id === "boston_latin_school_youthcan"));
  assert.ok(log().some((l) => l.record_name === "Signed-in event" && /on the map, Google sign-in/.test(l.form)));
  // another group: Needs Review, and the site is told this email isn't that group's point person
  const other = orig.organizations.find((o) => o.id !== "boston_latin_school_youthcan" && orig.organizations.filter((x) => x.name === o.name).length === 1);
  r = post({ action: "submitForm", session: g.session, kind: "event", answers: ev("Not my group event", other.name) });
  assert.ok(r.ok); assert.equal(r.status, "review"); assert.equal(r.notOnFile, true);
  assert.match(r.message, /isn't registered with a point person for this group/);
  assert.match(review().slice(-1)[0].reason, /^UNAUTHORIZED/); assert.match(review().slice(-1)[0].form, /on the map/);
  assert.ok(!ctx.readAll_().events.some((e) => e.name === "Not my group event"));
  // the script's own internal fields can't be set from the site
  const mycc0 = J(ctx.readAll_().coalitions.find((c) => c.id === "mycc"));
  r = post({ action: "submitForm", session: g.session, kind: "org", answers: { [Q.whichOrg]: BLS, __coalition_id: "mycc", groupKind: "coalition", [Q.orgDesc]: "Edited while signed in" } });
  assert.equal(r.status, "live");
  assert.equal(ctx.readAll_().orgs.find((o) => o.id === "boston_latin_school_youthcan").description, "Edited while signed in");
  assert.deepStrictEqual(J(ctx.readAll_().coalitions.find((c) => c.id === "mycc")), mycc0);
  assert.equal(post({ action: "submitForm", session: g.session, kind: "feedback", answers: { [Q.fbMessage]: "x" } }).ok, false);
  assert.equal(post({ action: "submitForm", session: g.session, kind: "event", answers: { [Q.eventName]: "no which" } }).ok, false);
  // altered or expired sessions are refused
  const sig = g.session.split(".")[1];
  const forged = Buffer.from(JSON.stringify({ e: "admin1@example.org", x: Date.now() + 1e9, h: "google" })).toString("base64url") + "." + sig;
  assert.equal(post({ action: "submitForm", session: forged, kind: "event", answers: ev("Forged", BLS) }).signedOut, true);
  const oldPayload = ctx.b64_(JSON.stringify({ e: "point@bls.org", x: Date.now() - 1000, h: "google" }));
  assert.equal(post({ action: "submitForm", session: oldPayload + "." + ctx.signature_(oldPayload), kind: "event", answers: ev("Expired", BLS) }).signedOut, true);
  assert.equal(post({ action: "submitForm", kind: "event", answers: ev("No session", BLS) }).signedOut, true);
  assert.ok(!ctx.readAll_().events.some((e) => /^(Forged|Expired|No session)$/.test(e.name)));

  // "Confirm with email", on file: a 15-minute link to the map; pressing Log in signs in and sends the waiting form
  mail.length = 0;
  r = post({ action: "emailLink", email: " Lead@MYCC.org ", kind: "event", answers: { [Q.whichEvent]: NEW_EVENT, [Q.coalition]: MYCC, [Q.eventName]: "Emailed event", [Q.eventDate]: "2026-12-02" } });
  assert.ok(r.ok); assert.match(r.message, /If lead@mycc\.org belongs to a point person/);
  const m = mail.find((x) => x.to === "lead@mycc.org");
  assert.ok(m && m.body.includes("https://ma.climateorgmap.earth/?login="), "link to the map's home page");
  assert.equal(m.opts.name, G("REGION").title);
  const tok = /\?login=([0-9a-f]{32})/.exec(m.body)[1];
  assert.equal(cacheTtl["LOGIN_" + tok], 900, "15 minutes");
  assert.ok(!ctx.readAll_().events.some((e) => e.name === "Emailed event"), "nothing saved before the link is used");
  const li = post({ action: "login", token: tok });
  assert.ok(li.ok); assert.equal(li.email, "lead@mycc.org"); assert.equal(li.how, "email"); assert.equal(li.result.status, "live");
  assert.ok(ctx.readAll_().events.some((e) => e.name === "Emailed event" && e.coalition_id === "mycc"));
  assert.ok(log().some((l) => l.record_name === "Emailed event" && /on the map, email link/.test(l.form)));
  assert.match(post({ action: "login", token: tok }).error, /expired or was already used/, "one use");
  assert.equal(post({ action: "login", token: "nope" }).ok, false);
  // sign in only (top right): no form waiting
  mail.length = 0;
  assert.ok(post({ action: "emailLink", email: "point@bls.org" }).ok);
  const tok2 = /\?login=([0-9a-f]{32})/.exec(mail.find((x) => x.to === "point@bls.org").body)[1];
  const li2 = post({ action: "login", token: tok2 });
  assert.ok(li2.ok && li2.session && !li2.result);
  // an expired link
  mail.length = 0;
  post({ action: "emailLink", email: "admin1@example.org" });
  const tok3 = /\?login=([0-9a-f]{32})/.exec(mail.find((x) => x.to === "admin1@example.org").body)[1];
  cache["LOGIN_" + tok3] = JSON.stringify({ ...JSON.parse(cache["LOGIN_" + tok3]), exp: Date.now() - 1 });
  assert.equal(post({ action: "login", token: tok3 }).ok, false);

  // not on file: the same message, no email to that address, held in Needs Review with no email attached
  mail.length = 0;
  r = post({ action: "emailLink", email: "stranger@yahoo.com", kind: "event", answers: ev("Stranger event", BLS) });
  assert.ok(r.ok); assert.match(r.message, /If stranger@yahoo\.com belongs to a point person/);
  assert.equal(mail.filter((x) => x.to === "stranger@yahoo.com").length, 0);
  const held = review().slice(-1)[0];
  assert.equal(held.email, ""); assert.equal(JSON.parse(held.payload).email, "", "never applied automatically for that address");
  assert.match(held.reason, /typed email \(not confirmed\): stranger@yahoo\.com/);
  assert.ok(!ctx.readAll_().events.some((e) => e.name === "Stranger event"));
  // at most 3 links per address per 15 minutes; a bad address is refused
  assert.ok(post({ action: "emailLink", email: "stranger@yahoo.com" }).ok);
  assert.ok(post({ action: "emailLink", email: "stranger@yahoo.com" }).ok);
  assert.match(post({ action: "emailLink", email: "stranger@yahoo.com" }).error, /already sent/);
  assert.match(post({ action: "emailLink", email: "not-an-email" }).error, /valid email/);
  assert.equal(post({ action: "emailLink", email: "x@example.org", kind: "event", answers: "junk" }).ok, false);

  // the sender (MAIL_FROM): a verified "Send mail as" address of the deploying account, else replies go to it
  const gmail = [];
  ctx.GmailApp = { getAliases: () => ["Team@Example.org"], sendEmail: (to, subject, body, opts) => gmail.push({ to, opts }) };
  props.MAIL_FROM = "team@example.org"; props.MAIL_NAME = "MA Climate Map team";
  ctx.sendMail_("x@example.org", "s", "b");
  assert.equal(gmail[0].opts.from, "team@example.org"); assert.equal(gmail[0].opts.name, "MA Climate Map team"); assert.equal(gmail[0].opts.replyTo, "team@example.org");
  mail.length = 0; props.MAIL_FROM = "not-an-alias@example.org";
  ctx.sendMail_("x@example.org", "s", "b");
  assert.equal(gmail.length, 1); assert.equal(mail[0].opts.replyTo, "not-an-alias@example.org"); assert.ok(!mail[0].opts.from);
  delete props.MAIL_FROM; delete props.MAIL_NAME; delete ctx.GmailApp;
  console.log("sign-in OK");
}
