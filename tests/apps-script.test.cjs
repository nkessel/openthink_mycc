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
    getRange: (r, c, nr = 1, nc = 1) => ({
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
      },
      setNumberFormats: () => {}, setNumberFormat: () => {}, setBackground: () => {}, insertCheckboxes: () => {},
      getColumn: () => c, getRow: () => r, getNumColumns: () => nc,
      getSheet: () => sheet(name),
    }),
  };
}
const ssObj = { getSheetByName: sheet, getUrl: () => "https://sheet", toast: () => {} };
const props = {};
const mail = [];
const ctx = {
  console, Math, Date, JSON, String, Number, Array, Object, RegExp, isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: () => ssObj, openById: () => ssObj, getActive: () => ssObj },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => (props[k] = v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => "America/New_York", getActiveUser: () => ({ getEmail: () => "" }) },
  MailApp: { sendEmail: (to, subject, body) => mail.push({ to, subject, body }) },
  Maps: { newGeocoder: () => ({ setRegion() { return this; }, geocode: (q) => ({ status: "OK", results: [{ geometry: { location: /Natick/.test(q) ? { lat: 42.2834, lng: -71.3495 } : { lat: 42.36, lng: -71.06 } } }] }) }) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script/Code.gs"), "utf8"), ctx);
const G = (name) => vm.runInContext(name, ctx);
const Q = G("Q"), COLS = G("COLS");
const orig = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data.json"), "utf8"));

// ---- seed the fake workbook the same way setUp() does
const seeded = ctx.sheetRowsFromData_(orig);
for (const k of Object.keys(COLS)) book[k] = [COLS[k].slice()].concat(J(seeded[k] || []));
book["Editors"].push(
  ["nathandkessel@gmail.com", "admin", "", "", "", ""],
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
submit("fo", "nathandkessel@gmail.com", {
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
const adminMail = mail.filter((m) => /ab130@wellesley\.edu/.test(m.to));
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
ctx.onReviewEdit({ range: sheet("Needs Review").getRange(reviewRow, approveCol), user: { getEmail: () => "ab130@wellesley.edu" } });
d = data();
const natick = d.organizations.find((o) => o.id === "natick_climate_circle");
assert.ok(natick && Math.abs(natick.lat - 42.2834) < 1e-6, "geocoded HQ");
assert.equal(natick.profile.geo_precision, "exact");
assert.ok(book["Editors"].some((r) => r[0] === "new@natick.org" && r[2] === "natick_climate_circle"));
assert.equal(review().at(-1).status, "approved");
assert.match(log().at(-1).flag, /approved by ab130@wellesley.edu/);

// non-admin can't approve
submit("fo", "x@y.org", { [Q.whichOrg]: NEW_ORG, [Q.orgName]: "Sneaky Org" });
const r2 = book["Needs Review"].length;
book["Needs Review"][r2 - 1][approveCol - 1] = true;
ctx.onReviewEdit({ range: sheet("Needs Review").getRange(r2, approveCol), user: { getEmail: () => "point@bls.org" } });
assert.ok(!data().organizations.find((o) => o.name === "Sneaky Org"));

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
submit("fp", "turibius@bu.edu", { [Q.whichProject]: "Annual Advocacy Day preparation [mycc_p_advocacy_day]", [Q.remove]: [G("REMOVE_YES")] });
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
const submissions = 20;
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
  submit("fo", "rae@bls.org", { [Q.whichOrg]: BLS, [Q.orgDesc]: "Edited by the new point person" });
  assert.equal(data().organizations.find((o) => o.id === "boston_latin_school_youthcan").description, "Edited by the new point person");
}

// after an org renames itself, the new plain name picks the same row
submit("fo", "nathandkessel@gmail.com", { [Q.whichOrg]: "Andover Climate Lobby", [Q.orgName]: "Andover Climate Lobby Group" });
submit("fo", "nathandkessel@gmail.com", { [Q.whichOrg]: "Andover Climate Lobby Group", [Q.orgDesc]: "Renamed and still found" });
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
  submit("fo", "nathandkessel@gmail.com", {
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
  submit("fe", "nathandkessel@gmail.com", { [Q.whichEvent]: NEW_EVENT, [Q.hostOrg]: "Imaginary Climate Club", [Q.eventName]: "Ghost event" });
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
  ctx.onReviewEdit({ range: sheet("Needs Review").getRange(idx + 1, approveCol), user: { getEmail: () => "ab130@wellesley.edu" } });
  assert.ok(!JSON.stringify(data()).includes("Ghost event"), "not applied while the org still matches nothing");
  const pc = COLS["Needs Review"].indexOf("payload");
  const payload = JSON.parse(book["Needs Review"][idx][pc]);
  payload.answers[Q.hostOrg] = "Boston Latin School YouthCAN";
  payload.answers[Q.hostOrg] = bls.name;
  book["Needs Review"][idx][pc] = JSON.stringify(payload);
  book["Needs Review"][idx][approveCol - 1] = true;
  ctx.onReviewEdit({ range: sheet("Needs Review").getRange(idx + 1, approveCol), user: { getEmail: () => "ab130@wellesley.edu" } });
  assert.ok(JSON.stringify(data()).includes("Ghost event"), "approved once the org is fixed");
  console.log("typed answers (orgs + topics + unmatched log) OK");
}

// 6) coalitions typed where an organization is asked: a coalition can host items and be edited on the org form;
//    and a held submission is applied once its sender is added on the Editors tab
{
  const coal = ctx.readAll_().coalitions[0];
  // host = a coalition (typed by its short name)
  submit("fp", "nathandkessel@gmail.com", { [Q.whichProject]: NEW_PROJECT, [Q.hostOrg]: coal.abbrev || coal.name, [Q.projectName]: "Coalition-hosted project" });
  let dd = data();
  assert.ok(dd.coalitions.find((c) => c.id === coal.id).projects.some((p) => p.name === "Coalition-hosted project"), "typed coalition becomes the project's owner");
  // org form used for a coalition: an admin's edit lands on the coalition's own row
  submit("fo", "nathandkessel@gmail.com", { [Q.whichOrg]: coal.abbrev || coal.name, [Q.orgDesc]: "Updated through the org form" });
  dd = data();
  assert.equal(dd.coalitions.find((c) => c.id === coal.id).description, "Updated through the org form", "coalition edited");
  // an unknown sender's project waits; adding them as an editor of that coalition applies it
  const n0 = review().length;
  submit("fp", "newcomer@example.org", { [Q.whichProject]: NEW_PROJECT, [Q.hostOrg]: coal.abbrev || coal.name, [Q.projectName]: "Held until editor added" });
  assert.equal(review().length, n0 + 1);
  assert.equal(review().at(-1).status, "waiting");
  ctx.appendObject_(sheet("Editors"), { email: "newcomer@example.org", role: "editor", coalition_ids: coal.id });
  ctx.onReviewEdit({ range: sheet("Editors").getRange(2, 1), user: { getEmail: () => "ab130@wellesley.edu" } });
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
  ctx.Utilities = { sleep: () => {} };
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
  assert.deepEqual(req.map((r) => r[0]).sort(), [Q.eventDate, Q.eventName, Q.freeFood, Q.helpWanted].sort(), "location and link stay optional");
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
  assert.equal(out[3][4], "Climate justice", "first seed listed");
  const t = { topics: out.map((r) => ({ name: r[0], aliases: r[1], notes: r[2] })), coalitions: [], orgs: [], events: [], projects: [] };
  assert.deepEqual(J(G("tagChoices_")(t, "wiki")), ["Climate change", "Climate justice", "Youth serving"]);
  assert.ok(J(G("tagChoices_")(t, "groups")).includes("Clean energy"), "group-based choices unchanged");
  const r = J(G("resolveTopics_")("global warming, heat pumps, District of Columbia, heat pumpp, basket weaving", t));
  assert.deepEqual(r.slugs, ["climate_change", "heat_pump", "washington_d_c", "heat_pump"]);
  assert.deepEqual(r.missed.map((m) => m.typed), ["basket weaving"]);
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
  assert.deepEqual(out.links, [{ from_org: "a", to_org: "b", frequency: "few_per_year" }], "reversed duplicate and existing pair skipped");
  assert.deepEqual(out.memberships, [{ org: "a", coalition: "mpf" }]);
  assert.equal(out.skipped.length, 1);
  console.log("reviewed connections import OK");
}
