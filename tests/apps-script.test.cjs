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
Object.assign(props, { FORM_ORG: "fo", FORM_EVENT: "fe", FORM_PROJECT: "fp", FORM_FEEDBACK: "ff" });
ctx.refreshDropdowns = () => {};
const submit = (fid, email, ans) =>
  ctx.handleSubmit({
    source: { getId: () => fid },
    response: {
      getRespondentEmail: () => email,
      getItemResponses: () => Object.entries(ans).map(([k, v]) => ({ getItem: () => ({ getTitle: () => k }), getResponse: () => v })),
    },
  });
const NEW_ORG = G("NEW_ORG"), NEW_EVENT = G("NEW_EVENT"), NEW_PROJECT = G("NEW_PROJECT");
const BLS = "Boston Latin School Youth Climate Action Network [boston_latin_school_youthcan]";
const MYCC = "Massachusetts Youth Climate Coalition (MYCC) [mycc]";
const log = () => book["Change Log"].slice(1).map((r) => Object.fromEntries(COLS["Change Log"].map((c, i) => [c, r[i]])));
const review = () => book["Needs Review"].slice(1).map((r) => Object.fromEntries(COLS["Needs Review"].map((c, i) => [c, r[i]])));
const data = () => ctx.buildDataFile_(ctx.readAll_(), "now");

// point-person edits their own org (+ connections)
submit("fo", "Point@BLS.org", {
  [Q.whichOrg]: BLS, [Q.orgDesc]: "New description", [Q.tags]: ["Clean energy", "Tree planting"], [Q.youth]: "Yes",
  [Q.logo]: "https://drive.google.com/file/d/abc123/view?usp=sharing",
  [Q.worksWith("Weekly")]: ["Belmont High School Climate Action Club [belmont_high_school_climate_club]"],
  [Q.worksWith("Yearly or less")]: ["Belmont High School Climate Action Club [belmont_high_school_climate_club]", "Andover Climate Lobby [andover_climate_lobby]"],
});
let d = data();
let org = d.organizations.find((o) => o.id === "boston_latin_school_youthcan");
assert.equal(org.description, "New description");
assert.deepEqual(J(org.topic_tags), ["clean_energy", "tree_planting"]);
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
assert.equal(mail.length, 1); assert.match(mail[0].to, /ab130@wellesley\.edu/);

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
  [Q.eventDate]: "2026-10-18", [Q.eventTime]: "15:00", [Q.location]: "Natick Common", [Q.online]: "No",
});
d = data();
const ev = d.organizations.find((o) => o.id === "natick_climate_circle").events[0];
assert.equal(ev.date, "2026-10-18T15:00:00"); assert.ok(Math.abs(ev.lat - 42.2834) < 1e-6); assert.ok(!ev.online);
assert.ok(!d.coalitions.find((c) => c.id === "mycc").events.find((e) => e.name === ev.name), "org-owned, not coalition");

// …but can't put an event under a coalition they don't manage without their org
submit("fe", "new@natick.org", { [Q.whichEvent]: NEW_EVENT, [Q.coalition]: MYCC, [Q.eventName]: "Not mine" });
assert.match(review().at(-1).reason, /^UNAUTHORIZED/);

// coalition lead edits a coalition event (time only) and adds an online project
submit("fe", "lead@mycc.org", { [Q.whichEvent]: "MYCC Steering Meeting — Jun 12, 2026 [mycc_e1]", [Q.eventTime]: "19:30" });
submit("fp", "lead@mycc.org", { [Q.whichProject]: NEW_PROJECT, [Q.coalition]: MYCC, [Q.projectName]: "Virtual Teach-in", [Q.location]: "Zoom", [Q.online]: "Yes" });
d = data();
const mycc = d.coalitions.find((c) => c.id === "mycc");
assert.equal(mycc.events.find((e) => e.id === "mycc_e1").date, "2026-06-12T19:30:00");
const vp = mycc.projects.find((p) => p.name === "Virtual Teach-in");
assert.ok(vp.online && vp.lat === undefined, "online project has no pin");

// admin removes a project
submit("fp", "turibius@bu.edu", { [Q.whichProject]: "Youth Summit 2026 [mycc_p2]", [Q.remove]: [G("REMOVE_YES")] });
assert.ok(!data().coalitions.find((c) => c.id === "mycc").projects.find((p) => p.id === "mycc_p2"));

// feedback: no sign-in needed, logged
submit("ff", "", { [Q.fbType]: "Idea or feature request", [Q.fbMessage]: "Add a calendar export" });
assert.equal(book["Feedback"].length, 2);
assert.equal(log().at(-1).record_type, "feedback");

// every submission is in the Change Log
const submissions = 15;
assert.equal(log().length, submissions, `expected one Change Log row per submission (+ approval), got ${log().length}`);
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
