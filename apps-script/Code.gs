/**
 * MA Climate Organization Map — forms + spreadsheet backend
 * ---------------------------------------
 * Paste this whole file into the MA Climate Organization Map data Google Sheet:
 *   Extensions → Apps Script → replace Code.gs → Save.
 * Then reload the sheet and run  MA Climate Organization Map → Set up sheet + forms  once.
 *
 * What it does
 *  - Loads the current map data from GitHub into the tabs (only if they're empty).
 *  - Builds four Google Forms linked to this sheet and shares them with the admins:
 *      1. Update your organization (incl. which orgs you work with, and how often)
 *      2. Add or edit an event
 *      3. Add or edit a project
 *      4. Send feedback
 *  - The three data forms require Google sign-in and record the verified email.
 *    A change is applied only if that email may edit that org/coalition (Editors tab);
 *    otherwise it waits in "Needs Review" and the admins get an email.
 *  - Every submission is recorded in Change Log (old → new values, who, and any flag).
 *  - Every question is optional except "which one is this about?", so point-people only
 *    fill in what's missing or changed. Blank answers never overwrite anything.
 *  - doGet() serves the public data as JSON for the website. It never includes
 *    Editors, Needs Review, Feedback, or Change Log.
 */

// ---------------------------------------------------------------- settings
/** Core team: can edit everything, approve reviews, and get alerts. */
var ADMIN_EMAILS = ['nathandkessel@gmail.com', 'ab130@wellesley.edu', 'turibius@bu.edu'];
/** Where the starting data comes from (the repo's public/data.json). */
var SEED_URL = 'https://raw.githubusercontent.com/nkessel/openthink_mycc/development_branch/public/data.json';
/** Where "Replace projects, events and actions from the repo" reads from (the repo's public/data.json). */
var ACTIVITY_URL = SEED_URL;
/** Email the admins when something needs review. */
var ALERT_ADMINS = true;

var TAB = {
  start: 'Start Here',
  coalitions: 'Coalitions',
  orgs: 'Organizations',
  connections: 'Connections',
  projects: 'Projects',
  events: 'Events',
  actions: 'Actions',
  editors: 'Editors',
  review: 'Needs Review',
  topics: 'Topics',
  unmatched: 'Unmatched Input',
  feedback: 'Feedback',
  log: 'Change Log',
};

var NEW_ORG = '➕ Add a new organization';
var NEW_EVENT = '➕ Add a new event';
var NEW_PROJECT = '➕ Add a new project';
var NEW_ACTION = '➕ Add a new action or volunteer opportunity';
var NONE = '— None —';
var REMOVE_YES = 'Yes, take it off the map';
var REMOTE_YES = "We're remote / have no public location — don't show a pin"; // older forms' checkbox
/** Typed into the HQ question instead of an address: no public location, no pin. */
var REMOTE_WORDS = /^\s*(remote|none|no public location|n\/?a)\s*\.?\s*$/i;
var ORG_HELP = {
  desc: 'Start with your mission statement, then what your organization does, who you serve, your current campaigns, and what you could use help with. Write as much as you like: the map shows all of it, the Topics page reads it to place your group under the topics you work on, and more detail helps it suggest organizations doing similar work.',
  hq: 'A street address or just a town. Places your pin on the geographic map. If you have no public location, type "remote" and no pin is shown.',
};

var OPTIONAL_NOTE =
  'Everything below is optional — only fill in what is new or needs changing. ' +
  'Blank answers keep the current info as it is.';
var PUBLIC_NOTE = 'Please only include information that is safe to share publicly.';
var SIGNIN_NOTE = "You'll be asked to sign in with Google so we can check you're a point-person for this organization.";

/** How often two orgs work together → edge strength on the map. */
var FREQUENCIES = [
  ['Weekly', 4, 'weekly'],
  ['Monthly', 3, 'monthly'],
  ['A few times a year', 2, 'few_per_year'],
  ['Yearly or less', 1, 'yearly'],
];

/** Question titles (the submit handler looks answers up by these). */
var Q = {
  // shared
  tags: 'Climate topic tags',
  publicContact: 'Public contact information',
  remove: 'Remove from the map?',
  link: 'Link (website, RSVP, or info page)',
  hostOrg: 'Organization',
  coalition: 'Coalition',
  location: 'Location',
  online: 'Is this online or remote?',
  freeFood: 'Is free food provided?',
  who: 'Who can come / take part?',
  helpWanted: 'Are you looking for help with this?',
  // org
  whichOrg: 'Which organization is this about?',
  orgName: 'Organization name',
  orgAbbrev: 'Short name or abbreviation',
  orgType: 'Type of organization',
  orgTown: 'Town or region you focus on',
  orgHq: 'Headquarters address or town (for the map pin)',
  orgRemote: 'No public location?',
  pointName: 'Point person — name',
  pointEmail: 'Point person — email',
  pointPhone: 'Point person — phone (optional)',
  orgDesc: 'Mission statement and description',
  orgDescOld: 'Short description', // title before Oct 2026; held submissions may still use it
  orgCoalitions: 'Coalitions you belong to',
  youth: 'Is your organization youth-serving?', // older forms; now the "Youth serving" topic tag
  membership: 'About how many active members do you have?',
  website: 'Website',
  logo: 'Logo image link',
  worksWithGrid: 'Organizations you work with',
  // older forms asked one checkbox question per frequency; still understood when read back
  worksWith: function (freq) { return 'Organizations you work with — ' + freq.toLowerCase(); },
  // event
  whichEvent: 'Which event is this about?',
  eventName: 'Event name',
  eventDesc: 'Event description',
  eventDate: 'Date',
  eventTime: 'Start time',
  eventEndTime: 'End time',
  eventRecurrence: 'Does it repeat? (leave blank for a one-time event)',
  rsvp: 'RSVP / sign-up link (only if people need to register)',
  moreTopics: 'More topics (type as many as you like, separated by commas)',
  worksWithText: 'Organizations you work with (one per line, how often is optional)',
  // project
  whichProject: 'Which project is this about?',
  projectName: 'Project name',
  projectDesc: 'Project description',
  projectStatus: 'Status',
  skills: 'Skills or help needed',
  // action / volunteer opportunity
  whichAction: 'Which action or volunteer opportunity is this about?',
  actionName: 'Action or opportunity name',
  actionDesc: 'What people can do',
  actionKind: 'Type',
  actionUrgency: 'Urgency',
  actionDeadline: 'Deadline (leave blank if none)',
  // feedback
  fbType: 'What kind of feedback?',
  fbArea: 'Which part of the map is it about?',
  fbMessage: 'Your feedback',
  fbName: 'Name',
  fbEmail: 'Email', // older feedback forms; new ones collect the signed-in email
  fbPhone: 'Phone (optional)',
  fbFollowUp: 'Is it OK for us to follow up with you?',
};

var ORG_TYPES = [
  ['Nonprofit — 501(c)(3)', '501c3'],
  ['Nonprofit — 501(c)(4)', '501c4'],
  ['Volunteer group', 'volunteer'],
  ['Youth organization', 'youth_org'],
  ['School club', 'school_club'],
  ['College / university group', 'university'],
  ['Faith community', 'faith_org'],
  ['Professional association', 'professional'],
  ['Union', 'union'],
  ['Media', 'media'],
  ['Government / regional body', 'regional_gov'],
  ['Other', 'other'], // older forms; new forms have a write-in "Other" instead
];
var MEMBERSHIP = ['Under 10', '10+', '25+', '50+', '100+'];
var ACTION_KINDS = [['Take action (sign, call, comment, show up)', 'task'], ['Volunteer role or opportunity', 'role']];
var URGENCIES = [['Low', 'low'], ['Medium', 'medium'], ['High', 'high']];
var STATUSES = [['Active', 'active'], ['Planning', 'planning'], ['Completed', 'completed']];
var BASE_TAGS = ['clean_energy', 'climate_policy', 'environmental_justice', 'grassroots',
  'green_buildings', 'health', 'housing', 'just_transition', 'school_clubs', 'youth_serving'];
var BASE_SKILLS = ['data entry', 'event logistics', 'facilitation', 'fundraising', 'graphic design',
  'legal', 'outreach', 'photography', 'public speaking', 'research', 'social media', 'spanish',
  'portuguese', 'translation', 'video editing', 'writing'];

/** Org profile fields from the MA Climate Organization Map (org.profile in data.json). Admin-only: no form edits them. */
var PROFILE_BOOL = ['youth_serving', 'school_club', 'hub', 'inactive', 'paid_staff'];
var PROFILE_NUM = ['ej_focus', 'grassroots', 'policy_expertise', 'in_building'];
var PROFILE_STR = ['membership_size', 'c3_tier', 'c4_tier', 'geo_precision'];
var PROFILE_COLS = PROFILE_BOOL.concat(PROFILE_NUM, PROFILE_STR);

var COLS = {
  'Coalitions': ['id', 'name', 'abbrev', 'description', 'focus_tags', 'geographic_scope', 'color', 'lat', 'lng', 'last_activity',
    'logo', 'website'],
  'Organizations': ['id', 'name', 'abbrev', 'type', 'geographic_focus', 'description', 'coalition_ids', 'topic_tags',
    'website', 'logo', 'public_contact', 'hq_address', 'remote', 'lat', 'lng', 'last_activity', 'hidden',
    'coalition_weights'].concat(PROFILE_COLS),
  'Connections': ['from_org', 'to_org', 'frequency', 'updated_at', 'reported_by'],
  'Projects': ['id', 'coalition_id', 'host_org_id', 'name', 'description', 'status', 'skills_needed', 'topic_tags', 'link',
    'public_contact', 'location', 'online', 'lat', 'lng', 'last_activity', 'hidden', 'needs_info', 'verified',
    'free_food', 'affiliated_only', 'help_wanted'],
  'Events': ['id', 'coalition_id', 'host_org_id', 'name', 'description', 'date', 'location', 'online', 'lat', 'lng',
    'topic_tags', 'link', 'public_contact', 'last_activity', 'hidden', 'end', 'recurrence', 'needs_info', 'verified', 'rsvp_link', 'free_food', 'affiliated_only'],
  'Actions': ['id', 'coalition_id', 'kind', 'name', 'urgency', 'skills_needed', 'deadline', 'hidden', 'host_org_id',
    'description', 'link', 'needs_info', 'verified'],
  'Editors': ['email', 'role', 'org_ids', 'coalition_ids', 'name', 'notes'],
  // The master topic list (any length). People type topics on the forms; typed text is matched against name + aliases.
  'Topics': ['name', 'aliases', 'notes', 'qid', 'seed'],
  // Typed organization or topic names that matched nothing. Add the right alias on Topics (or fix the org) and mark it resolved.
  'Unmatched Input': ['logged_at', 'email', 'form', 'what', 'field', 'typed', 'closest_match', 'status', 'resolution'],
  'Needs Review': ['submitted_at', 'email', 'form', 'record_type', 'record', 'reason', 'summary', 'approve', 'status',
    'reviewed_at', 'payload'],
  'Feedback': ['submitted_at', 'type', 'area', 'message', 'name', 'email', 'ok_to_follow_up', 'status', 'notes', 'phone'],
  'Change Log': ['timestamp', 'email', 'form', 'status', 'flag', 'record_type', 'record_id', 'record_name', 'changes'],
};

var START_TEXT = [
  ['MA Climate Organization Map data', ''],
  ['', ''],
  ['This spreadsheet is the source of truth for the MA Climate Organization Map. The forms write into it; the site reads from it.', ''],
  ['', ''],
  ['Tabs', ''],
  ['Coalitions / Organizations / Projects / Events / Actions', 'The map data. Safe to edit by hand. Lists are comma-separated ids or tags.'],
  ['Connections', 'Which orgs work with which, and how often (from the organization form).'],
  ['Editors', 'Who may edit what. One row per email: org_ids / coalition_ids they manage (comma-separated), or role "admin" for everything.'],
  ['Needs Review', 'Submissions from emails without access. Tick "approve" to apply one (admins only).'],
  ['Feedback', 'Everything sent through the feedback form. Use the status column (new / in progress / done).'],
  ['Change Log', 'Every submission: who sent it, what changed (old → new), and flags like UNAUTHORIZED.'],
  ['', ''],
  ['Rules', ''],
  ['id', 'Never change an existing id — other rows point to it. New rows get an id automatically from the forms.'],
  ['hidden', 'Put TRUE to take something off the map without deleting it (the forms\' "remove" option does this).'],
  ['Scores', 'ej_focus, grassroots, policy_expertise, in_building and coalition_weights are set by the core team; no form changes them.'],
  ['Private info', 'Editors, Needs Review, Feedback and Change Log hold emails. They are never published.'],
  ['', ''],
  ['Form links', ''],
];

// ---------------------------------------------------------------- menu
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MA Climate Organization Map')
    .addItem('Set up sheet + forms (run once)', 'setUp')
    .addItem('Replace projects, events and actions from the repo', 'replaceActivityFromRepo')
    .addItem('Refresh form dropdowns', 'refreshDropdowns')
    .addItem('Switch forms to typed answers (orgs + topics)', 'typeAnswersOnForms')
    .addItem('Show form + data links', 'showLinks')
    .addItem('Fill in missing details (logos, websites, descriptions) from GitHub', 'fillLogosFromGitHub')
    .addItem('Use Wikipedia-based topics on the forms (Turibius)', 'useWikiTopicsOnForms')
    .addItem('Go back to group-based topics on the forms', 'useGroupTopicsOnForms')
    .addItem('Add reviewed aliases from Unmatched Input (monthly topic review)', 'addReviewedAliases')
    .addItem('Add connections from the Organization Info Form (reviewed list on GitHub)', 'importReviewedConnections')
    .addItem('Update the forms (feedback areas, mission statement, next-step links)', 'updateForms')
    .addItem('Make key questions required (online?, free food, who can come, help wanted)', 'requireKeyQuestions')
    .addItem('Re-check event and project pins (wrong town or outside Massachusetts)', 'fixPinsOutsideMa')
    .addItem('Apply the source check (hide events, projects and actions with no page that names them)', 'applySourceCheck')
    .addItem('Link the social justice spreadsheet', 'linkSocialJusticeSheet')
    .addToUi();
}

// ---------------------------------------------------------------- social justice spreadsheet
/**
 * The social justice groups (Palestinian rights, immigrant rights, …) are kept out of this sheet so it stays about
 * climate (Oct 23 meeting). They live in their own spreadsheet, shared only with the people who manage them, with
 * the same tabs and columns as this one (Coalitions = one row per sector, Organizations, Events, Projects,
 * Actions, Connections). The web app serves it at ?feed=social-justice; the map only asks for it when someone
 * switches a social justice layer on, so it adds nothing to the main map's loading.
 */
var SJ_PROP = 'SJ_SHEET_ID';
function linkSocialJusticeSheet() {
  var ui = SpreadsheetApp.getUi();
  var cur = PropertiesService.getScriptProperties().getProperty(SJ_PROP);
  var res = ui.prompt('Social justice spreadsheet', 'Paste the social justice spreadsheet\'s link (or its ID).' +
    (cur ? '\n\nNow linked: https://docs.google.com/spreadsheets/d/' + cur : ''), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var id = sheetIdFrom_(res.getResponseText());
  if (!id) { ui.alert('That doesn\'t look like a Google Sheets link.'); return; }
  var t = readAllFrom_(SpreadsheetApp.openById(id)); // fails here (not later, on the map) if this account can't open it
  PropertiesService.getScriptProperties().setProperty(SJ_PROP, id);
  logChange_('', 'Menu', 'applied', '', 'social justice', id, 'Social justice spreadsheet linked', t.coalitions.length + ' sectors, ' + t.orgs.length + ' groups');
  ui.alert('Linked: ' + t.coalitions.length + ' sectors and ' + t.orgs.length + ' groups. The map reads it the next time someone switches a social justice layer on.');
}
/** Pure: a spreadsheet link or bare ID → the ID ('' when it isn't one). */
function sheetIdFrom_(text) {
  var s = String(text || '').trim();
  var m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(s) ? s : '';
}
function socialJusticeData_() {
  var id = PropertiesService.getScriptProperties().getProperty(SJ_PROP);
  if (!id) return { generated_at: nowIso_(), coalitions: [], organizations: [], edges: [], org_links: [], unlinked: true };
  return buildDataFile_(readAllFrom_(SpreadsheetApp.openById(id)), nowIso_());
}

var SOURCE_CHECK_URL = 'https://raw.githubusercontent.com/nkessel/openthink_mycc/development_branch/src/source-check.json';

/**
 * Only verified items on the map (Oct 18): on the Events, Projects and Actions tabs, applies the corrected links,
 * dates and names from src/source-check.json (research/verification/*.csv), then hides every item whose page is
 * gone, never named it, or exists only in an email, and every item with no web link. Hidden rows stay in the
 * sheet; each change is in Change Log.
 */
function applySourceCheck() {
  var check = JSON.parse(UrlFetchApp.fetch(SOURCE_CHECK_URL).getContentText());
  var coalitionIds = {};
  readTable_(ss_().getSheetByName(TAB.coalitions)).rows.forEach(function (r) { coalitionIds[str_(r.id)] = true; });
  var adds = sourceCheckAdds_(check, coalitionIds);
  var n = 0;
  // group fields the check corrected (e.g. a website)
  [[TAB.coalitions, 'coalition'], [TAB.orgs, 'org']].forEach(function (t) {
    var sheet = ss_().getSheetByName(t[0]);
    if (!sheet) return;
    var table = readTable_(sheet);
    table.rows.forEach(function (r) {
      var want = (check.groups || {})[str_(r.id)];
      if (!want) return;
      var updates = {};
      Object.keys(want).forEach(function (k) { if (str_(r[k]) !== want[k]) updates[k] = want[k]; });
      if (!Object.keys(updates).length) return;
      writeFields_(sheet, table.headers, r._row, updates);
      logChange_('', 'Menu', 'updated', '', t[1], str_(r.id), str_(r.name), Object.keys(updates).map(function (k) { return k + ': ' + (str_(r[k]) || '∅') + ' → ' + updates[k]; }).join('\n'));
      n++;
    });
  });
  [[TAB.events, 'event', 'events'], [TAB.projects, 'project', 'projects'], [TAB.actions, 'action', 'actions']].forEach(function (t) {
    var sheet = ss_().getSheetByName(t[0]);
    if (!sheet) return;
    addMissingColumns_(sheet, COLS[t[0]]);
    var table = readTable_(sheet);
    eventCheckUpdates_(table.rows, check).forEach(function (u) {
      writeFields_(sheet, table.headers, u.row._row, u.updates);
      logChange_('', 'Menu', u.updates.hidden ? 'removed' : 'updated', '', t[1], str_(u.row.id), str_(u.row.name), u.why);
      n++;
    });
    var have = {};
    table.rows.forEach(function (r) { have[str_(r.id)] = true; });
    adds[t[2]].forEach(function (row) {
      if (have[row.id]) return;
      appendObject_(sheet, row);
      logChange_('', 'Menu', 'added', '', t[1], row.id, row.name, 'added from the source check: ' + row.link);
      n++;
    });
  });
  ss_().toast(n ? 'Changed ' + n + ' item(s). See Change Log.' : 'Everything already passes the check.');
}

/**
 * Sheet rows for the checked items the source check adds ({events, projects, actions}); their values also go into
 * check.fix, so a row the sheet already has with that id takes the checked wording and link.
 */
function sourceCheckAdds_(check, coalitionIds) {
  var out = { events: [], projects: [], actions: [] };
  check.fix = check.fix || {};
  var cell = function (v) { return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : v === true ? 'TRUE' : v === false ? 'FALSE' : String(v); };
  Object.keys(check.add || {}).forEach(function (gid) {
    Object.keys(out).forEach(function (kind) {
      ((check.add[gid] || {})[kind] || []).forEach(function (item) {
        var row = {};
        Object.keys(item).forEach(function (k) { row[k] = cell(item[k]); });
        if (coalitionIds[gid]) row.coalition_id = gid; else row.host_org_id = gid;
        out[kind].push(row);
        var fix = {};
        Object.keys(row).forEach(function (k) { if (k !== 'id') fix[k] = row[k]; });
        check.fix[item.id] = Object.assign(fix, check.fix[item.id] || {});
      });
    });
  });
  return out;
}

/** The changes the source check makes to one tab's rows: [{row, updates, why}] (fixes first, then hiding). */
function eventCheckUpdates_(rows, check) {
  var remove = {};
  (check.remove || []).forEach(function (id) { remove[id] = true; });
  var page = function (u) { return /^https?:\/\/\S+\.\S+/.test(str_(u)); };
  var out = [];
  rows.forEach(function (r) {
    var id = str_(r.id);
    if (!id || isTrue_(r.hidden)) return;
    if (remove[id]) return out.push({ row: r, updates: { hidden: 'TRUE' }, why: 'hidden: its page is gone, does not name it, or it is only in an email (source check, ' + check.checked + ')' });
    var fix = (check.fix || {})[id] || {};
    var updates = {};
    Object.keys(fix).forEach(function (k) { if (str_(r[k]) !== fix[k]) updates[k] = fix[k]; });
    var link = 'link' in updates ? updates.link : r.link;
    if (!page(link) && !page(r.rsvp_link)) return out.push({ row: r, updates: { hidden: 'TRUE' }, why: 'hidden: no web page for it' });
    if (Object.keys(updates).length) out.push({ row: r, updates: updates, why: Object.keys(updates).map(function (k) { return k + ': ' + (str_(r[k]) || '∅') + ' → ' + updates[k]; }).join('\n') });
  });
  return out;
}

/**
 * Finds in-person events and projects whose pin is missing, outside Massachusetts, or (for a location with no town)
 * far from where the host's town puts it, and geocodes them again
 * (room words dropped, host's town added). Each fix is recorded in Change Log.
 */
function fixPinsOutsideMa() {
  var t = readAll_();
  var fixed = fixPins_(t, geocode_);
  var ss = ss_();
  fixed.forEach(function (f) {
    var sheet = ss.getSheetByName(f.tab);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    sheet.getRange(f.row, headers.indexOf('lat') + 1).setValue(f.lat);
    sheet.getRange(f.row, headers.indexOf('lng') + 1).setValue(f.lng);
    logChange_('', 'Menu', 'applied', '', f.type, f.id, f.name, 'pin moved to ' + f.lat + ', ' + f.lng + ' (re-checked with the host org town)');
  });
  ss.toast(fixed.length ? 'Moved ' + fixed.length + ' pin(s). See Change Log.' : 'No pins needed fixing.');
}

// ---------------------------------------------------------------- topic lists on the forms
var WIKI_TOPICS_URL = 'https://raw.githubusercontent.com/nkessel/openthink_mycc/development_branch/research/topics/wiki/topics-merged.csv';
var WIKI_MIN_LIFT = 8; // same cutoff as the map's Topics page (public/topics-wiki.json)
var ALIAS_CELL_MAX = 45000; // a sheet cell holds 50,000 characters

/**
 * Pure: rows of topics-merged.csv (header hop_distance,topic,aliases,qid,seeds,lift_lcb_max) → Topics tab rows
 * [name, aliases, notes, qid, seed]: the seed topics plus every topic at or above the lift cutoff. Seeds first.
 */
function wikiTopicRows_(rows, minLift) {
  var head = rows[0].map(function (h) { return String(h).trim(); });
  var col = function (n) { return head.indexOf(n); };
  var H = col('hop_distance'), T = col('topic'), A = col('aliases'), Qd = col('qid'), S = col('seeds'), L = col('lift_lcb_max');
  var body = rows.slice(1).filter(function (r) { return r[T]; });
  var seedName = {};
  body.forEach(function (r) { if (String(r[H]) === '0') seedName[r[Qd]] = r[T]; });
  return body
    .filter(function (r) { return String(r[H]) === '0' || Number(r[L]) >= minLift; })
    .sort(function (a, b) { return (String(a[H]) === '0' ? 0 : 1) - (String(b[H]) === '0' ? 0 : 1); })
    .map(function (r) {
      // A topic sits under every seed it was reached from (Turibius, Oct 19: it shows one issue reaching others).
      var seeds = String(r[H]) === '0' ? [r[Qd]] : String(r[S]).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var names = seeds.map(function (q) { return seedName[q] || q; });
      var al = String(r[A] || '');
      if (al.length > ALIAS_CELL_MAX) al = al.slice(0, al.lastIndexOf(' | ', ALIAS_CELL_MAX));
      var note = String(r[H]) === '0' ? 'Seed topic' : 'Under ' + names.join(', ');
      return [r[T], al, note + ' · Wikidata ' + r[Qd], r[Qd], names.join(' | ')];
    });
}

/** The form's topic checkboxes: the seed topics (Wikipedia-based) or every tag in use (group-based). */
function tagChoices_(t, mode) {
  if (mode === 'wiki') {
    var seeds = (t.topics || []).filter(function (r) { return /^Seed topic/.test(str_(r.notes)); }).map(function (r) { return str_(r.name); });
    // "Youth serving" stays: it also sets an organization's youth_serving flag.
    if (seeds.length) return seeds.concat(['Youth serving']);
  }
  return uniq_(BASE_TAGS.concat(
    flat_(t.coalitions.map(function (c) { return list_(c.focus_tags); })),
    flat_(t.orgs.map(function (r) { return list_(r.topic_tags); })),
    flat_(t.events.map(function (r) { return list_(r.topic_tags); })),
    flat_(t.projects.map(function (r) { return list_(r.topic_tags); }))
  )).sort().map(humanize_);
}

/**
 * Menu: Turibius's Wikipedia-based topics on the forms. Fills the Topics tab with his list (seeds + topics at
 * lift ≥ 8, with aliases), makes the 13 seed topics the forms' checkboxes, and matches the "More topics" box
 * against all of them (names and aliases). Anything typed that matches nothing goes to Unmatched Input as before.
 */
function useWikiTopicsOnForms() {
  var csv = UrlFetchApp.fetch(WIKI_TOPICS_URL).getContentText();
  var rows = wikiTopicRows_(Utilities.parseCsv(csv), WIKI_MIN_LIFT);
  var sh = ss_().getSheetByName(TAB.topics) || ss_().insertSheet(TAB.topics);
  sh.clearContents();
  var cols = COLS[TAB.topics];
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  sh.getRange(2, 1, rows.length, cols.length).setNumberFormat('@').setValues(rows);
  PropertiesService.getScriptProperties().setProperty('TOPIC_CHOICES', 'wiki');
  refreshDropdowns();
  logChange_('', 'Menu', 'applied', '', 'topics', '', 'Wikipedia-based topics', rows.length + ' topics on the Topics tab; seed topics are the form checkboxes');
  ss_().toast('Topics tab: ' + rows.length + ' Wikipedia-based topics. Form checkboxes are now the seed topics.');
}

/** Menu: back to the group-based topic checkboxes (the Topics tab is refilled from the tags in use). */
function useGroupTopicsOnForms() {
  PropertiesService.getScriptProperties().setProperty('TOPIC_CHOICES', 'groups');
  var sh = ss_().getSheetByName(TAB.topics);
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  seedTopics_();
  refreshDropdowns();
  ss_().toast('Forms are back on the group-based topics.');
}

// ---------------------------------------------------------------- reviewed connections (e.g. Aissata's Organization Info Form)
var CONNECTIONS_URL = 'https://raw.githubusercontent.com/nkessel/openthink_mycc/development_branch/research/connections/org-info-form-2026-10.csv';

/**
 * Pure: rows of a reviewed connections CSV (from_org,to_org,frequency,kind,said) → what to add.
 * kind "org": a Connections row unless that pair is already there (either direction).
 * kind "coalition": the coalition id added to the org's coalition_ids if missing.
 */
function connectionsToAdd_(rows, t) {
  var head = rows[0].map(function (h) { return String(h).trim(); });
  var c = function (n) { return head.indexOf(n); };
  var orgIds = {}; t.orgs.forEach(function (o) { orgIds[str_(o.id)] = o; });
  var coIds = {}; t.coalitions.forEach(function (x) { coIds[str_(x.id)] = true; });
  var have = {};
  (t.connections || []).forEach(function (r) { var a = str_(r.from_org), b = str_(r.to_org); have[a < b ? a + '|' + b : b + '|' + a] = true; });
  var out = { links: [], memberships: [], skipped: [] };
  rows.slice(1).forEach(function (r) {
    var a = str_(r[c('from_org')]), b = str_(r[c('to_org')]), kind = str_(r[c('kind')]) || 'org';
    if (!a || !b) return;
    if (kind === 'coalition') {
      if (!orgIds[a] || !coIds[b]) { out.skipped.push(a + ' → ' + b + ' (not found)'); return; }
      if (list_(orgIds[a].coalition_ids).indexOf(b) === -1) out.memberships.push({ org: a, coalition: b });
      return;
    }
    if (!orgIds[a] || !orgIds[b]) { out.skipped.push(a + ' → ' + b + ' (not found)'); return; }
    var key = a < b ? a + '|' + b : b + '|' + a;
    if (have[key]) return;
    have[key] = true;
    var f = str_(r[c('frequency')]) || 'few_per_year';
    out.links.push({ from_org: a, to_org: b, frequency: freqWeight_(f) ? f : 'few_per_year' });
  });
  return out;
}

/** Menu: add the reviewed connections from GitHub to the Connections tab (and any coalition memberships). Safe to run again. */
function importReviewedConnections() {
  var rows = Utilities.parseCsv(UrlFetchApp.fetch(CONNECTIONS_URL).getContentText());
  var t = readAll_();
  var add = connectionsToAdd_(rows, t);
  var ss = ss_();
  var sheet = ss.getSheetByName(TAB.connections);
  var now = nowIso_();
  add.links.forEach(function (l) {
    appendObject_(sheet, { from_org: l.from_org, to_org: l.to_org, frequency: l.frequency, updated_at: now, reported_by: 'Organization Info Form' });
  });
  if (add.memberships.length) {
    var orgSheet = ss.getSheetByName(TAB.orgs);
    var headers = orgSheet.getRange(1, 1, 1, orgSheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = headers.indexOf('coalition_ids') + 1;
    add.memberships.forEach(function (m) {
      var o = findById_(t.orgs, m.org);
      orgSheet.getRange(o._row, col).setValue(list_(o.coalition_ids).concat([m.coalition]).join(', '));
    });
  }
  logChange_('', 'Menu', 'applied', '', 'connections', '', 'Organization Info Form',
    add.links.length + ' connection(s) added; ' + add.memberships.length + ' coalition membership(s) added' + (add.skipped.length ? '; skipped: ' + add.skipped.join(', ') : ''));
  ss.toast(add.links.length + ' connection(s) and ' + add.memberships.length + ' coalition membership(s) added. See Change Log.');
}

/** Menu: bring the existing forms up to date without rebuilding them (safe to run again). */
function updateForms() {
  var props = PropertiesService.getScriptProperties();
  var run = function (key, fn) { var id = props.getProperty(key); if (id && formExists_(id)) fn(FormApp.openById(id)); };
  // forms keep their titles in step with the map's name (MA Climate Organization Map, 10/15 meeting)
  var titles = { FORM_ORG: 'Update your organization', FORM_EVENT: 'Add or edit an event', FORM_PROJECT: 'Add or edit a project',
    FORM_ACTION: 'Add or edit an action or volunteer opportunity', FORM_FEEDBACK: 'Send feedback' };
  Object.keys(titles).forEach(function (k) { run(k, function (f) { var t = 'MA Climate Organization Map — ' + titles[k]; if (f.getTitle() !== t) f.setTitle(t); }); });
  run('FORM_ORG', upgradeOrgForm_);
  run('FORM_FEEDBACK', upgradeFeedbackForm_);
  run('FORM_EVENT', upgradeEventForm_);
  run('FORM_PROJECT', upgradeProjectForm_);
  orgNextSteps_();
  ss_().toast('Forms updated.');
}

/** The questions each form should require, so filters like "Free food only" have answers to work with. */
var REQUIRED_KEYS = {
  FORM_EVENT: ['eventName', 'eventDate', 'online', 'freeFood', 'who', 'link'], // every event needs a public page (Oct 18)
  FORM_PROJECT: ['projectName', 'online', 'freeFood', 'who', 'helpWanted'],
};

/**
 * Menu: mark the key questions required on the event and project forms. Edit links are pre-filled with the
 * current answers, so point-people only have to answer the ones still blank. Location can't be required
 * (online events have none); an in-person event saved without one keeps its "needs info" note instead.
 */
function requireKeyQuestions() {
  var props = PropertiesService.getScriptProperties();
  var done = [];
  Object.keys(REQUIRED_KEYS).forEach(function (prop) {
    var id = props.getProperty(prop);
    if (!id) return;
    var form = FormApp.openById(id);
    var titles = REQUIRED_KEYS[prop].map(function (k) { return Q[k]; });
    form.getItems().forEach(function (it) {
      if (titles.indexOf(it.getTitle()) === -1) return;
      var typed = asTypedItem_(it);
      if (typed && typed.setRequired) { typed.setRequired(true); done.push(it.getTitle()); }
    });
  });
  ss_().toast(done.length ? 'Required now: ' + uniq_(done).join('; ') : 'No matching questions found.');
}

/** A form item as its own type (only typed items have setRequired). */
function asTypedItem_(it) {
  var T = FormApp.ItemType;
  switch (it.getType()) {
    case T.TEXT: return it.asTextItem();
    case T.PARAGRAPH_TEXT: return it.asParagraphTextItem();
    case T.MULTIPLE_CHOICE: return it.asMultipleChoiceItem();
    case T.CHECKBOX: return it.asCheckboxItem();
    case T.LIST: return it.asListItem();
    case T.DATE: return it.asDateItem();
    case T.TIME: return it.asTimeItem();
    default: return null;
  }
}

/** Pure: which rows need a new pin, and where. `geo(place, hint)` returns [lat, lng] or null. */
function fixPins_(t, geo) {
  var out = [];
  [['events', TAB.events, 'event'], ['projects', TAB.projects, 'project']].forEach(function (k) {
    (t[k[0]] || []).forEach(function (r) {
      if (!r.id || isTrue_(r.online) || !str_(r.location)) return;
      var lat = Number(r.lat), lng = Number(r.lng);
      var hint = placeHint_({}, r, t);
      var place = cleanPlace_(r.location);
      var townless = hint && !/,/.test(place) && !/\b\d{5}\b/.test(place);
      var bad = !(str_(r.lat) && str_(r.lng) && inMass_(lat, lng));
      if (!bad && !townless) return;
      var ll = geo(str_(r.location), hint);
      // A town-less location (e.g. "George Sherman Hall, 2nd floor") is moved only if the host's town puts it
      // somewhere clearly different (about 2 km or more).
      if (ll && (bad || Math.abs(ll[0] - lat) + Math.abs(ll[1] - lng) > 0.02)) out.push({ tab: k[1], type: k[2], row: r._row, id: r.id, name: str_(r.name), lat: ll[0], lng: ll[1] });
    });
  });
  return out;
}

/**
 * Copies logo paths and websites from the repo's data.json into Organizations rows where those
 * cells are empty (never overwrites). Logos themselves are files on the website (public/logos/),
 * found by scripts/fetch-logos.mjs. Each filled row is recorded in Change Log.
 */
function fillLogosFromGitHub() {
  var data = JSON.parse(UrlFetchApp.fetch(SEED_URL).getContentText());
  var result = fillLogos_(data);
  var msg = 'Filled ' + result.logos + ' logo(s), ' + result.websites + ' website(s), ' + (result.rsvp || 0) + ' RSVP link(s) and ' + (result.details || 0) + ' other detail(s) (descriptions, types, focus, event pages) from GitHub. Only empty cells (and general events-page links) were filled.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor */ }
  return msg;
}

/** Same as below, for the Coalitions tab (adds its logo/website columns if they're missing). */
function fillCoalitionLogos_(data, counts) {
  var sheet = ss_().getSheetByName(TAB.coalitions);
  if (!sheet) return;
  addMissingColumns_(sheet, COLS[TAB.coalitions]);
  var table = readTable_(sheet);
  var byId = {};
  (data.coalitions || []).forEach(function (c) { byId[c.id] = c; });
  table.rows.forEach(function (r) {
    var src = byId[str_(r.id)];
    if (!src) return;
    var updates = {};
    if (!str_(r.logo) && src.logo) { updates.logo = src.logo; counts.logos++; }
    if (!str_(r.website) && src.website) { updates.website = src.website; counts.websites++; }
    if (!str_(r.description) && src.description) { updates.description = src.description; counts.details = (counts.details || 0) + 1; }
    if (!Object.keys(updates).length) return;
    writeFields_(sheet, table.headers, r._row, updates);
    logChange_('', 'Fill from GitHub', 'updated', '', 'coalition', str_(r.id), str_(r.name),
      Object.keys(updates).map(function (k) { return k + ': ∅ → ' + updates[k]; }).join('\n'));
  });
}

/**
 * Events: fill a blank RSVP link from the repo, and swap a link that only points to a general events page
 * (the repo's link starts with it and goes further) for the event's own page. Never overwrites anything else.
 */
/** True when `general` is a site's events listing (…/events, /calendar, /upcoming-events…) on the same site as `specific`. */
function isListingFor_(general, specific) {
  var host = function (u) { var m = /^https?:\/\/(?:www\.)?([^\/?#]+)/i.exec(u || ''); return m ? m[1].toLowerCase() : ''; };
  if (!host(general) || host(general) !== host(specific) || general === specific) return false;
  var path = String(general).replace(/^https?:\/\/[^\/]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  var last = path.split('/').pop();
  return path === '' || /^(events?|calendar|upcoming(-events)?|event-listings|whats-on|get-involved)$/i.test(last);
}

function fillEventLinks_(data, counts) {
  var sheet = ss_().getSheetByName(TAB.events);
  if (!sheet) return;
  addMissingColumns_(sheet, COLS[TAB.events]);
  var table = readTable_(sheet);
  var byId = {};
  (data.coalitions || []).concat(data.organizations || []).forEach(function (n) {
    (n.events || []).forEach(function (e) { byId[e.id] = e; });
  });
  table.rows.forEach(function (r) {
    var src = byId[str_(r.id)];
    if (!src) return;
    var updates = {};
    if (!str_(r.rsvp_link) && src.rsvp_link) { updates.rsvp_link = src.rsvp_link; counts.rsvp++; }
    var cur = str_(r.link);
    if (src.link && (!cur || (src.link.length > cur.length && src.link.indexOf(cur.replace(/\/+$/, '')) === 0) || isListingFor_(cur, src.link))) {
      if (src.link !== cur) { updates.link = src.link; counts.details++; }
    }
    if (!Object.keys(updates).length) return;
    writeFields_(sheet, table.headers, r._row, updates);
    logChange_('', 'Fill from GitHub', 'updated', '', 'event', str_(r.id), str_(r.name),
      Object.keys(updates).map(function (k) { return k + ': ' + (str_(r[k]) || '∅') + ' → ' + updates[k]; }).join('\n'));
  });
}

function fillLogos_(data) {
  var sheet = ss_().getSheetByName(TAB.orgs);
  var table = readTable_(sheet);
  var byId = {};
  data.organizations.forEach(function (o) { byId[o.id] = o; });
  var counts = { logos: 0, websites: 0, details: 0, rsvp: 0 };
  fillCoalitionLogos_(data, counts);
  fillEventLinks_(data, counts);
  table.rows.forEach(function (r) {
    var src = byId[str_(r.id)];
    if (!src) return;
    var updates = {};
    if (!str_(r.logo) && src.logo) { updates.logo = src.logo; counts.logos++; }
    if (!str_(r.website) && src.website) { updates.website = src.website; counts.websites++; }
    // Researched details (research/ma-gaps): only into empty cells, never over what people entered.
    if (!str_(r.description) && src.description) { updates.description = src.description; counts.details++; }
    if ((!str_(r.type) || str_(r.type) === 'unknown') && src.type && src.type !== 'unknown') { updates.type = src.type; counts.details++; }
    if (!str_(r.geographic_focus) && src.geographic_focus) { updates.geographic_focus = src.geographic_focus; counts.details++; }
    if (!Object.keys(updates).length) return;
    writeFields_(sheet, table.headers, r._row, updates);
    logChange_('', 'Fill from GitHub', 'updated', '', 'organization', str_(r.id), str_(r.name),
      Object.keys(updates).map(function (k) { return k + ': ∅ → ' + updates[k]; }).join('\n'));
  });
  return counts;
}

// ---------------------------------------------------------------- set up
/** One-time setup: create tabs, load the current map data, build + share the forms. */
function setUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  var loaded = seedSheet_(ss);
  ensureTrigger_('onReviewEdit', function () { ScriptApp.newTrigger('onReviewEdit').forSpreadsheet(ss).onEdit().create(); });
  buildForms(loaded);
}

function ensureTrigger_(handler, create) {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
  if (!exists) create();
}

/**
 * Replace the Projects, Events and Actions tabs with what is in the repo's data.json (new events/projects/actions
 * gathered from public pages). Anything people added through the forms in those tabs is overwritten, so this asks first.
 * Rows are written by header name, so column order in the sheet does not matter.
 */
function replaceActivityFromRepo() {
  var ui = SpreadsheetApp.getUi();
  var go = ui.alert('Replace Projects, Events and Actions?',
    'This overwrites those three tabs with the repo data (' + ACTIVITY_URL + '). Changes made through the forms in those tabs since the last export will be lost.',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) return;
  var counts = replaceActivity_(JSON.parse(UrlFetchApp.fetch(ACTIVITY_URL).getContentText()));
  refreshDropdowns();
  ui.alert('Done: ' + counts.join(', ') + '.');
}

function replaceActivity_(data) {
  var rows = sheetRowsFromData_(data);
  var ss = ss_();
  var counts = [];
  [TAB.projects, TAB.events, TAB.actions].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    addMissingColumns_(sh, COLS[name]);
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent();
    var data2 = rows[name].map(function (r) {
      return headers.map(function (h) { var i = COLS[name].indexOf(h); return i === -1 ? '' : r[i]; });
    });
    if (data2.length) {
      var range = sh.getRange(2, 1, data2.length, headers.length);
      range.setNumberFormats(data2.map(function (r) { return r.map(function (v) { return typeof v === 'number' ? '0.000000' : '@'; }); }));
      range.setValues(data2);
    }
    counts.push(data2.length + ' ' + name.toLowerCase());
  });
  return counts;
}

/** Columns added in later versions go at the end of an existing tab (nothing is moved). */
function addMissingColumns_(sh, cols) {
  var have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  cols.filter(function (c) { return have.indexOf(c) === -1; }).forEach(function (c) {
    var col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue(c).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937');
  });
}

function seedSheet_(ss) {
  var start = ss.getSheetByName(TAB.start);
  if (!start) {
    start = ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(TAB.start) : ss.insertSheet(TAB.start, 0);
    start.getRange(1, 1, START_TEXT.length, 2).setValues(START_TEXT);
    start.getRange('A1').setFontSize(16).setFontWeight('bold');
    ['Tabs', 'Rules', 'Form links'].forEach(function (t) { start.getRange(findRow_(start, t), 1).setFontWeight('bold'); });
    start.setColumnWidth(1, 380); start.setColumnWidth(2, 700);
  }
  var needsData = !ss.getSheetByName(TAB.orgs) || ss.getSheetByName(TAB.orgs).getLastRow() <= 1;
  var rows = needsData ? sheetRowsFromData_(JSON.parse(UrlFetchApp.fetch(SEED_URL).getContentText())) : {};
  if (!ss.getSheetByName(TAB.editors) || ss.getSheetByName(TAB.editors).getLastRow() <= 1) {
    rows[TAB.editors] = ADMIN_EMAILS.map(function (e) { return [e, 'admin', '', '', '', 'core team']; });
  }
  Object.keys(COLS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]])
        .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937');
      sh.setFrozenRows(1); sh.setFrozenColumns(1);
    } else {
      addMissingColumns_(sh, COLS[name]);
    }
    var data = rows[name];
    if (data && data.length && sh.getLastRow() <= 1) {
      var range = sh.getRange(2, 1, data.length, COLS[name].length);
      range.setNumberFormats(data.map(function (r) {
        return r.map(function (v) { return typeof v === 'number' ? '0.000000' : '@'; });
      }));
      range.setValues(data);
    }
    var desc = COLS[name].indexOf('description');
    if (desc !== -1) sh.setColumnWidth(desc + 1, 420);
  });
  seedTopics_();
  var review = ss.getSheetByName(TAB.review);
  review.getRange(2, COLS[TAB.review].indexOf('approve') + 1, 500, 1).insertCheckboxes();
  // Private tabs: only visible to people the sheet is shared with, but keep them out of the way.
  [TAB.log].forEach(function (n) { ss.getSheetByName(n).setTabColor('#f59e0b'); });
  ss.getSheetByName(TAB.review).setTabColor('#ef4444');
  return needsData;
}

/** Pure: DataFile (data.json) → { tabName: rows[][] } in COLS order. */
function sheetRowsFromData_(d) {
  var L = function (xs) { return (xs || []).join(', '); };
  var num6 = function (x) { return typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : ''; };
  var bool = function (x) { return x === undefined || x === null ? '' : x ? 'TRUE' : 'FALSE'; };
  var out = { Coalitions: [], Organizations: [], Connections: [], Projects: [], Events: [], Actions: [] };
  var push = function (tab, obj) {
    out[tab].push(COLS[tab].map(function (c) { var v = obj[c]; return v === undefined || v === null ? '' : v; }));
  };
  var project = function (p, coalitionId, hostId) {
    push('Projects', { id: p.id, coalition_id: coalitionId, host_org_id: hostId || p.host_org_id, name: p.name,
      description: p.description, status: p.status, skills_needed: L(p.skills_needed), topic_tags: L(p.topic_tags),
      link: p.link, public_contact: p.public_contact, location: p.location, online: bool(p.online),
      lat: num6(p.lat), lng: num6(p.lng), needs_info: p.needs_info ? 'TRUE' : '', verified: p.verified ? 'TRUE' : '',
      free_food: p.free_food ? 'TRUE' : '', affiliated_only: p.affiliated_only ? 'TRUE' : '', help_wanted: bool(p.help_wanted) });
  };
  var event = function (e, coalitionId, hostId) {
    push('Events', { id: e.id, coalition_id: coalitionId, host_org_id: hostId || e.host_org_id, name: e.name,
      description: e.description, date: e.date, end: e.end, location: e.location, online: bool(e.online),
      lat: num6(e.lat), lng: num6(e.lng), topic_tags: L(e.topic_tags), link: e.link, public_contact: e.public_contact,
      recurrence: e.recurrence, rsvp_link: e.rsvp_link, needs_info: e.needs_info ? 'TRUE' : '', verified: e.verified ? 'TRUE' : '',
      free_food: e.free_food ? 'TRUE' : '', affiliated_only: e.affiliated_only ? 'TRUE' : '' });
  };
  var action = function (a, coalitionId, hostId) {
    push('Actions', { id: a.id, coalition_id: coalitionId, host_org_id: hostId || a.host_org_id, kind: a.kind, name: a.name,
      urgency: a.urgency, skills_needed: L(a.skills_needed), deadline: a.deadline, description: a.description, link: a.link, needs_info: a.needs_info ? 'TRUE' : '', verified: a.verified ? 'TRUE' : '' });
  };
  d.coalitions.forEach(function (c) {
    push('Coalitions', { id: c.id, name: c.name, abbrev: c.abbrev, description: c.description, focus_tags: L(c.focus_tags),
      geographic_scope: c.geographic_scope, color: c.color, lat: c.lat, lng: c.lng, last_activity: c.last_activity,
      logo: c.logo, website: c.website });
    (c.projects || []).forEach(function (p) { project(p, c.id, ''); });
    (c.events || []).forEach(function (e) { event(e, c.id, ''); });
    (c.actions || []).forEach(function (a) { action(a, c.id, ''); });
  });
  d.organizations.forEach(function (o) {
    (o.projects || []).forEach(function (p) { project(p, '', o.id); });
    (o.events || []).forEach(function (e) { event(e, '', o.id); });
    (o.actions || []).forEach(function (a) { action(a, '', o.id); });
    var prof = o.profile || {};
    var row = { id: o.id, name: o.name, abbrev: o.abbrev, type: o.type, geographic_focus: o.geographic_focus,
      description: o.description, coalition_ids: L(o.coalition_ids), topic_tags: L(o.topic_tags), website: o.website,
      logo: o.logo, public_contact: o.public_contact, remote: bool(o.remote), lat: num6(o.lat), lng: num6(o.lng),
      last_activity: o.last_activity,
      coalition_weights: Object.keys(o.coalition_weights || {}).map(function (k) { return k + ':' + o.coalition_weights[k]; }).join(', ') };
    PROFILE_BOOL.forEach(function (k) { row[k] = bool(prof[k]); });
    PROFILE_NUM.forEach(function (k) { row[k] = prof[k] === undefined ? '' : prof[k]; });
    PROFILE_STR.forEach(function (k) { row[k] = prof[k]; });
    push('Organizations', row);
  });
  (d.org_links || []).forEach(function (l) {
    (l.reported_by && l.reported_by.length ? l.reported_by : [l.source]).forEach(function (from) {
      var to = from === l.source ? l.target : l.source;
      push('Connections', { from_org: from, to_org: to, frequency: l.frequency });
    });
  });
  return out;
}

// ---------------------------------------------------------------- build forms
function buildForms(dataLoaded) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  var built = [];

  var specs = [
    { key: 'FORM_ORG', title: 'MA Climate Organization Map — Update your organization', build: buildOrgForm_, tab: 'Responses: Organizations', signIn: true },
    { key: 'FORM_EVENT', title: 'MA Climate Organization Map — Add or edit an event', build: buildEventForm_, tab: 'Responses: Events', signIn: true },
    { key: 'FORM_PROJECT', title: 'MA Climate Organization Map — Add or edit a project', build: buildProjectForm_, tab: 'Responses: Projects', signIn: true },
    { key: 'FORM_ACTION', title: 'MA Climate Organization Map — Add or edit an action or volunteer opportunity', build: buildActionForm_, tab: 'Responses: Actions', signIn: true },
    { key: 'FORM_FEEDBACK', title: 'MA Climate Organization Map — Send feedback', build: buildFeedbackForm_, tab: 'Responses: Feedback', signIn: true },
  ];

  specs.forEach(function (s) {
    if (props.getProperty(s.key) && formExists_(props.getProperty(s.key))) {
      // Already built: just keep its title current (e.g. after a rename).
      var existing = FormApp.openById(props.getProperty(s.key));
      if (existing.getTitle() !== s.title) existing.setTitle(s.title);
      if (s.key === 'FORM_ORG') upgradeOrgForm_(existing);
      if (s.key === 'FORM_FEEDBACK') upgradeFeedbackForm_(existing);
      if (s.key === 'FORM_EVENT') upgradeEventForm_(existing);
      if (s.key === 'FORM_PROJECT') upgradeProjectForm_(existing);
      return;
    }
    var form = FormApp.create(s.title);
    if (s.signIn) collectVerifiedEmail_(form);
    s.build(form);
    publish_(form);
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    try { form.addEditors(ADMIN_EMAILS); } catch (e) { /* sharing can fail for some account types; share by hand */ }
    props.setProperty(s.key, form.getId());
    ScriptApp.newTrigger('handleSubmit').forForm(form).onFormSubmit().create();
    renameResponseSheet_(ss, form, s.tab);
    built.push(s.title);
  });

  refreshDropdowns();
  orgNextSteps_();
  writeLinks_();
  SpreadsheetApp.getUi().alert(
    (dataLoaded === true ? 'Loaded the current map data into the tabs.\n\n' : '') +
    (built.length
      ? 'Built and shared with the core team:\n• ' + built.join('\n• ') + '\n\nLinks are on the Start Here tab.'
      : 'All the forms already exist. Links are on the Start Here tab.')
  );
}

/** Require Google sign-in and record the verified email (newer API first, older fallback). */
function collectVerifiedEmail_(form) {
  /** @type {any} */ var f = form;
  /** @type {any} */ var app = FormApp;
  try {
    if (typeof f.setEmailCollectionType === 'function' && app.EmailCollectionType) {
      f.setEmailCollectionType(app.EmailCollectionType.VERIFIED);
      return;
    }
  } catch (e) { /* fall back */ }
  form.setCollectEmail(true);
}

/** Newer Forms start unpublished when made from a script; publish so people can respond. */
function publish_(form) {
  /** @type {any} */ var f = form;
  try { if (typeof f.setPublished === 'function') f.setPublished(true); } catch (e) { /* older API: already live */ }
  form.setAcceptingResponses(true);
}

/** FormApp.openById sometimes fails with a transient "Unexpected error" after many form edits; retry a few times. */
function openForm_(id) {
  for (var i = 0; ; i++) {
    try { return FormApp.openById(id); } catch (e) {
      if (i >= 3) throw e;
      Utilities.sleep(1500 * (i + 1));
    }
  }
}

function formExists_(id) {
  try { FormApp.openById(id); return true; } catch (e) { return false; }
}

function renameResponseSheet_(ss, form, name) {
  SpreadsheetApp.flush();
  var id = form.getId();
  var sheets = SpreadsheetApp.openById(ss.getId()).getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var url = sheets[i].getFormUrl();
    if (url && url.indexOf(id) !== -1) {
      if (!ss.getSheetByName(name)) sheets[i].setName(name);
      sheets[i].hideSheet(); // raw copies; the real data lives in the main tabs
      return;
    }
  }
}

/**
 * After the organization form, point people straight to the event, project and action forms (a Google Form can't
 * branch into another form, so the thank-you page links to them).
 */
function orgNextSteps_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FORM_ORG');
  if (!id) return;
  var url = function (k) { var f = props.getProperty(k); try { return f ? FormApp.openById(f).getPublishedUrl() : ''; } catch (e) { return ''; } };
  FormApp.openById(id).setConfirmationMessage(orgConfirmation_(url('FORM_PROJECT'), url('FORM_EVENT'), url('FORM_ACTION')));
}
/** Pure: the organization form's thank-you text with links to the other forms. */
function orgConfirmation_(projectUrl, eventUrl, actionUrl) {
  var lines = ['Thank you! If you are a point-person for this organization, your changes are on their way to the map. Otherwise the map team will review them.'];
  var next = [];
  if (projectUrl) next.push('• Add a project: ' + projectUrl);
  if (eventUrl) next.push('• Add an event: ' + eventUrl);
  if (actionUrl) next.push('• Add an action or volunteer opportunity: ' + actionUrl);
  if (next.length) lines.push('', 'Next, add what your organization is working on (pick your organization at the top of each form):', next.join('\n'));
  return lines.join('\n');
}

function header_(form, text) {
  form.setDescription(text);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Thank you! If you are a point-person for this organization, your changes are on their way to the map. Otherwise the map team will review them.');
}

function addTags_(form) {
  form.addCheckboxItem().setTitle(Q.tags)
    .setHelpText('Pick any that fit, or add your own under "Other". Answering replaces the current tags.')
    .setChoiceValues(BASE_TAGS.map(humanize_)).showOtherOption(true);
  addMoreTopics_(form);
}
/** Type any number of topics; each is matched against the master Topics list. Anything that doesn't match is saved for the team to review. */
function addMoreTopics_(form) {
  return form.addParagraphTextItem().setTitle(Q.moreTopics)
    .setHelpText('Start typing the topics you work on, separated by commas (e.g. "solar, tree planting, composting"). We match them to our topic list; anything we don\'t recognise is saved for the team to review.');
}
function addWhichOrgText_(form, what) {
  return form.addTextItem().setTitle(Q.whichOrg).setRequired(true)
    .setHelpText('Type the name or short name of your organization (e.g. "MYCC"). We match it to the list, so small typos are fine. ' +
      'If it is not on the map yet, type "new".');
}
function addHostOrgText_(form, what) {
  return form.addTextItem().setTitle(Q.hostOrg)
    .setHelpText('The organization running the ' + what + ': type its name or short name. Leave blank for a coalition\'s own ' + what + '.');
}
function addWorksWithText_(form) {
  return form.addParagraphTextItem().setTitle(Q.worksWithText)
    .setHelpText('One organization per line, with how often you work together if you like, e.g.\nSunrise Boston — monthly\nMass Power Forward — a few times a year\n' +
      'Leave blank to keep your current answers; if you type anything, it replaces your current list.');
}
function addPublicContact_(form) {
  form.addTextItem().setTitle(Q.publicContact)
    .setHelpText('An email, phone, or contact name people can use to reach you. This is shown on the map.');
}
function addRemove_(form, what) {
  form.addCheckboxItem().setTitle(Q.remove)
    .setHelpText('Check this to take the ' + what + ' off the map. It stays in our records and can be restored.')
    .setChoiceValues([REMOVE_YES]);
}
function addSelector_(form, title, help, placeholder) {
  form.addListItem().setTitle(title).setHelpText(help).setRequired(true).setChoiceValues([placeholder]);
}
function addLocation_(form, what) {
  form.addTextItem().setTitle(Q.location)
    .setHelpText('Venue and address or town. Used to place the ' + what + ' on the geographic map.');
  form.addMultipleChoiceItem().setTitle(Q.online).setChoiceValues(['Yes', 'No'])
    .setHelpText('Online or remote ' + what + 's are listed but get no map pin.');
}
function addOwner_(form, what) {
  addHostOrgText_(form, what);
  form.addListItem().setTitle(Q.coalition).setChoiceValues([NONE])
    .setHelpText('If the ' + what + ' is part of a coalition\'s work. Leave as "None" for an organization\'s own ' + what + '.');
}

function buildOrgForm_(form) {
  header_(form,
    'Use this form to add your organization to the MA Climate Organization Map, or to fill in and correct what we already have.\n\n' +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE + '\n\n' + SIGNIN_NOTE);
  addWhichOrgText_(form);
  form.addTextItem().setTitle(Q.orgName).setHelpText('Only if it is new or has changed.');
  form.addTextItem().setTitle(Q.orgAbbrev).setHelpText('e.g. MYCC, BLS YouthCAN');
  addPointPerson_(form);
  addOrgType_(form);
  form.addParagraphTextItem().setTitle(Q.orgDesc).setHelpText(ORG_HELP.desc);
  form.addTextItem().setTitle(Q.orgTown).setHelpText('e.g. Worcester, Cape Cod, Greater Boston, statewide.');
  form.addTextItem().setTitle(Q.orgHq).setHelpText(ORG_HELP.hq);
  form.addCheckboxItem().setTitle(Q.orgCoalitions)
    .setHelpText('If you answer this, check every coalition you are part of — it replaces your current list.')
    .setChoiceValues([NONE]);
  addTags_(form);
  form.addMultipleChoiceItem().setTitle(Q.membership).setChoiceValues(MEMBERSHIP);
  form.addTextItem().setTitle(Q.website);
  form.addTextItem().setTitle(Q.logo)
    .setHelpText('A link to your logo (PNG or JPG) — e.g. from your website, or a Google Drive file shared as "anyone with the link".');
  addPublicContact_(form);

  form.addPageBreakItem().setTitle(WORKS_WITH_PAGE)
    .setHelpText('Which organizations do you work with, and how often? This draws the connections between organizations on the map.');
  addWorksWithText_(form);

  form.addPageBreakItem().setTitle('Anything else');
  addRemove_(form, 'organization');
}

var WORKS_WITH_PAGE = 'Who you work with';
var POINT_PERSON_PAGE = 'Point person (private)';

/** Org type as checkboxes (an org can be a nonprofit and a faith community) with a write-in "Other". */
function addOrgType_(form) {
  return form.addCheckboxItem().setTitle(Q.orgType)
    .setHelpText('Pick every one that fits.')
    .setChoiceValues(ORG_TYPES.filter(function (t) { return t[1] !== 'other'; }).map(function (t) { return t[0]; }))
    .showOtherOption(true);
}
/** The parts of the site, as the tabs and panels are named on it now. */
var FEEDBACK_AREAS = ['Map (strategy map)', 'Geographic map', 'Voting districts', 'Organizations list', 'Events list',
  'Projects list', 'Actions list', 'Topics page (Streams or Command room)', "A group's details panel", 'Loading screen',
  'Large print or low-power mode', 'On a phone or tablet', 'The forms', 'General'];
var FEEDBACK_TYPES = ["Something's broken", 'Info on the map is wrong or missing', 'Idea or feature request', 'Question'];

/** Who the core team contacts about this org. Private: stored on the Editors tab, never on the map.
 *  Their email can then update this org through the forms. */
function addPointPerson_(form) {
  // A section header (not a page break), so it sits right after the short name on the same page.
  form.addSectionHeaderItem().setTitle(POINT_PERSON_PAGE)
    .setHelpText('Who should we contact about your organization? Only the core team sees this; it is never shown on the map. ' +
      'This person can then update your organization\'s info through these forms (they sign in with this email).');
  form.addTextItem().setTitle(Q.pointName);
  form.addTextItem().setTitle(Q.pointEmail)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addTextItem().setTitle(Q.pointPhone);
}

/** Point-person block (header + name/email/phone) directly after the short-name question.
 *  Replaces the older separate "Point person" page. Safe to run again. */
function placePointPerson_(form) {
  var find = function (title) { return form.getItems().filter(function (it) { return it.getTitle() === title; })[0]; };
  var header = find(POINT_PERSON_PAGE);
  if (header && header.getType() === FormApp.ItemType.PAGE_BREAK) { form.deleteItem(header); header = null; }
  if (!find(Q.pointEmail) || !header) {
    [Q.pointName, Q.pointEmail, Q.pointPhone].forEach(function (t) { var it = find(t); if (it) form.deleteItem(it); });
    addPointPerson_(form); // appended at the end; moved below
  }
  var abbrev = find(Q.orgAbbrev);
  if (!abbrev) return;
  [POINT_PERSON_PAGE, Q.pointName, Q.pointEmail, Q.pointPhone].forEach(function (t, k) {
    var it = find(t);
    var target = find(Q.orgAbbrev).getIndex() + 1 + k;
    if (it && it.getIndex() !== target) form.moveItem(it.getIndex(), it.getIndex() < target ? target - 1 : target);
  });
}

/** One row per organization, one column per frequency. A blank row = no active contact. */
function addWorksWithGrid_(form) {
  return form.addCheckboxGridItem().setTitle(Q.worksWithGrid)
    .setHelpText('Tick how often you work with each organization; leave a row blank if you don\'t. ' +
      'Leave the whole grid blank to keep your current answers — if you tick anything, it replaces your current list.')
    .setRows([NONE])
    .setColumns(FREQUENCIES.map(function (f) { return f[0]; }));
}

/** Bring an already-built org form up to date (safe to run again): the works-with grid, the
 *  combined HQ/remote question, and current help texts. */
function upgradeOrgForm_(form) {
  var items = form.getItems();
  placePointPerson_(form);
  items = form.getItems();
  var typeItem = items.filter(function (it) { return it.getTitle() === Q.orgType; })[0];
  if (typeItem && typeItem.getType() !== FormApp.ItemType.CHECKBOX) {
    var typeAt = typeItem.getIndex();
    form.deleteItem(typeItem);
    form.moveItem(addOrgType_(form).getIndex(), typeAt);
    items = form.getItems();
  }
  var hasGrid = items.some(function (it) { return it.getTitle() === Q.worksWithGrid; });
  var hasText = items.some(function (it) { return it.getTitle() === Q.worksWithText; });
  var oldTitles = FREQUENCIES.map(function (f) { return Q.worksWith(f[0]); });
  if (hasText) {
    // Typed answers replaced the long one-row-per-organization grid: make sure it's gone (it used to come back here).
    items.filter(function (it) { return it.getTitle() === Q.worksWithGrid && it.getType() !== FormApp.ItemType.PARAGRAPH_TEXT && it.getType() !== FormApp.ItemType.TEXT; })
      .forEach(function (it) { form.deleteItem(it); });
  } else if (!hasGrid) {
    var page = items.filter(function (it) { return it.getTitle() === WORKS_WITH_PAGE; })[0];
    var grid = addWorksWithGrid_(form);
    if (page) form.moveItem(grid.getIndex(), page.getIndex() + 1);
    var pageItem = page ? page.asPageBreakItem() : null;
    if (pageItem) pageItem.setHelpText('Which organizations do you work with, and how often? This draws the connections between organizations on the map.');
  }
  form.getItems().forEach(function (it) {
    var title = it.getTitle();
    if (oldTitles.indexOf(title) !== -1 || title === Q.orgRemote || title === Q.youth) form.deleteItem(it);
    else if (title === Q.orgDesc || title === Q.orgDescOld) it.setTitle(Q.orgDesc).setHelpText(ORG_HELP.desc);
    else if (title === Q.orgHq) it.setHelpText(ORG_HELP.hq);
  });
}

/**
 * Menu: turn the organization pickers on the existing forms into type-and-match questions and add the
 * "More topics" box. Safe to run again. (Needed once, because a dropdown can't be turned into a text box.)
 */
function typeAnswersOnForms() {
  var props = PropertiesService.getScriptProperties();
  var swapped = 0;
  var swap = function (form, title, make) {
    form.getItems().filter(function (it) { return it.getTitle() === title && it.getType() !== FormApp.ItemType.TEXT && it.getType() !== FormApp.ItemType.PARAGRAPH_TEXT; })
      .forEach(function (it) {
        var at = it.getIndex();
        form.deleteItem(it);
        form.moveItem(make().getIndex(), at);
        swapped++;
      });
  };
  var addTopicsBox = function (form) {
    var items = form.getItems();
    if (items.some(function (it) { return it.getTitle() === Q.moreTopics; })) return;
    var tags = items.filter(function (it) { return it.getTitle() === Q.tags; })[0];
    var box = addMoreTopics_(form);
    if (tags) form.moveItem(box.getIndex(), tags.getIndex() + 1);
    swapped++;
  };
  var org = props.getProperty('FORM_ORG');
  if (org) {
    var f = FormApp.openById(org);
    swap(f, Q.whichOrg, function () { return addWhichOrgText_(f); });
    swap(f, Q.worksWithGrid, function () { return addWorksWithText_(f); });
    addTopicsBox(f);
  }
  ['FORM_EVENT', 'FORM_PROJECT', 'FORM_ACTION'].forEach(function (k) {
    var id = props.getProperty(k);
    if (!id) return;
    var form = FormApp.openById(id);
    var what = k === 'FORM_EVENT' ? 'event' : k === 'FORM_PROJECT' ? 'project' : 'action';
    swap(form, Q.hostOrg, function () { return addHostOrgText_(form, what); });
    if (k !== 'FORM_ACTION') addTopicsBox(form);
  });
  var ss = ss_();
  [TAB.topics, TAB.unmatched].forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937');
      sh.setFrozenRows(1);
    }
  });
  seedTopics_();
  SpreadsheetApp.getUi().alert('Done: ' + swapped + ' question(s) changed. The forms now take typed organizations and topics; anything that does not match is saved on the "' + TAB.unmatched + '" tab.');
}
/** Put the built-in topics on the Topics tab if it is empty (the team pastes the full list there). */
function seedTopics_() {
  var sh = ss_().getSheetByName(TAB.topics);
  if (!sh || sh.getLastRow() > 1) return;
  var t = readAll_();
  var names = topicCandidates_(t).map(function (c) { return [c.names[0], '', '']; });
  if (names.length) sh.getRange(2, 1, names.length, 3).setValues(names);
}

/** Older event forms had no end time; add it right after the start time (safe to run again). */
function upgradeProjectForm_(form) { addAttendanceQuestions_(form, true); }
function upgradeEventForm_(form) {
  addAttendanceQuestions_(form, false);
  var items = form.getItems();
  var has = function (title) { return items.some(function (it) { return it.getTitle() === title; }); };
  var start = items.filter(function (it) { return it.getTitle() === Q.eventTime; })[0];
  if (!has(Q.eventEndTime)) {
    var end = form.addTimeItem().setTitle(Q.eventEndTime);
    if (start) form.moveItem(end.getIndex(), start.getIndex() + 1);
  }
  if (!has(Q.eventRecurrence)) {
    var rec = addRecurrence_(form);
    var last = form.getItems().filter(function (it) { return it.getTitle() === Q.eventEndTime; })[0];
    if (last) form.moveItem(rec.getIndex(), last.getIndex() + 1);
  }
}
function addRecurrence_(form) {
  return form.addTextItem().setTitle(Q.eventRecurrence)
    .setHelpText('For weekly vigils, monthly meetings and the like, say when it repeats, e.g. "Every Saturday, 12-1 PM" or "Second Monday of each month, 7 PM". The date and start time above should be the next occurrence.');
}

function buildEventForm_(form) {
  header_(form,
    "Use this form to add your organization's or coalition's public event to the map, or to update or remove one that's already there.\n\n" +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE + '\n\n' + SIGNIN_NOTE);
  addSelector_(form, Q.whichEvent, 'Pick an event to update it, or choose "' + NEW_EVENT + '".', NEW_EVENT);
  addOwner_(form, 'event');
  form.addTextItem().setTitle(Q.eventName);
  form.addParagraphTextItem().setTitle(Q.eventDesc);
  form.addDateItem().setTitle(Q.eventDate);
  form.addTimeItem().setTitle(Q.eventTime);
  form.addTimeItem().setTitle(Q.eventEndTime);
  addRecurrence_(form);
  addLocation_(form, 'event');
  addTags_(form);
  form.addTextItem().setTitle(Q.rsvp).setHelpText('A page where people sign up, e.g. Eventbrite or Mobilize. Leave blank if no sign-up is needed.');
  form.addTextItem().setTitle(Q.link);
  addAttendanceQuestions_(form, false);
  addPublicContact_(form);
  addRemove_(form, 'event');
}

function buildActionForm_(form) {
  header_(form,
    "Use this form to add something people can do to help (sign a petition, contact a legislator, show up, volunteer) or to update or remove one that's already on the map. " +
    'Things with a fixed date and time belong in the event form; ongoing campaigns and programs belong in the project form.\n\n' +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE + '\n\n' + SIGNIN_NOTE);
  addSelector_(form, Q.whichAction, 'Pick one to update it, or choose "' + NEW_ACTION + '".', NEW_ACTION);
  addOwner_(form, 'action');
  form.addTextItem().setTitle(Q.actionName);
  form.addParagraphTextItem().setTitle(Q.actionDesc);
  form.addMultipleChoiceItem().setTitle(Q.actionKind).setChoiceValues(ACTION_KINDS.map(function (k) { return k[0]; }));
  form.addMultipleChoiceItem().setTitle(Q.actionUrgency).setChoiceValues(URGENCIES.map(function (k) { return k[0]; }));
  form.addDateItem().setTitle(Q.actionDeadline);
  form.addCheckboxItem().setTitle(Q.skills)
    .setHelpText('If you answer this, check everything you need — it replaces the current list.')
    .setChoiceValues(BASE_SKILLS.map(capitalize_)).showOtherOption(true);
  form.addTextItem().setTitle(Q.link)
    .setHelpText('Where people go to do it: the petition, sign-up or info page.');
  addPublicContact_(form);
  addRemove_(form, 'action');
}

function buildProjectForm_(form) {
  header_(form,
    "Use this form to add a project your organization or coalition is working on, or to update one that's already on the map. " +
    'Projects are how volunteers find ways to help, so the skills question matters.\n\n' +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE + '\n\n' + SIGNIN_NOTE);
  addSelector_(form, Q.whichProject, 'Pick a project to update it, or choose "' + NEW_PROJECT + '".', NEW_PROJECT);
  addOwner_(form, 'project');
  form.addTextItem().setTitle(Q.projectName);
  form.addParagraphTextItem().setTitle(Q.projectDesc);
  form.addMultipleChoiceItem().setTitle(Q.projectStatus).setChoiceValues(STATUSES.map(function (s) { return s[0]; }));
  form.addCheckboxItem().setTitle(Q.skills)
    .setHelpText('If you answer this, check everything you need — it replaces the current list.')
    .setChoiceValues(BASE_SKILLS.map(capitalize_)).showOtherOption(true);
  addLocation_(form, 'project');
  addTags_(form);
  form.addTextItem().setTitle(Q.link);
  addAttendanceQuestions_(form, true);
  addPublicContact_(form);
  addRemove_(form, 'project');
}

/** Older feedback forms had a fixed "Other" choice; make it a write-in (safe to run again). */
function upgradeFeedbackForm_(form) {
  collectVerifiedEmail_(form);
  form.setDescription(FEEDBACK_DESC);
  /** @type {GoogleAppsScript.Forms.Item | null} */ var nameItem = null;
  var hasPhone = false;
  form.getItems().forEach(function (it) {
    var title = it.getTitle();
    if (title === Q.fbType && it.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      it.asMultipleChoiceItem().setChoiceValues(FEEDBACK_TYPES).showOtherOption(true);
    }
    if (title === Q.fbArea && it.getType() === FormApp.ItemType.CHECKBOX) it.asCheckboxItem().setChoiceValues(FEEDBACK_AREAS);
    if (title === Q.fbEmail) form.deleteItem(it); // the signed-in email replaces it
    if (title === Q.fbName) nameItem = it;
    if (title === Q.fbPhone) hasPhone = true;
  });
  if (!hasPhone) {
    var phone = form.addTextItem().setTitle(Q.fbPhone);
    var after = /** @type {GoogleAppsScript.Forms.Item | null} */ (nameItem);
    if (after) form.moveItem(phone.getIndex(), after.getIndex() + 1);
  }
}
var FEEDBACK_DESC = 'Tell us what is working, what is broken, or what you wish the MA Climate Organization Map did. ' +
  "You'll be asked to sign in with Google so we can follow up; only your feedback is required.";

function buildFeedbackForm_(form) {
  form.setDescription(FEEDBACK_DESC);
  form.setConfirmationMessage('Thank you — we read every one.');
  form.addMultipleChoiceItem().setTitle(Q.fbType).setChoiceValues(FEEDBACK_TYPES).showOtherOption(true);
  form.addCheckboxItem().setTitle(Q.fbArea).setChoiceValues(FEEDBACK_AREAS);
  form.addParagraphTextItem().setTitle(Q.fbMessage).setRequired(true);
  form.addTextItem().setTitle(Q.fbName);
  form.addTextItem().setTitle(Q.fbPhone);
  form.addMultipleChoiceItem().setTitle(Q.fbFollowUp).setChoiceValues(['Yes', 'No']);
}

// ---------------------------------------------------------------- dropdown refresh
function refreshDropdowns() {
  var props = PropertiesService.getScriptProperties();
  var t = readAll_();
  var visible = function (r) { return !isTrue_(r.hidden); };

  var idx = buildLabelIndex_(t);
  var labelsOf = function (kind, rows) { return rows.map(function (r) { return idx.byId[kind][str_(r.id)]; }); };
  var orgLabels = labelsOf('org', t.orgs.filter(visible).sort(byName_));
  var coalitionLabels = labelsOf('coalition', t.coalitions);
  var eventLabels = labelsOf('event', t.events.filter(visible)
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }));
  var projectLabels = labelsOf('project', t.projects.filter(visible).sort(byName_));
  var actionLabels = labelsOf('action', t.actions.filter(visible).sort(byName_));

  var tags = tagChoices_(t, props.getProperty('TOPIC_CHOICES'));
  var skills = uniq_(BASE_SKILLS.concat(
    flat_(t.projects.map(function (r) { return list_(r.skills_needed); })),
    flat_(t.actions.map(function (r) { return list_(r.skills_needed); }))
  )).sort().map(capitalize_);

  var set = function (formKey, title, values) {
    var id = props.getProperty(formKey);
    if (!id || !values.length) return;
    var form = FormApp.openById(id);
    var items = form.getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].getTitle() !== title) continue;
      var type = items[i].getType();
      if (type === FormApp.ItemType.LIST) items[i].asListItem().setChoiceValues(values);
      else if (type === FormApp.ItemType.CHECKBOX) items[i].asCheckboxItem().setChoiceValues(values);
      else if (type === FormApp.ItemType.CHECKBOX_GRID) items[i].asCheckboxGridItem().setRows(values);
    }
  };

  set('FORM_ORG', Q.whichOrg, [NEW_ORG].concat(orgLabels));
  set('FORM_ORG', Q.orgCoalitions, coalitionLabels);
  set('FORM_ORG', Q.worksWithGrid, orgLabels);
  set('FORM_EVENT', Q.whichEvent, [NEW_EVENT].concat(eventLabels));
  set('FORM_PROJECT', Q.whichProject, [NEW_PROJECT].concat(projectLabels));
  set('FORM_ACTION', Q.whichAction, [NEW_ACTION].concat(actionLabels));
  ['FORM_EVENT', 'FORM_PROJECT', 'FORM_ACTION'].forEach(function (k) {
    set(k, Q.hostOrg, [NONE].concat(orgLabels));
    set(k, Q.coalition, [NONE].concat(coalitionLabels));
  });
  // "Youth serving" is one of the topic checkboxes (it also sets the org's youth_serving flag).
  ['FORM_ORG', 'FORM_EVENT', 'FORM_PROJECT'].forEach(function (k) { set(k, Q.tags, tags); });
  set('FORM_PROJECT', Q.skills, skills);
  set('FORM_ACTION', Q.skills, skills);
}

/**
 * Dropdown labels are just the name people know ("Sunrise Boston", "Mass Power Forward (MPF)",
 * "Youth Lobby Day — Jun 25, 2026"). Only when two records of the same kind would get the same
 * label is the id added in brackets, so every choice still points to exactly one row.
 * Keep in sync with orgLabel/coalitionLabel in src/fab.ts (the site pre-fills with them).
 */
var LABEL_BASE_ = {
  org: function (o) { return str_(o.name); },
  coalition: function (c) { return str_(c.name) + (str_(c.abbrev) ? ' (' + str_(c.abbrev) + ')' : ''); },
  event: function (e) { return str_(e.name) + ' — ' + shortDate_(e.date); },
  project: function (p) { return str_(p.name); },
  action: function (a) { return str_(a.name); },
};

/** { byId: {kind: {id: label}}, byLabel: {kind: {label: id}} } for all rows (hidden ones too). */
function buildLabelIndex_(t) {
  var tables = { org: t.orgs, coalition: t.coalitions, event: t.events, project: t.projects, action: t.actions };
  var idx = { byId: {}, byLabel: {} };
  Object.keys(tables).forEach(function (kind) {
    var rows = tables[kind].filter(function (r) { return str_(r.id); });
    var count = {};
    rows.forEach(function (r) { var b = LABEL_BASE_[kind](r); count[b] = (count[b] || 0) + 1; });
    idx.byId[kind] = {}; idx.byLabel[kind] = {};
    rows.forEach(function (r) {
      var b = LABEL_BASE_[kind](r);
      var label = count[b] > 1 ? b + ' [' + str_(r.id) + ']' : b;
      idx.byId[kind][str_(r.id)] = label;
      idx.byLabel[kind][label] = str_(r.id);
    });
  });
  // what typed text is matched against: the label, the short name, and the id
  idx.cands = {};
  ['org', 'coalition'].forEach(function (kind) {
    idx.cands[kind] = tables[kind].filter(function (r) { return str_(r.id) && !(kind === 'org' && isTrue_(r.hidden)); }).map(function (r) {
      return { id: str_(r.id), names: [idx.byId[kind][str_(r.id)], str_(r.name), str_(r.abbrev), str_(r.id).replace(/_/g, ' ')].filter(Boolean) };
    });
  });
  return idx;
}
var LABEL_INDEX_ = null;
/** Typed names that matched nothing during the current submission (see idFromLabel_). */
var MISSES_ = [];
/** Who/what is being processed, so deep helpers can log unmatched input. */
var CUR_ = { email: '', kind: '' };

// ---------------------------------------------------------------- typed answers: matching
/** lower-case, no accents/punctuation, filler words dropped: "The Sierra Club, MA" ~ "sierra club ma". */
function normText_(s) {
  return String(s === undefined || s === null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/\b(the|of|a|an|and|for|in|at)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function editDistance_(a, b) {
  var prev = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    var cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** 0..1: 1 = same after normalising; otherwise the better of word overlap and spelling closeness. */
function similarity_(x, y) {
  var a = normText_(x), b = normText_(y);
  if (!a || !b) return 0;
  if (a === b) return 1;
  var ta = a.split(' '), tb = b.split(' ');
  var inter = ta.filter(function (w) { return tb.indexOf(w) !== -1; }).length;
  var jac = inter / (ta.length + tb.length - inter);
  var lev = 1 - editDistance_(a, b) / Math.max(a.length, b.length);
  return Math.max(jac, lev);
}
var MATCH_MIN = 0.88; // accept only a clear match
var MATCH_GAP = 0.06; // ...that is clearly better than the runner-up
/**
 * cands: [{ id, names: [..] }]. Returns { id, score, closest: [labels] }; id is '' unless the best
 * candidate is a clear match (so a typo like "Sunrise Bostn" matches, but "Sunrise" alone is ambiguous).
 */
function matchTyped_(text, cands) {
  var scored = cands.map(function (c) {
    var best = 0;
    c.names.forEach(function (n) { best = Math.max(best, similarity_(text, n)); });
    return { id: c.id, label: c.names[0], score: best };
  }).sort(function (p, q) { return q.score - p.score; });
  var top = scored[0], next = scored[1];
  var closest = scored.slice(0, 3).filter(function (c) { return c.score > 0.35; }).map(function (c) { return c.label; });
  if (top && top.score >= MATCH_MIN && (!next || top.score === 1 || top.score - next.score >= MATCH_GAP)) {
    return { id: top.id, score: top.score, closest: closest };
  }
  return { id: '', score: top ? top.score : 0, closest: closest };
}

/** Topics people can type: the Topics tab (name + aliases), the built-in tags, and every tag already in use. */
function topicCandidates_(t) {
  var seen = {}, out = [];
  var add = function (name, aliases) {
    var id = slug_(name);
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push({ id: id, names: [humanize_(id) === name ? name : name].concat(list_(aliases)) });
  };
  // Aliases are separated by " | " (Wikipedia-based list; names can contain commas) or, in older rows, by , or ;
  (t.topics || []).forEach(function (r) {
    var al = String(r.aliases || '');
    if (str_(r.name)) add(str_(r.name), al.indexOf('|') !== -1 ? al.split(/\s*\|\s*/) : al.split(/[,;]/));
  });
  BASE_TAGS.forEach(function (x) { add(humanize_(x), []); });
  var used = flat_(t.coalitions.map(function (c) { return list_(c.focus_tags); }).concat(
    t.orgs.map(function (r) { return list_(r.topic_tags); }),
    t.events.map(function (r) { return list_(r.topic_tags); }),
    t.projects.map(function (r) { return list_(r.topic_tags); })));
  used.forEach(function (x) { add(humanize_(x), []); });
  return out;
}
/**
 * Typed topics → { slugs: [matched], missed: [{typed, closest}] }. Matched only against Turibius's list on the
 * Topics tab (names + aliases) and the tags in use: no Wikipedia lookups (Nathan, Oct 23: the related topics are
 * already in his spreadsheet). Anything else goes to Unmatched Input with the closest names for the monthly review.
 */
function resolveTopics_(text, t) {
  var out = { slugs: [], missed: [] };
  var parts = String(text === undefined || text === null ? '' : text).split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (!parts.length) return out;
  var cands = topicCandidates_(t);
  var exact = {};
  cands.forEach(function (c) { c.names.forEach(function (n) { var k = normText_(n); if (k && !(k in exact)) exact[k] = c.id; }); });
  parts.forEach(function (typed) {
    var k = normText_(typed);
    if (exact[k]) { out.slugs.push(exact[k]); return; }
    // The full list has thousands of names: compare only those sharing a word or of similar length (typos).
    var words = k.split(' ').filter(function (w) { return w.length >= 4; });
    var near = cands.filter(function (c) {
      return c.names.some(function (n) {
        var nk = normText_(n);
        return Math.abs(nk.length - k.length) <= 3 || words.some(function (w) { return nk.indexOf(w) !== -1; });
      });
    });
    var m = matchTyped_(typed, near);
    if (m.id) { out.slugs.push(m.id); return; }
    out.missed.push({ typed: typed, closest: m.closest.join(' | ') });
  });
  return out;
}

/** Append a row to the Unmatched Input tab so the team can review what people typed. */
function logUnmatched_(email, kind, what, field, typed, closest, status, resolution) {
  var sheet = ss_().getSheetByName(TAB.unmatched);
  if (!sheet) return;
  appendObject_(sheet, { logged_at: nowIso_(), email: email || '', form: FORM_NAMES[kind] || kind, what: what, field: field,
    typed: typed, closest_match: closest || '', status: status || 'new', resolution: resolution || '' });
}

/**
 * Menu: the monthly alias review (Turibius, Oct 19). On Unmatched Input, put a topic's exact name from the Topics
 * tab in "resolution" for any typed topic, and run this: the typed words become an alias of that topic, so the
 * forms match them from then on, and the row's status becomes "alias added".
 */
function addReviewedAliases() {
  var ss = ss_();
  var un = ss.getSheetByName(TAB.unmatched), tp = ss.getSheetByName(TAB.topics);
  var ut = readTable_(un), tt = readTable_(tp);
  var res = reviewedAliases_(ut.rows, tt.rows);
  res.topicUpdates.forEach(function (u) { writeFields_(tp, tt.headers, u.row._row, { aliases: u.aliases }); });
  res.done.forEach(function (r) { writeFields_(un, ut.headers, r._row, { status: 'alias added' }); });
  ss.toast(res.done.length ? 'Added ' + res.done.length + ' alias(es).' + (res.unknown.length ? ' Not on the Topics tab: ' + res.unknown.join('; ') : '') :
    'Nothing to add: put a topic name from the Topics tab in "resolution" on Unmatched Input first.');
}

/** Pure: Unmatched Input rows with a topic name in "resolution" → alias additions for the Topics tab. */
function reviewedAliases_(unRows, topicRows) {
  var byName = {};
  topicRows.forEach(function (r) { if (str_(r.name)) byName[normText_(r.name)] = r; });
  var adds = {}, done = [], unknown = [];
  unRows.forEach(function (r) {
    var st = str_(r.status).toLowerCase();
    if (str_(r.what) !== 'topic' || !str_(r.resolution) || st === 'alias added' || st === 'auto-matched') return;
    var t = byName[normText_(str_(r.resolution).replace(/^Wikipedia search → /, ''))];
    if (!t) { unknown.push(str_(r.resolution)); return; }
    (adds[t.name] = adds[t.name] || { row: t, words: [] }).words.push(str_(r.typed));
    done.push(r);
  });
  var topicUpdates = Object.keys(adds).map(function (k) {
    var a = adds[k], cur = String(a.row.aliases || '').split(/\s*\|\s*/).filter(Boolean);
    var have = {}; cur.concat([a.row.name]).forEach(function (x) { have[normText_(x)] = true; });
    a.words.forEach(function (w) { if (!have[normText_(w)]) { cur.push(w); have[normText_(w)] = true; } });
    return { row: a.row, aliases: cur.join(' | ') };
  });
  return { topicUpdates: topicUpdates, done: done, unknown: uniq_(unknown) };
}

// ---------------------------------------------------------------- submissions
function handleSubmit(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var formId = e.source.getId();
    var kind =
      formId === props.getProperty('FORM_ORG') ? 'org' :
      formId === props.getProperty('FORM_EVENT') ? 'event' :
      formId === props.getProperty('FORM_PROJECT') ? 'project' :
      formId === props.getProperty('FORM_ACTION') ? 'action' :
      formId === props.getProperty('FORM_FEEDBACK') ? 'feedback' : null;
    if (!kind) return;
    var email = '';
    try { email = String(e.response.getRespondentEmail() || '').trim().toLowerCase(); } catch (err) { /* not collected */ }
    processSubmission_(kind, answers_(e.response), email, null);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Check access, then apply or queue for review. `approver` is set when an admin approves a
 * queued submission (access check skipped).
 */
function processSubmission_(kind, a, email, approver) {
  if (kind === 'feedback') return saveFeedback_(a, email);
  var t = readAll_();
  LABEL_INDEX_ = buildLabelIndex_(t); // match labels against the sheet as it is now
  MISSES_ = [];
  CUR_ = { email: email, kind: kind };
  var miss = normalizeTyped_(kind, a, approver);
  if (miss && approver) {
    // The host org still matches nothing: the admin must correct it (edit the organization in the payload) first.
    return { ok: false, reason: 'The organization "' + miss.typed + '" still matches nothing. Fix the name in the payload cell (or add the org), then tick approve again.' };
  }
  if (miss) {
    // Typed an organization we can't find: keep the words for the team and hold the submission for review.
    logUnmatched_(email, kind, 'organization', miss.field, miss.typed, miss.closest);
    queueForReview_(kind, a, email, { label: miss.typed, id: '' }, 'UNMATCHED ORG — "' + miss.typed + '" is not on the list' + (miss.closest ? ' (closest: ' + miss.closest + ')' : ''));
    return;
  }
  if (kind === 'org' && a[COALITION_EDIT]) return saveCoalitionSubmission_(a, email, approver, t);
  var target = describeTarget_(kind, a, t);
  // A new organization always needs a verified (Google sign-in) email, even when an admin approves it.
  if (kind === 'org' && target.isNew && !email) {
    if (approver) return { ok: false, reason: 'New organizations need a verified email: this submission has none. Ask them to send the form again, signed in with Google.' };
    queueForReview_(kind, a, email, target, 'NO EMAIL — a new organization needs a verified email');
    return;
  }
  var access = approver ? { ok: true } : authorize_(email, kind, a, target, t);
  if (!access.ok) {
    queueForReview_(kind, a, email, target, access.reason);
    return;
  }
  var result = kind === 'org' ? saveOrg_(a, t) : kind === 'event' ? saveEvent_(a, t) : kind === 'action' ? saveAction_(a, t) : saveProject_(a, t);
  var flag = approver ? 'approved by ' + approver : '';
  logChange_(email, FORM_NAMES[kind], result.action, flag, result.type, result.id, result.name, result.changes);
  // held earlier and now applied (approved, or re-checked once the editor was listed) vs. applied straight away
  notifySubmitter_(email, submitterMessage_(approver || RECHECK_ ? 'approved' : 'live', kind, result.name));
  // An approved new org: its submitter becomes that org's point-person.
  if (approver && kind === 'org' && target.isNew && email) addEditorOrg_(email, result.id);
  if (kind === 'org' && result.id && result.action !== 'not found') savePointPerson_(result.id, a, email);
  refreshDropdowns();
}

/** The org form used for a coalition: its point people (Editors → coalition_ids) or admins may update it. */
function saveCoalitionSubmission_(a, email, approver, t) {
  var cid = a[COALITION_EDIT];
  var label = LABEL_INDEX_.byId.coalition[cid];
  var target = { kind: 'coalition', isNew: false, id: cid, label: label };
  if (!approver) {
    var perms = email ? permissionsFor_(email, t.editors) : null;
    var ok = perms && (perms.admin || perms.all || perms.coalitions[cid]);
    if (!ok) {
      queueForReview_('org', a, email, target, email ? 'UNAUTHORIZED — ' + email + ' does not manage the coalition ' + cid : 'NO EMAIL — form did not record a signed-in email');
      return;
    }
  }
  var patch = {};
  put_(patch, 'name', a[Q.orgName]);
  put_(patch, 'abbrev', a[Q.orgAbbrev]);
  put_(patch, 'description', a[Q.orgDesc] || a[Q.orgDescOld]);
  put_(patch, 'website', a[Q.website]);
  put_(patch, 'geographic_scope', a[Q.orgTown]);
  if (a[Q.logo]) put_(patch, 'logo', driveImage_(String(a[Q.logo]).trim()));
  var result = upsert_(TAB.coalitions, 'coalition', label, NEW_ORG, patch);
  logChange_(email, FORM_NAMES.org, result.action, approver ? 'approved by ' + approver : 'coalition', 'coalition', result.id, result.name, result.changes);
  refreshDropdowns();
}

/**
 * People may now type the organization instead of picking it. Turns typed text into the list's own
 * label (so everything after this works as before). Returns null, or { field, typed, closest } when
 * it matched nothing. An admin approving such a submission treats it as a new org (org form) or as
 * "no host org" (event/project/action forms).
 */
function normalizeTyped_(kind, a, approver) {
  var field = kind === 'org' ? Q.whichOrg : Q.hostOrg;
  var typed = str_(a[field]);
  if (!typed || typed === NONE || typed === NEW_ORG) return null;
  if (kind === 'org' && /^\s*(new|add|add (a )?new( org(anization)?)?|none of these)\s*\.?\s*$/i.test(typed)) { a[field] = NEW_ORG; return null; }
  var before = MISSES_.length;
  var id = idFromLabel_(typed, 'org');
  if (id && LABEL_INDEX_.byId.org[id]) { a[field] = LABEL_INDEX_.byId.org[id]; return null; }
  var closest = MISSES_.length > before ? MISSES_[MISSES_.length - 1].closest : '';
  // A coalition typed where an organization was asked (e.g. "CCCC"): the coalition is the owner / the record edited.
  var cid = idFromLabel_(typed, 'coalition');
  if (cid && LABEL_INDEX_.byId.coalition[cid]) {
    MISSES_.splice(before); // not a miss after all
    if (kind === 'org') { a[COALITION_EDIT] = cid; return null; }
    a[Q.coalition] = LABEL_INDEX_.byId.coalition[cid];
    a[field] = NONE;
    return null;
  }
  if (approver && kind === 'org') {
    a[field] = NEW_ORG; if (!str_(a[Q.orgName])) a[Q.orgName] = typed; // approving = "yes, it is a new organization"
    return null;
  }
  return { field: field, typed: typed, closest: closest };
}

/** Set on an org-form answer set when the "organization" typed is a coalition: the coalition's own row is edited. */
var COALITION_EDIT = '__coalition_id';

var FORM_NAMES = { org: 'Update your organization', event: 'Add or edit an event', project: 'Add or edit a project', action: 'Add or edit an action or volunteer opportunity', feedback: 'Send feedback' };

/** Which record a submission is about, and who owns it now / after the change. */
function describeTarget_(kind, a, t) {
  var sel = kind === 'org' ? a[Q.whichOrg] : kind === 'event' ? a[Q.whichEvent] : kind === 'action' ? a[Q.whichAction] : a[Q.whichProject];
  var isNew = sel === NEW_ORG || sel === NEW_EVENT || sel === NEW_PROJECT || sel === NEW_ACTION;
  var id = isNew ? '' : idFromLabel_(sel, kind);
  var rows = kind === 'org' ? t.orgs : kind === 'event' ? t.events : kind === 'action' ? t.actions : t.projects;
  var rec = id ? findById_(rows, id) : null;
  var target = { kind: kind, isNew: isNew, id: id, label: sel, record: rec, owners: { orgs: [], coalitions: [] }, newOwners: { orgs: [], coalitions: [] } };
  if (kind === 'org') {
    if (id) target.owners.orgs.push(id);
  } else {
    if (rec && str_(rec.host_org_id)) target.owners.orgs.push(str_(rec.host_org_id));
    if (rec && str_(rec.coalition_id)) target.owners.coalitions.push(str_(rec.coalition_id));
    var host = a[Q.hostOrg] && a[Q.hostOrg] !== NONE ? idFromLabel_(a[Q.hostOrg], 'org') : '';
    var coal = a[Q.coalition] && a[Q.coalition] !== NONE ? idFromLabel_(a[Q.coalition], 'coalition') : '';
    if (host) target.newOwners.orgs.push(host);
    if (coal) target.newOwners.coalitions.push(coal);
  }
  return target;
}

/**
 * Admins: everything. Editors: their orgs/coalitions (Editors tab).
 *  - Org form: only existing orgs they manage. New orgs always go to review.
 *  - Events/projects: they must manage the current owner (org or coalition) when editing,
 *    and at least one of the owners they pick when adding or moving.
 */
function authorize_(email, kind, a, target, t) {
  if (!email) return { ok: false, reason: 'NO EMAIL — form did not record a signed-in email' };
  var perms = permissionsFor_(email, t.editors);
  if (perms.admin) return { ok: true };
  var manages = function (owners) {
    return owners.orgs.some(function (id) { return perms.all || perms.orgs[id]; }) ||
      owners.coalitions.some(function (id) { return perms.all || perms.coalitions[id]; });
  };
  if (kind === 'org' && target.isNew) return { ok: false, reason: 'NEW ORG — new organizations are approved by the core team' };
  if (!perms.known) return { ok: false, reason: 'UNAUTHORIZED — ' + email + ' is not on the Editors tab' };
  if (kind === 'org') {
    if (!target.record) return { ok: false, reason: 'NOT FOUND — ' + target.label };
    return manages(target.owners) ? { ok: true } : { ok: false, reason: 'UNAUTHORIZED — ' + email + ' does not manage ' + target.id };
  }
  if (!target.isNew) {
    if (!target.record) return { ok: false, reason: 'NOT FOUND — ' + target.label };
    if (!manages(target.owners)) return { ok: false, reason: 'UNAUTHORIZED — ' + email + ' does not manage the owner of ' + target.id };
    var moving = target.newOwners.orgs.length || target.newOwners.coalitions.length;
    if (moving && !manages(target.newOwners)) return { ok: false, reason: 'UNAUTHORIZED — ' + email + ' cannot move it to an org/coalition they do not manage' };
    return { ok: true };
  }
  if (!target.newOwners.orgs.length && !target.newOwners.coalitions.length) {
    return { ok: false, reason: 'NO OWNER — pick an organization or coalition you manage' };
  }
  return manages(target.newOwners) ? { ok: true } : { ok: false, reason: 'UNAUTHORIZED — ' + email + ' does not manage the chosen org/coalition' };
}

function permissionsFor_(email, editors) {
  var p = { known: false, admin: false, all: false, orgs: {}, coalitions: {} };
  email = String(email || '').toLowerCase();
  if (ADMIN_EMAILS.map(function (x) { return x.toLowerCase(); }).indexOf(email) !== -1) { p.known = p.admin = true; }
  (editors || []).forEach(function (r) {
    if (String(r.email || '').trim().toLowerCase() !== email) return;
    if (isPending_(r)) return; // email not confirmed yet
    p.known = true;
    if (/^admin$/i.test(str_(r.role))) p.admin = true;
    list_(r.org_ids).forEach(function (id) { if (id === '*') p.all = true; p.orgs[id] = true; });
    list_(r.coalition_ids).forEach(function (id) { if (id === '*') p.all = true; p.coalitions[id] = true; });
  });
  return p;
}

function addEditorOrg_(email, orgId) {
  var sheet = ss_().getSheetByName(TAB.editors);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return String(r.email).toLowerCase() === email; })[0];
  if (row) {
    var ids = uniq_(list_(row.org_ids).concat([orgId]));
    writeFields_(sheet, table.headers, row._row, { org_ids: ids.join(', ') });
  } else {
    appendObject_(sheet, { email: email, role: 'editor', org_ids: orgId, notes: 'added when their new org was approved' });
  }
}

/**
 * Point-person answers → an Editors row for that email with this org added (name/phone kept up to date).
 * The email has to be verified before it can edit anything (Nathan, Oct 23): when it is the submitter's own
 * signed-in email, Google already verified it; any other address is saved as "pending" and sent a link to
 * confirm (doGet ?verify=…). Pending rows grant nothing until the link is opened.
 */
function savePointPerson_(orgId, a, submitter) {
  var email = String(a[Q.pointEmail] || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) return;
  var name = String(a[Q.pointName] || '').trim();
  var phone = String(a[Q.pointPhone] || '').trim();
  var sheet = ss_().getSheetByName(TAB.editors);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return String(r.email).toLowerCase() === email; })[0];
  var verified = email === String(submitter || '').trim().toLowerCase() || (row && !isPending_(row));
  var note = phone ? 'phone: ' + phone : '';
  if (row) {
    var up = { org_ids: uniq_(list_(row.org_ids).concat([orgId])).join(', ') };
    if (name) up.name = name;
    if (note) {
      var rest = str_(row.notes).split(/;\s*/).filter(function (x) { return x && x.indexOf('phone: ') !== 0; });
      up.notes = [note].concat(rest).join('; ');
    }
    if (isPending_(row) && verified) up.role = 'editor';
    writeFields_(sheet, table.headers, row._row, up);
  } else {
    appendObject_(sheet, { email: email, role: verified ? 'editor' : PENDING_ROLE, org_ids: orgId, name: name,
      notes: [note, verified ? 'point person from the org form' : 'point person from the org form; waiting for them to confirm their email'].filter(Boolean).join('; ') });
  }
  if (!verified) sendVerification_(email, orgId, name);
}

/** Editors rows waiting for their email to be confirmed: listed, but allowed nothing. */
var PENDING_ROLE = 'pending';
function isPending_(r) { return /^pending/i.test(str_(r.role)); }

/** Email a point person a one-time link that confirms the address (doGet ?verify=token). */
function sendVerification_(email, orgId, name) {
  var token = '';
  for (var i = 0; i < 4; i++) token += Math.floor(Math.random() * 0x100000000).toString(16);
  PropertiesService.getScriptProperties().setProperty('VERIFY_' + token, JSON.stringify({ email: email, org: orgId, at: nowIso_() }));
  var url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { /* not deployed as a web app (tests) */ }
  url = (url || PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '') + '?verify=' + token;
  var label = (LABEL_INDEX_ && LABEL_INDEX_.byId.org[orgId]) || orgId;
  logChange_('', FORM_NAMES.org, 'verification sent', 'PENDING', 'editor', orgId, label, 'point person ' + email + ' asked to confirm their email');
  try {
    MailApp.sendEmail(email, 'MA Climate Organization Map: please confirm your email',
      'Hi' + (name ? ' ' + name : '') + ',\n\nSomeone named you as the point person for ' + label + ' on the MA Climate Organization Map. ' +
      'Open this link to confirm your email, so you can keep the organization\'s information up to date:\n\n' + url +
      '\n\nIf this wasn\'t you, ignore this email: nothing changes until the link is opened.');
  } catch (e) { /* quota: the Change Log and Editors tab still show the pending row */ }
}

/** The confirmation link: the pending Editors row becomes an editor. Returns a short message for the page. */
function confirmVerification_(token) {
  var props = PropertiesService.getScriptProperties();
  var raw = token && /^[0-9a-f]{8,64}$/.test(token) ? props.getProperty('VERIFY_' + token) : null;
  if (!raw) return 'This link has expired or was already used. If you still need access, ask the core team.';
  var v = JSON.parse(raw);
  var sheet = ss_().getSheetByName(TAB.editors);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return String(r.email).toLowerCase() === v.email; })[0];
  if (row && isPending_(row)) {
    var rest = str_(row.notes).split(/;\s*/).filter(function (x) { return x && x.indexOf('waiting for them to confirm') === -1; });
    writeFields_(sheet, table.headers, row._row, { role: 'editor', notes: rest.concat(['email confirmed ' + nowIso_().slice(0, 10)]).join('; ') });
  }
  props.deleteProperty('VERIFY_' + token);
  logChange_(v.email, 'Email confirmation', 'confirmed', '', 'editor', v.org, v.org, 'point person confirmed their email');
  try { recheckWaiting_(); } catch (e) { /* held submissions are re-checked on the next Editors edit */ }
  return 'Thanks, your email is confirmed. You can now update ' + v.org + ' through the forms on the map.';
}

function queueForReview_(kind, a, email, target, reason) {
  if (RECHECK_) { RECHECK_.queued = reason; return; } // re-checking a held submission: don't queue it twice
  notifySubmitter_(email, submitterMessage_('held', kind, target && (target.label || target.id)));
  var sheet = ss_().getSheetByName(TAB.review);
  var summary = Object.keys(a).filter(function (k) {
    var v = a[k]; return v !== '' && v !== null && !(Array.isArray(v) && !v.length);
  }).map(function (k) { return k + ': ' + (Array.isArray(a[k]) ? a[k].join(', ') : a[k]); }).join('\n');
  appendObject_(sheet, {
    submitted_at: nowIso_(), email: email, form: FORM_NAMES[kind], record_type: kind,
    record: target.label, reason: reason, summary: summary, status: 'waiting', reviewed_at: '',
    payload: JSON.stringify({ kind: kind, answers: a, email: email }),
  });
  var row = sheet.getLastRow();
  sheet.getRange(row, COLS[TAB.review].indexOf('approve') + 1).insertCheckboxes();
  logChange_(email, FORM_NAMES[kind], 'needs review', reason, kind, target.id, target.label, summary);
  if (ALERT_ADMINS) {
    try {
      MailApp.sendEmail(ADMIN_EMAILS.join(','), 'MA Climate Organization Map: submission needs review (' + reason.split(' — ')[0] + ')',
        'From: ' + (email || 'unknown') + '\nForm: ' + FORM_NAMES[kind] + '\nAbout: ' + target.label +
        '\nWhy: ' + reason + '\n\n' + summary + '\n\nReview it on the "Needs Review" tab: ' + ss_().getUrl());
    } catch (err) { /* email quota; the Change Log still has it */ }
  }
}

/** Installable onEdit trigger: ticking "approve" on Needs Review applies the change. */
// ---------------------------------------------------------------- telling the submitter what happened
/** Pure: the short email a submitter gets. status: live | held | approved. */
function submitterMessage_(status, kind, name) {
  var what = { org: 'organization', event: 'event', project: 'project', action: 'action' }[kind] || 'submission';
  var it = name ? '"' + name + '"' : 'your ' + what;
  var subject = status === 'held' ? 'MA Climate Organization Map: we received your ' + what : 'MA Climate Organization Map: ' + it + ' is on the map';
  var body = status === 'live'
    ? 'Thanks! Your changes to ' + it + ' are saved. They show on the map within a few minutes (reload the page to see them).'
    : status === 'approved'
      ? 'Thanks for your patience. The map team approved your changes to ' + it + ', and they now show on the map.'
      : 'Thanks! Your changes to ' + it + ' are waiting for the map team to check them, because this email isn\'t yet listed as a point person for that group. You\'ll get another email when they go live.';
  return { subject: subject, body: body + '\n\nTo change anything, use the Edit buttons on the map: they open the form with everything filled in.\n\n— MA Climate Organization Map' };
}
/** Sends the message unless turned off (Script property NOTIFY_SUBMITTERS = off). Never fails a submission. */
function notifySubmitter_(email, msg) {
  if (!email || !msg) return;
  try {
    if (PropertiesService.getScriptProperties().getProperty('NOTIFY_SUBMITTERS') === 'off') return;
    MailApp.sendEmail(email, msg.subject, msg.body);
  } catch (e) { /* quota or bad address: the change itself is already saved */ }
}

/** Set while held submissions are re-checked (see recheckWaiting_). @type {{ queued?: string } | null} */
var RECHECK_ = null;

/**
 * Someone was added to (or changed on) the Editors tab: every submission still "waiting" is checked again, and
 * the ones that are now allowed are applied — no need to approve them one by one.
 */
function recheckWaiting_() {
  var sheet = ss_().getSheetByName(TAB.review);
  var table = readTable_(sheet);
  var applied = 0;
  table.rows.forEach(function (r) {
    if (String(r.status) !== 'waiting' || !str_(r.payload)) return;
    var p;
    try { p = JSON.parse(r.payload); } catch (err) { return; }
    RECHECK_ = { queued: '' };
    try {
      processSubmission_(p.kind, p.answers, p.email, null);
    } finally {
      var still = RECHECK_.queued;
      RECHECK_ = null;
      if (still) writeFields_(sheet, table.headers, r._row, { reason: still });
      else { writeFields_(sheet, table.headers, r._row, { status: 'applied (editor added)', reviewed_at: nowIso_() }); applied++; }
    }
  });
  if (applied) SpreadsheetApp.getActive().toast(applied + ' held submission' + (applied === 1 ? ' was' : 's were') + ' applied now that the editor is listed.');
}

function onReviewEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() === TAB.editors) {
    var lock0 = LockService.getScriptLock();
    lock0.waitLock(30000);
    try { recheckWaiting_(); } finally { lock0.releaseLock(); }
    return;
  }
  if (sheet.getName() !== TAB.review || e.range.getNumColumns() !== 1) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (e.range.getColumn() !== headers.indexOf('approve') + 1 || e.range.getValue() !== true) return;
  var reviewer = '';
  try { reviewer = String((e.user && e.user.getEmail()) || Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (err) { /* unknown */ }
  if (reviewer && !permissionsFor_(reviewer, readTable_(ss_().getSheetByName(TAB.editors)).rows).admin) {
    e.range.setValue(false);
    logChange_(reviewer, 'Needs Review', 'approval refused', 'UNAUTHORIZED — only admins can approve', 'review', '',
      'Needs Review row ' + e.range.getRow(), '');
    SpreadsheetApp.getActive().toast('Only core-team admins can approve.');
    return;
  }
  var row = e.range.getRow();
  var rec = {};
  headers.forEach(function (h, i) { rec[h] = sheet.getRange(row, i + 1).getValue(); });
  if (rec.status === 'approved') return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = JSON.parse(rec.payload);
    var res = processSubmission_(p.kind, p.answers, p.email, reviewer || 'admin');
    if (res && res.ok === false) {
      e.range.setValue(false);
      SpreadsheetApp.getActive().toast(res.reason);
      return;
    }
    writeFields_(sheet, headers, row, { status: 'approved', reviewed_at: nowIso_() });
  } finally {
    lock.releaseLock();
  }
}

function answers_(response) {
  var out = {};
  response.getItemResponses().forEach(function (ir) {
    var item = ir.getItem();
    var value = ir.getResponse();
    // Grid answers come back as one entry per row, in row order; keep them as { rowLabel: [columns] }.
    if (item.getType && item.getType() === FormApp.ItemType.CHECKBOX_GRID) {
      var rows = item.asCheckboxGridItem().getRows();
      var byRow = {};
      (value || []).forEach(function (cols, i) { if (cols && cols.length) byRow[rows[i]] = [].concat(cols); });
      value = byRow;
    }
    out[item.getTitle()] = value;
  });
  return out;
}

function saveOrg_(a, t) {
  var patch = {};
  put_(patch, 'name', a[Q.orgName]);
  put_(patch, 'abbrev', a[Q.orgAbbrev]);
  // Several types are stored comma-separated, e.g. "501c3, faith_org".
  var types = asArray_(a[Q.orgType]).map(function (l) { return lookup_(ORG_TYPES, l); }).filter(Boolean);
  if (types.length) put_(patch, 'type', types.filter(function (t, i) { return types.indexOf(t) === i; }).join(', '));
  put_(patch, 'geographic_focus', a[Q.orgTown]);
  put_(patch, 'description', a[Q.orgDesc] || a[Q.orgDescOld]);
  if (asArray_(a[Q.orgCoalitions]).length) {
    patch.coalition_ids = asArray_(a[Q.orgCoalitions]).map(function (l) { return idFromLabel_(l, 'coalition'); }).filter(Boolean).join(', ');
  }
  putTags_(patch, a[Q.tags], a[Q.moreTopics]);
  put_(patch, 'website', a[Q.website]);
  if (a[Q.logo]) put_(patch, 'logo', driveImage_(String(a[Q.logo]).trim()));
  if (a[Q.youth]) patch.youth_serving = a[Q.youth] === 'Yes' ? 'TRUE' : 'FALSE';
  // Answering the topic checkboxes also answers "youth-serving?" (ticked or not).
  if (asArray_(a[Q.tags]).length) {
    patch.youth_serving = asArray_(a[Q.tags]).map(slug_).indexOf('youth_serving') !== -1 ? 'TRUE' : 'FALSE';
  }
  put_(patch, 'membership_size', a[Q.membership]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  var hqRemote = REMOTE_WORDS.test(String(a[Q.orgHq] || ''));
  if (!hqRemote) put_(patch, 'hq_address', a[Q.orgHq]);
  if (hqRemote || asArray_(a[Q.orgRemote]).indexOf(REMOTE_YES) !== -1) patch.remote = 'TRUE';
  else if (a[Q.orgHq]) patch.remote = 'FALSE';
  if (isRemove_(a)) patch.hidden = 'TRUE';

  var isNew = a[Q.whichOrg] === NEW_ORG;
  var existing = isNew ? null : findById_(t.orgs, idFromLabel_(a[Q.whichOrg], 'org'));
  // Place the pin: headquarters address first, else the town/region.
  var place = patch.hq_address || (patch.geographic_focus && !(existing && str_(existing.hq_address)) ? patch.geographic_focus : '');
  if (place && (!existing || str_(existing.hq_address) !== place)) {
    var ll = geocode_(place);
    if (ll) { patch.lat = ll[0]; patch.lng = ll[1]; patch.geo_precision = patch.hq_address ? 'exact' : 'approx'; }
  }
  if (isNew && patch.lat === undefined) {
    var c = patch.coalition_ids ? findById_(t.coalitions, list_(patch.coalition_ids)[0]) : null;
    var base = c ? [Number(c.lat), Number(c.lng)] : [42.3601, -71.0589];
    patch.lat = jitter_(base[0]); patch.lng = jitter_(base[1]); patch.geo_precision = 'approx';
  }
  var result = upsert_(TAB.orgs, 'organization', a[Q.whichOrg], NEW_ORG, patch);
  var links = saveConnections_(result.id, a);
  if (links) result.changes = (result.changes ? result.changes + '\n' : '') + links;
  return result;
}

/** "Who you work with": answering any of the four questions replaces this org's reported list. */
function saveConnections_(orgId, a) {
  var picked = [];
  var grid = a[Q.worksWithGrid] || {};
  Object.keys(grid).forEach(function (label) {
    var to = idFromLabel_(label, 'org');
    if (!to || to === orgId) return;
    asArray_(grid[label]).forEach(function (col) {
      FREQUENCIES.forEach(function (f) { if (f[0] === col) picked.push({ to: to, freq: f[2], label: f[0] }); });
    });
  });
  FREQUENCIES.forEach(function (f) {
    asArray_(a[Q.worksWith(f[0])]).forEach(function (label) {
      var to = idFromLabel_(label, 'org');
      if (to && to !== orgId) picked.push({ to: to, freq: f[2], label: f[0] });
    });
  });
  // Typed list: one organization per line, optionally followed by how often ("Sunrise Boston — monthly").
  var missedLines = [];
  String(a[Q.worksWithText] || '').split(/\n|;/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (line) {
    var f = freqFromText_(line);
    var name = line.replace(/\s*[-–—:(,]\s*(every week|weekly|monthly|every month|quarterly|few times( a year)?|a few times a year|yearly|annually|once a year|rarely).*$/i, '').replace(/\s*[-–—:(]\s*$/, '').trim();
    var before = MISSES_.length;
    var to = idFromLabel_(name, 'org');
    if (to && to !== orgId) picked.push({ to: to, freq: f[2], label: f[0] });
    else if (!to) {
      missedLines.push(name);
      logUnmatched_(CUR_.email, CUR_.kind, 'organization', Q.worksWithText, line, MISSES_.length > before ? MISSES_[MISSES_.length - 1].closest : '');
    }
  });
  if (!picked.length) return missedLines.length ? 'works with: none matched (' + missedLines.join(', ') + ' logged for review)' : '';
  // strongest answer wins if an org was ticked twice
  var byTo = {};
  picked.forEach(function (p) { if (!byTo[p.to] || freqWeight_(p.freq) > freqWeight_(byTo[p.to].freq)) byTo[p.to] = p; });
  var sheet = ss_().getSheetByName(TAB.connections);
  var table = readTable_(sheet);
  var mine = table.rows.filter(function (r) { return str_(r.from_org) === orgId; }).map(function (r) { return r._row; });
  mine.sort(function (x, y) { return y - x; }).forEach(function (r) { sheet.deleteRow(r); });
  var now = nowIso_();
  Object.keys(byTo).forEach(function (to) {
    appendObject_(sheet, { from_org: orgId, to_org: to, frequency: byTo[to].freq, updated_at: now, reported_by: orgId });
  });
  return 'works with: ' + Object.keys(byTo).map(function (to) { return to + ' (' + byTo[to].label.toLowerCase() + ')'; }).join(', ') +
    (mine.length ? ' — replaced ' + mine.length + ' earlier answer(s)' : '') +
    (missedLines.length ? ' — not matched, logged for review: ' + missedLines.join(', ') : '');
}

/** "monthly", "every week", "a few times a year", "yearly" → a FREQUENCIES entry (default: a few times a year). */
function freqFromText_(text) {
  var x = String(text).toLowerCase();
  if (/every week|weekly/.test(x)) return FREQUENCIES[0];
  if (/every month|monthly/.test(x)) return FREQUENCIES[1];
  if (/yearly|annual|once a year|rarely/.test(x)) return FREQUENCIES[3];
  return FREQUENCIES[2];
}
function freqWeight_(key) {
  for (var i = 0; i < FREQUENCIES.length; i++) if (FREQUENCIES[i][2] === key) return FREQUENCIES[i][1];
  return 0;
}

/** Free food / who can come (/ help wanted for projects): only what was answered is changed. */
function attendancePatch_(patch, a, isProject) {
  if (a[Q.freeFood]) patch.free_food = a[Q.freeFood] === 'Yes' ? 'TRUE' : 'FALSE';
  if (a[Q.who]) patch.affiliated_only = /affiliated/i.test(a[Q.who]) ? 'TRUE' : 'FALSE';
  if (isProject && a[Q.helpWanted]) patch.help_wanted = a[Q.helpWanted] === 'Yes' ? 'TRUE' : 'FALSE';
}
var WHO_CAN = ['Open to the public', 'Affiliated members only'];
/** Adds the free-food / who-can-come (/ help-wanted) questions if the form doesn't have them yet, just before the link question. */
function addAttendanceQuestions_(form, isProject) {
  var items = form.getItems();
  var has = function (title) { return items.some(function (it) { return it.getTitle() === title; }); };
  var link = items.filter(function (it) { return it.getTitle() === Q.link; })[0];
  var place = function (item) { if (link) form.moveItem(item.getIndex(), link.getIndex()); };
  if (!has(Q.freeFood)) place(form.addMultipleChoiceItem().setTitle(Q.freeFood).setChoiceValues(['Yes', 'No']));
  if (!has(Q.who)) place(form.addMultipleChoiceItem().setTitle(Q.who).setChoiceValues(WHO_CAN)
    .setHelpText('Most things are open to everyone. Choose "Affiliated members only" for something just for your members.'));
  if (isProject && !has(Q.helpWanted)) place(form.addMultipleChoiceItem().setTitle(Q.helpWanted).setChoiceValues(['Yes', 'No']));
}
function saveEvent_(a, t) {
  var patch = {};
  ownerPatch_(patch, a);
  put_(patch, 'name', a[Q.eventName]);
  put_(patch, 'description', a[Q.eventDesc]);
  putTags_(patch, a[Q.tags], a[Q.moreTopics]);
  put_(patch, 'rsvp_link', a[Q.rsvp]);
  attendancePatch_(patch, a, false);
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'recurrence', a[Q.eventRecurrence]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';
  var existing = a[Q.whichEvent] === NEW_EVENT ? null : findById_(t.events, idFromLabel_(a[Q.whichEvent], 'event'));
  locationPatch_(patch, a, existing, t);
  var date = a[Q.eventDate], time = a[Q.eventTime];
  if (date || time) {
    var old = existing ? String(existing.date) : '';
    var d = date || old.slice(0, 10);
    var tm = time || old.slice(11, 16) || '00:00';
    if (d) patch.date = d + 'T' + tm + ':00';
  }
  var endTime = a[Q.eventEndTime];
  if (endTime) {
    var day = (patch.date || (existing ? String(existing.date) : '')).slice(0, 10);
    if (day) patch.end = day + 'T' + endTime + ':00';
  }
  if (!isRemove_(a)) { patch.needs_info = 'FALSE'; patch.verified = 'TRUE'; } // a point person just reviewed it
  // An in-person event with no location can't be placed or found: keep the "needs info" note on it.
  var inPerson = patch.online ? !isTrue_(patch.online) : !(existing && isTrue_(existing.online));
  if (!isRemove_(a) && inPerson && !patch.location && !(existing && str_(existing.location))) patch.needs_info = 'TRUE';
  addMissingColumns_(ss_().getSheetByName(TAB.events), COLS[TAB.events]);
  return upsert_(TAB.events, 'event', a[Q.whichEvent], NEW_EVENT, patch);
}

function saveProject_(a, t) {
  var patch = {};
  ownerPatch_(patch, a);
  put_(patch, 'name', a[Q.projectName]);
  put_(patch, 'description', a[Q.projectDesc]);
  attendancePatch_(patch, a, true);
  if (a[Q.projectStatus]) put_(patch, 'status', lookup_(STATUSES, a[Q.projectStatus]));
  if (asArray_(a[Q.skills]).length) {
    patch.skills_needed = uniq_(asArray_(a[Q.skills]).map(function (s) { return String(s).trim().toLowerCase(); })).join(', ');
  }
  putTags_(patch, a[Q.tags], a[Q.moreTopics]);
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';
  var existing = a[Q.whichProject] === NEW_PROJECT ? null : findById_(t.projects, idFromLabel_(a[Q.whichProject], 'project'));
  locationPatch_(patch, a, existing, t);
  if (!isRemove_(a)) { patch.needs_info = 'FALSE'; patch.verified = 'TRUE'; } // a point person just reviewed it
  addMissingColumns_(ss_().getSheetByName(TAB.projects), COLS[TAB.projects]);
  return upsert_(TAB.projects, 'project', a[Q.whichProject], NEW_PROJECT, patch);
}

function saveAction_(a, t) {
  var patch = {};
  ownerPatch_(patch, a);
  put_(patch, 'name', a[Q.actionName]);
  put_(patch, 'description', a[Q.actionDesc]);
  if (a[Q.actionKind]) put_(patch, 'kind', lookup_(ACTION_KINDS, a[Q.actionKind]));
  if (a[Q.actionUrgency]) put_(patch, 'urgency', lookup_(URGENCIES, a[Q.actionUrgency]));
  put_(patch, 'deadline', a[Q.actionDeadline]);
  if (asArray_(a[Q.skills]).length) {
    patch.skills_needed = uniq_(asArray_(a[Q.skills]).map(function (s) { return String(s).trim().toLowerCase(); })).join(', ');
  }
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';
  if (!isRemove_(a)) { patch.needs_info = 'FALSE'; patch.verified = 'TRUE'; } // a point person just reviewed it
  addMissingColumns_(ss_().getSheetByName(TAB.actions), COLS[TAB.actions]);
  return upsert_(TAB.actions, 'action', a[Q.whichAction], NEW_ACTION, patch);
}

function ownerPatch_(patch, a) {
  if (a[Q.hostOrg] && a[Q.hostOrg] !== NONE) patch.host_org_id = idFromLabel_(a[Q.hostOrg], 'org');
  if (a[Q.coalition] && a[Q.coalition] !== NONE) patch.coalition_id = idFromLabel_(a[Q.coalition], 'coalition');
}

/** Location text + online flag; geocode new/changed in-person locations for the map pin. */
function locationPatch_(patch, a, existing, t) {
  put_(patch, 'location', a[Q.location]);
  if (a[Q.online]) patch.online = a[Q.online] === 'Yes' ? 'TRUE' : 'FALSE';
  var online = patch.online ? isTrue_(patch.online) : existing ? isTrue_(existing.online) : false;
  var loc = patch.location || (existing ? str_(existing.location) : '');
  var changed = patch.location && (!existing || str_(existing.location) !== patch.location);
  var becameInPerson = patch.online === 'FALSE' && existing && isTrue_(existing.online);
  if (!online && loc && (changed || becameInPerson || (existing && !str_(existing.lat)))) {
    var ll = geocode_(loc, placeHint_(patch, existing, t));
    if (ll) { patch.lat = ll[0]; patch.lng = ll[1]; }
  }
}

function saveFeedback_(a, signedInEmail) {
  var sheet = ss_().getSheetByName(TAB.feedback);
  addMissingColumns_(sheet, COLS[TAB.feedback]);
  var email = signedInEmail || a[Q.fbEmail] || '';
  appendObject_(sheet, {
    submitted_at: nowIso_(),
    type: a[Q.fbType] || '',
    area: asArray_(a[Q.fbArea]).join(', '),
    message: a[Q.fbMessage] || '',
    name: a[Q.fbName] || '',
    email: email,
    phone: a[Q.fbPhone] || '',
    ok_to_follow_up: a[Q.fbFollowUp] || '',
    status: 'new',
    notes: '',
  });
  logChange_(email, FORM_NAMES.feedback, 'saved', '', 'feedback', '', a[Q.fbType] || 'feedback',
    String(a[Q.fbMessage] || '').slice(0, 300));
}

/**
 * Add a new row or apply non-empty fields to an existing one.
 * `patch` only holds fields the person actually answered.
 */
function upsert_(tabName, recordType, selection, newLabel, patch) {
  var sheet = ss_().getSheetByName(tabName);
  var table = readTable_(sheet);
  var now = nowIso_();
  var action, id, name, changes = [];

  if (selection === newLabel) {
    action = 'added';
    var base = slug_(patch.name || (recordType === 'organization' ? 'new org' : 'new ' + recordType));
    if (recordType === 'event') base = 'ev_' + base;
    if (recordType === 'project') base = 'pr_' + base;
    if (recordType === 'action') base = 'ac_' + base;
    id = uniqueId_(base.slice(0, 40), table.rows);
    var row = { id: id, last_activity: now };
    if (recordType === 'project' && !patch.status) row.status = 'active';
    if (recordType === 'action' && !patch.kind) row.kind = 'task';
    if (!patch.name) { row.hidden = 'TRUE'; changes.push('hidden until it has a name'); }
    if ((recordType === 'event' || recordType === 'project' || recordType === 'action') && !patch.host_org_id && !patch.coalition_id) {
      changes.push('⚠ no organization or coalition picked — it will not show on the map until one is set');
    }
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; changes.push(k + ': ' + patch[k]); });
    appendObject_(sheet, row);
    name = patch.name || '(no name yet)';
  } else {
    id = idFromLabel_(selection, recordType === 'organization' ? 'org' : recordType);
    var rec = findById_(table.rows, id);
    if (!rec) return { action: 'not found', type: recordType, id: id, name: selection, changes: JSON.stringify(patch) };
    name = patch.name || rec.name;
    var updates = {};
    Object.keys(patch).forEach(function (k) {
      if (table.headers.indexOf(k) === -1) return;
      var oldV = rec[k] === undefined || rec[k] === null ? '' : String(rec[k]);
      if (oldV !== String(patch[k])) {
        updates[k] = patch[k];
        changes.push(k + ': ' + (oldV || '∅') + ' → ' + patch[k]);
      }
    });
    action = isTrue_(patch.hidden) ? 'removed' : changes.length ? 'updated' : 'no changes';
    if (changes.length) {
      updates.last_activity = now;
      writeFields_(sheet, table.headers, rec._row, updates);
    }
  }
  return { action: action, type: recordType, id: id, name: name, changes: changes.join('\n') };
}

function logChange_(email, form, status, flag, type, id, name, changes) {
  var sheet = ss_().getSheetByName(TAB.log);
  appendObject_(sheet, {
    timestamp: nowIso_(), email: email || '', form: form, status: status, flag: flag || '',
    record_type: type, record_id: id || '', record_name: name || '', changes: changes || '',
  });
  if (flag && /^(UNAUTHORIZED|NO EMAIL)/.test(flag)) {
    var row = sheet.getLastRow();
    sheet.getRange(row, 1, 1, COLS[TAB.log].length).setBackground('#fde68a');
  }
}

// ---------------------------------------------------------------- data.json endpoint
/** Deploy → New deployment → Web app (Execute as: me, Who has access: Anyone). */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.verify) {
    return HtmlService.createHtmlOutput('<p style="font:16px system-ui;max-width:520px;margin:48px auto">' +
      confirmVerification_(String(p.verify)).replace(/[<>&]/g, '') + '</p>').setTitle('MA Climate Organization Map');
  }
  // The social justice groups live in their own spreadsheet and are only fetched when someone switches them on.
  var data = p.feed === 'social-justice' ? socialJusticeData_() : buildDataFile_(readAll_(), nowIso_());
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Pure transform: sheet rows → the DataFile shape the site reads (src/types.ts).
 * Kept free of Apps Script calls so it can be tested in Node.
 */
function buildDataFile_(t, generatedAt) {
  var visible = function (r) { return r.id && !isTrue_(r.hidden); };
  var str = str_;
  var extra = function (obj, src, keys) {
    keys.forEach(function (k) {
      var v = src[k];
      if (k === 'topic_tags') { var l = list_(v); if (l.length) obj[k] = l; return; }
      if (k === 'online' || k === 'remote' || k === 'needs_info' || k === 'verified' || k === 'free_food' || k === 'affiliated_only') { if (isTrue_(v)) obj[k] = true; return; }
      if (k === 'help_wanted') { if (str(v)) obj[k] = isTrue_(v); return; } // blank = yes, so only an explicit answer is kept
      if (k === 'lat' || k === 'lng') { if (str(v) && !isNaN(Number(v))) obj[k] = Number(v); return; }
      if (str(v)) obj[k] = str(v);
    });
    return obj;
  };

  var coalitionIds = {};
  t.coalitions.forEach(function (c) { if (c.id) coalitionIds[c.id] = true; });

  var visibleOrgs = t.orgs.filter(visible);
  var orgs = visibleOrgs.map(function (o) {
    var org = extra({
      id: str(o.id), name: str(o.name), type: str(o.type), geographic_focus: str(o.geographic_focus),
      description: str(o.description),
      coalition_ids: list_(o.coalition_ids).filter(function (id) { return coalitionIds[id]; }),
      lat: Number(o.lat), lng: Number(o.lng), last_activity: str(o.last_activity),
    }, o, ['abbrev', 'website', 'logo', 'public_contact', 'topic_tags', 'remote']);
    var prof = {};
    PROFILE_BOOL.forEach(function (k) { if (str(o[k])) prof[k] = isTrue_(o[k]); });
    PROFILE_NUM.forEach(function (k) { if (str(o[k]) && !isNaN(Number(o[k]))) prof[k] = Number(o[k]); });
    PROFILE_STR.forEach(function (k) { if (str(o[k])) prof[k] = str(o[k]); });
    if (Object.keys(prof).length) org.profile = prof;
    var w = {};
    list_(o.coalition_weights).forEach(function (pair) {
      var kv = pair.split(':');
      if (kv.length === 2 && !isNaN(Number(kv[1]))) w[kv[0].trim()] = Number(kv[1]);
    });
    if (Object.keys(w).length) org.coalition_weights = w;
    return org;
  });
  var orgById = {};
  orgs.forEach(function (o) { orgById[o.id] = o; });

  // Projects/events belong to a coalition (coalition_id) or, without one, to their host org.
  // Items whose coalition and org are both missing or hidden are left out.
  var home = function (r) {
    if (str(r.coalition_id) && coalitionIds[str(r.coalition_id)]) return 'c:' + str(r.coalition_id);
    if (orgById[str(r.host_org_id)]) return 'o:' + str(r.host_org_id);
    return null;
  };
  var group = function (rows, mapFn) {
    var by = {};
    rows.filter(visible).forEach(function (r) {
      var h = home(r);
      if (!h) return;
      (by[h] = by[h] || []).push(mapFn(r));
    });
    return by;
  };
  var place = ['location', 'online', 'lat', 'lng'];
  var projects = group(t.projects, function (p) {
    return extra({ id: str(p.id), name: str(p.name), description: str(p.description),
      status: str(p.status) || 'active', skills_needed: list_(p.skills_needed) },
      p, ['host_org_id', 'topic_tags', 'link', 'public_contact', 'needs_info', 'verified', 'free_food', 'affiliated_only', 'help_wanted'].concat(place));
  });
  var events = group(t.events, function (e) {
    return extra({ id: str(e.id), name: str(e.name), date: str(e.date), location: str(e.location) },
      e, ['end', 'description', 'recurrence', 'needs_info', 'verified', 'host_org_id', 'topic_tags', 'link', 'rsvp_link', 'public_contact', 'online', 'lat', 'lng', 'free_food', 'affiliated_only']);
  });
  var actions = group(t.actions, function (a) {
    return extra({ id: str(a.id), kind: str(a.kind) || 'task', name: str(a.name),
      skills_needed: list_(a.skills_needed), deadline: str(a.deadline) || null },
      a, ['urgency', 'description', 'link', 'needs_info', 'verified', 'host_org_id']);
  });

  var coalitions = t.coalitions.filter(function (c) { return c.id; }).map(function (c) {
    var members = orgs.filter(function (o) { return o.coalition_ids.indexOf(c.id) !== -1; })
      .map(function (o) { return o.id; });
    return {
      id: str(c.id), name: str(c.name), abbrev: str(c.abbrev), description: str(c.description),
      focus_tags: list_(c.focus_tags), geographic_scope: str(c.geographic_scope), color: str(c.color),
      lat: Number(c.lat), lng: Number(c.lng), member_ids: members, member_count: members.length,
      projects: projects['c:' + c.id] || [], events: events['c:' + c.id] || [], actions: actions['c:' + c.id] || [],
      last_activity: str(c.last_activity),
      logo: str(c.logo) || undefined, website: str(c.website) || undefined,
    };
  });

  orgs.forEach(function (o) {
    if (projects['o:' + o.id]) o.projects = projects['o:' + o.id];
    if (events['o:' + o.id]) o.events = events['o:' + o.id];
    if (actions['o:' + o.id]) o.actions = actions['o:' + o.id];
  });

  var edges = [];
  coalitions.forEach(function (c) { c.member_ids.forEach(function (m) { edges.push({ source: c.id, target: m }); }); });

  // Org-to-org links: one per pair; the more frequent answer wins; both reporters kept.
  var pairs = {};
  (t.connections || []).forEach(function (r) {
    var a = str(r.from_org), b = str(r.to_org), f = str(r.frequency);
    if (!orgById[a] || !orgById[b] || a === b || !freqWeight_(f)) return;
    var key = a < b ? a + '|' + b : b + '|' + a;
    var cur = pairs[key];
    if (!cur) cur = pairs[key] = { source: a < b ? a : b, target: a < b ? b : a, frequency: f, weight: freqWeight_(f), reported_by: [] };
    if (freqWeight_(f) > cur.weight) { cur.weight = freqWeight_(f); cur.frequency = f; }
    if (cur.reported_by.indexOf(a) === -1) cur.reported_by.push(a);
  });
  var orgLinks = Object.keys(pairs).sort().map(function (k) { return pairs[k]; });

  return { generated_at: generatedAt, coalitions: coalitions, organizations: orgs, edges: edges, org_links: orgLinks };
}

// ---------------------------------------------------------------- sheet helpers
/** Form-submit triggers have no "active" spreadsheet, so open it by the id saved at build time. */
function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function readAll_() {
  return readAllFrom_(ss_());
}

/** Every public tab of a spreadsheet laid out like this one (also the social justice spreadsheet). */
function readAllFrom_(ss) {
  var r = function (name) { var sh = ss.getSheetByName(name); return sh ? readTable_(sh).rows : []; };
  return {
    coalitions: r(TAB.coalitions), orgs: r(TAB.orgs), connections: r(TAB.connections), projects: r(TAB.projects),
    events: r(TAB.events), actions: r(TAB.actions), editors: r(TAB.editors), topics: r(TAB.topics),
  };
}

function readTable_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    var blank = true;
    headers.forEach(function (h, j) {
      var v = values[i][j];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
      o[h] = v;
      if (v !== '' && v !== null && v !== false) blank = false;
    });
    if (!blank) rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function appendObject_(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  var range = sheet.getRange(lastDataRow_(sheet) + 1, 1, 1, headers.length);
  range.setNumberFormats([row.map(function (v) { return typeof v === 'number' ? '0.000000' : '@'; })]);
  range.setValues([row]);
}

/** Last row with content (checkbox columns pre-filled with FALSE don't count). */
function lastDataRow_(sheet) {
  var last = sheet.getLastRow();
  if (last <= 1) return last;
  var values = sheet.getRange(1, 1, last, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) if (values[i][0] !== '' && values[i][0] !== null) return i + 1;
  return 1;
}

function writeFields_(sheet, headers, rowNum, updates) {
  Object.keys(updates).forEach(function (k) {
    var col = headers.indexOf(k);
    if (col === -1) return;
    var cell = sheet.getRange(rowNum, col + 1);
    cell.setNumberFormat(typeof updates[k] === 'number' ? '0.000000' : '@');
    cell.setValue(updates[k]);
  });
}

function writeLinks_() {
  var ss = ss_();
  var sheet = ss.getSheetByName(TAB.start);
  var props = PropertiesService.getScriptProperties();
  var start = findRow_(sheet, 'Form links');
  if (!start) return;
  var rows = [
    ['Update your organization', 'FORM_ORG'],
    ['Add or edit an event', 'FORM_EVENT'],
    ['Add or edit a project', 'FORM_PROJECT'],
    ['Add or edit an action or volunteer opportunity', 'FORM_ACTION'],
    ['Send feedback', 'FORM_FEEDBACK'],
  ].map(function (r) {
    var id = props.getProperty(r[1]);
    if (!id) return [r[0], '(not built)'];
    var f = openForm_(id);
    var link = f.getPublishedUrl();
    try { link = f.shortenFormUrl(link); } catch (e) { /* keep the long link */ }
    return [r[0], link + '    (edit: ' + f.getEditUrl() + ')'];
  });
  rows.push(['', '']);
  rows.push(['For the site: paste into src/forms.config.ts', JSON.stringify(siteFormConfig_())]);
  sheet.getRange(start + 1, 1, rows.length, 2).setValues(rows);
}

/**
 * Form URLs plus the "entry.N" ids the site's + button uses to pre-fill a form
 * (e.g. opening the org form with that org already picked).
 */
function siteFormConfig_() {
  var props = PropertiesService.getScriptProperties();
  var entry = function (form, title) {
    var items = form.getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].getTitle() !== title) continue;
      // Dropdowns became typed text boxes ("Switch forms to typed answers"), so handle both.
      var it = items[i];
      var type = it.getType();
      var resp;
      if (type === FormApp.ItemType.LIST) { var li = it.asListItem(); resp = li.createResponse(li.getChoices()[0].getValue()); }
      else if (type === FormApp.ItemType.TEXT) resp = it.asTextItem().createResponse('x');
      else if (type === FormApp.ItemType.PARAGRAPH_TEXT) resp = it.asParagraphTextItem().createResponse('x');
      else if (type === FormApp.ItemType.CHECKBOX) { var cb = it.asCheckboxItem(); resp = cb.createResponse([cb.getChoices()[0].getValue()]); }
      else if (type === FormApp.ItemType.MULTIPLE_CHOICE) { var mc = it.asMultipleChoiceItem(); resp = mc.createResponse(mc.getChoices()[0].getValue()); }
      else return '';
      var url = form.createResponse().withItemResponse(resp).toPrefilledUrl();
      var m = /[?&](entry\.\d+)=/.exec(url);
      return m ? m[1] : '';
    }
    return '';
  };
  var one = function (key, fields) {
    var id = props.getProperty(key);
    if (!id) return { url: '' };
    var f = openForm_(id);
    var out = { url: f.getPublishedUrl() };
    Object.keys(fields || {}).forEach(function (k) { out[k] = entry(f, fields[k]); });
    return out;
  };
  return {
    org: one('FORM_ORG', { orgEntry: Q.whichOrg }),
    event: one('FORM_EVENT', { hostOrgEntry: Q.hostOrg, coalitionEntry: Q.coalition, itemEntry: Q.whichEvent }),
    project: one('FORM_PROJECT', { hostOrgEntry: Q.hostOrg, coalitionEntry: Q.coalition, itemEntry: Q.whichProject }),
    action: one('FORM_ACTION', { hostOrgEntry: Q.hostOrg, coalitionEntry: Q.coalition, itemEntry: Q.whichAction }),
    feedback: one('FORM_FEEDBACK'),
  };
}

function showLinks() {
  writeLinks_();
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not deployed yet */ }
  SpreadsheetApp.getUi().alert('Form links (and the config for the site\'s + button) are on the Start Here tab.\n\n' +
    (url ? 'Live data URL: ' + url : 'Live data URL: not deployed yet (Deploy → New deployment → Web app).'));
}

function findRow_(sheet, text) {
  var v = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === text) return i + 1;
  return 0;
}

var VAGUE_PLACE = /^(statewide|national|nationwide|new england|northeast|online|remote|zoom|virtual|massachusetts|ma)$/i;

/** Drop the parts of a location a map can't use: "2nd floor", "Room 104", "Suite B", "basement", "lobby". */
function cleanPlace_(place) {
  return String(place || '')
    .replace(/\b\d+(st|nd|rd|th)\s+(floor|fl\.?)\b/gi, '')
    .replace(/\b(floor|fl\.?)\s*\d+\b/gi, '')
    .replace(/\b(room|rm\.?|suite|ste\.?|unit|apt\.?)\s*#?\s*[\w-]+\b/gi, '')
    .replace(/\b(basement|lobby|ground floor|upstairs|downstairs|main hall)\b/gi, '')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s{2,}/g, ' ');
}

/** Rough box around Massachusetts; a pin outside it is a wrong match (e.g. a hall name found in another state). */
function inMass_(lat, lng) {
  return lat >= 41.18 && lat <= 42.89 && lng >= -73.51 && lng <= -69.85;
}

/** The town to add when an event or project location has none: its host org's HQ or town, else its coalition's area. */
function placeHint_(patch, existing, t) {
  if (!t) return '';
  var orgId = patch.host_org_id || (existing ? str_(existing.host_org_id) : '');
  var coId = patch.coalition_id || (existing ? str_(existing.coalition_id) : '');
  var org = orgId && t.orgs ? findById_(t.orgs, orgId) : null;
  var co = coId && t.coalitions ? findById_(t.coalitions, coId) : null;
  var picks = [org && str_(org.hq_address), org && str_(org.geographic_focus), co && str_(co.geographic_scope)];
  for (var i = 0; i < picks.length; i++) if (picks[i] && !VAGUE_PLACE.test(picks[i]) && !REMOTE_WORDS.test(picks[i])) return picks[i];
  return '';
}

/** The queries to try, best first: a location with no town gets the hint's town added. */
function geocodeQueries_(place, hint) {
  place = cleanPlace_(place);
  if (!place || VAGUE_PLACE.test(place)) return [];
  var withMa = function (s) { return /\b(MA|Massachusetts)\b/i.test(s) ? s : s + ', Massachusetts'; };
  var qs = [];
  var hasTown = /,/.test(place) || /\b\d{5}\b/.test(place);
  if (hint && !hasTown) qs.push(withMa(place + ', ' + hint));
  qs.push(withMa(place));
  if (hint && hasTown) qs.push(withMa(place + ', ' + hint));
  return qs;
}

function geocode_(place, hint) {
  var qs = geocodeQueries_(place, hint);
  for (var i = 0; i < qs.length; i++) {
    try {
      var res = Maps.newGeocoder().setRegion('us').geocode(qs[i]);
      if (res.status !== 'OK') continue;
      for (var j = 0; j < res.results.length; j++) {
        var loc = res.results[j].geometry.location;
        if (inMass_(loc.lat, loc.lng)) return [Math.round(loc.lat * 1e6) / 1e6, Math.round(loc.lng * 1e6) / 1e6];
      }
    } catch (e) { /* try the next query */ }
  }
  return null;
}

// ---------------------------------------------------------------- small utils (pure)
/** Turn a Google Drive share link into a URL an <img> can display. */
function driveImage_(url) {
  var m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/.exec(url);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400' : url;
}
function put_(obj, key, v) {
  if (v === undefined || v === null) return;
  var s = String(v).trim();
  if (s) obj[key] = s;
}
/** Topic tags = ticked boxes + any typed topics that match the Topics list. Typed topics that match nothing
 *  go to the Unmatched Input tab (no limit on how many topics a form can carry). */
function putTags_(patch, v, typed) {
  var arr = asArray_(v).map(slug_).filter(Boolean);
  if (str_(typed)) {
    var r = resolveTopics_(typed, readAll_());
    arr = arr.concat(r.slugs);
    r.missed.forEach(function (m) { logUnmatched_(CUR_.email, CUR_.kind, 'topic', Q.moreTopics, m.typed, m.closest); });
  }
  if (arr.length) patch.topic_tags = uniq_(arr).join(', ');
}
function isRemove_(a) { return asArray_(a[Q.remove]).indexOf(REMOVE_YES) !== -1; }
function asArray_(v) { return v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]; }
function str_(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function list_(v) {
  if (Array.isArray(v)) return v;
  return String(v === undefined || v === null ? '' : v).split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
}
function flat_(arrs) { return [].concat.apply([], arrs); }
function uniq_(arr) { var seen = {}; return arr.filter(function (x) { return seen[x] ? false : (seen[x] = true); }); }
function isTrue_(v) { return v === true || /^(true|yes|1|x)$/i.test(String(v === undefined || v === null ? '' : v).trim()); }
/** Row id for a dropdown choice of the given kind. Old "[id]" labels still work. */
function idFromLabel_(label, kind) {
  var text = String(label || '').trim();
  var m = /\[([^\]]+)\]\s*$/.exec(text);
  if (m) return m[1];
  if (!text || !kind) return '';
  if (!LABEL_INDEX_) LABEL_INDEX_ = buildLabelIndex_(readAll_());
  if (LABEL_INDEX_.byLabel[kind][text]) return LABEL_INDEX_.byLabel[kind][text];
  // Typed instead of picked: match the text against the list (typos, short names, "the" etc.).
  if (LABEL_INDEX_.cands && LABEL_INDEX_.cands[kind]) {
    var hit = matchTyped_(text, LABEL_INDEX_.cands[kind]);
    if (hit.id) return hit.id;
    MISSES_.push({ kind: kind, typed: text, closest: hit.closest.join(' | ') });
  }
  return '';
}
function findById_(rows, id) { for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) return rows[i]; return null; }
function lookup_(pairs, label) { for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === label) return pairs[i][1]; return slug_(label); }
function slug_(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function humanize_(slug) { var s = String(slug).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
function capitalize_(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
function byName_(a, b) { return String(a.name).localeCompare(String(b.name)); }
function uniqueId_(base, rows) {
  var taken = {};
  rows.forEach(function (r) { taken[String(r.id)] = true; });
  var id = base || 'item', n = 2;
  while (taken[id]) id = base + '_' + n++;
  return id;
}
function jitter_(x, r) { r = r || 0.03; return Math.round((x + (Math.random() - 0.5) * r * 2) * 1e5) / 1e5; }
function shortDate_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}
function nowIso_() { return new Date().toISOString(); }
