/**
 * MA Climate Coalition Map — forms + spreadsheet backend
 * ---------------------------------------
 * Paste this whole file into the MA Climate Coalition Map data Google Sheet:
 *   Extensions → Apps Script → replace Code.gs → Save.
 * Then reload the sheet and run  MA Climate Coalition Map → Set up sheet + forms  once.
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
  feedback: 'Feedback',
  log: 'Change Log',
};

var NEW_ORG = '➕ Add a new organization';
var NEW_EVENT = '➕ Add a new event';
var NEW_PROJECT = '➕ Add a new project';
var NONE = '— None —';
var REMOVE_YES = 'Yes, take it off the map';
var REMOTE_YES = "We're remote / have no public location — don't show a pin"; // older forms' checkbox
/** Typed into the HQ question instead of an address: no public location, no pin. */
var REMOTE_WORDS = /^\s*(remote|none|no public location|n\/?a)\s*\.?\s*$/i;
var ORG_HELP = {
  desc: 'What your organization does, who you serve, your current campaigns, and what you could use help with. Write as much as you like: the map shows all of it, and more detail helps it suggest organizations doing similar work.',
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
  orgDesc: 'Short description',
  orgCoalitions: 'Coalitions you belong to',
  youth: 'Is your organization youth-serving?',
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
  // project
  whichProject: 'Which project is this about?',
  projectName: 'Project name',
  projectDesc: 'Project description',
  projectStatus: 'Status',
  skills: 'Skills or help needed',
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
var STATUSES = [['Active', 'active'], ['Planning', 'planning'], ['Completed', 'completed']];
var BASE_TAGS = ['clean_energy', 'climate_policy', 'environmental_justice', 'grassroots',
  'green_buildings', 'health', 'housing', 'just_transition', 'school_clubs', 'youth_serving'];
var BASE_SKILLS = ['data entry', 'event logistics', 'facilitation', 'fundraising', 'graphic design',
  'legal', 'outreach', 'photography', 'public speaking', 'research', 'social media', 'spanish',
  'portuguese', 'translation', 'video editing', 'writing'];

/** Org profile fields from the MA Climate Coalition Map (org.profile in data.json). Admin-only: no form edits them. */
var PROFILE_BOOL = ['youth_serving', 'school_club', 'hub', 'inactive', 'paid_staff'];
var PROFILE_NUM = ['ej_focus', 'grassroots', 'policy_expertise', 'in_building'];
var PROFILE_STR = ['membership_size', 'c3_tier', 'c4_tier', 'geo_precision'];
var PROFILE_COLS = PROFILE_BOOL.concat(PROFILE_NUM, PROFILE_STR);

var COLS = {
  'Coalitions': ['id', 'name', 'abbrev', 'description', 'focus_tags', 'geographic_scope', 'color', 'lat', 'lng', 'last_activity'],
  'Organizations': ['id', 'name', 'abbrev', 'type', 'geographic_focus', 'description', 'coalition_ids', 'topic_tags',
    'website', 'logo', 'public_contact', 'hq_address', 'remote', 'lat', 'lng', 'last_activity', 'hidden',
    'coalition_weights'].concat(PROFILE_COLS),
  'Connections': ['from_org', 'to_org', 'frequency', 'updated_at', 'reported_by'],
  'Projects': ['id', 'coalition_id', 'host_org_id', 'name', 'description', 'status', 'skills_needed', 'topic_tags', 'link',
    'public_contact', 'location', 'online', 'lat', 'lng', 'last_activity', 'hidden'],
  'Events': ['id', 'coalition_id', 'host_org_id', 'name', 'description', 'date', 'location', 'online', 'lat', 'lng',
    'topic_tags', 'link', 'public_contact', 'last_activity', 'hidden', 'end'],
  'Actions': ['id', 'coalition_id', 'kind', 'name', 'urgency', 'skills_needed', 'deadline', 'hidden'],
  'Editors': ['email', 'role', 'org_ids', 'coalition_ids', 'name', 'notes'],
  'Needs Review': ['submitted_at', 'email', 'form', 'record_type', 'record', 'reason', 'summary', 'approve', 'status',
    'reviewed_at', 'payload'],
  'Feedback': ['submitted_at', 'type', 'area', 'message', 'name', 'email', 'ok_to_follow_up', 'status', 'notes', 'phone'],
  'Change Log': ['timestamp', 'email', 'form', 'status', 'flag', 'record_type', 'record_id', 'record_name', 'changes'],
};

var START_TEXT = [
  ['MA Climate Coalition Map data', ''],
  ['', ''],
  ['This spreadsheet is the source of truth for the MA Climate Coalition Map. The forms write into it; the site reads from it.', ''],
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
    .createMenu('MA Climate Coalition Map')
    .addItem('Set up sheet + forms (run once)', 'setUp')
    .addItem('Refresh form dropdowns', 'refreshDropdowns')
    .addItem('Show form + data links', 'showLinks')
    .addToUi();
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
      lat: num6(p.lat), lng: num6(p.lng) });
  };
  var event = function (e, coalitionId, hostId) {
    push('Events', { id: e.id, coalition_id: coalitionId, host_org_id: hostId || e.host_org_id, name: e.name,
      description: e.description, date: e.date, end: e.end, location: e.location, online: bool(e.online),
      lat: num6(e.lat), lng: num6(e.lng), topic_tags: L(e.topic_tags), link: e.link, public_contact: e.public_contact });
  };
  d.coalitions.forEach(function (c) {
    push('Coalitions', { id: c.id, name: c.name, abbrev: c.abbrev, description: c.description, focus_tags: L(c.focus_tags),
      geographic_scope: c.geographic_scope, color: c.color, lat: c.lat, lng: c.lng, last_activity: c.last_activity });
    (c.projects || []).forEach(function (p) { project(p, c.id, ''); });
    (c.events || []).forEach(function (e) { event(e, c.id, ''); });
    (c.actions || []).forEach(function (a) {
      push('Actions', { id: a.id, coalition_id: c.id, kind: a.kind, name: a.name, urgency: a.urgency,
        skills_needed: L(a.skills_needed), deadline: a.deadline });
    });
  });
  d.organizations.forEach(function (o) {
    (o.projects || []).forEach(function (p) { project(p, '', o.id); });
    (o.events || []).forEach(function (e) { event(e, '', o.id); });
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
    { key: 'FORM_ORG', title: 'MA Climate Coalition Map — Update your organization', build: buildOrgForm_, tab: 'Responses: Organizations', signIn: true },
    { key: 'FORM_EVENT', title: 'MA Climate Coalition Map — Add or edit an event', build: buildEventForm_, tab: 'Responses: Events', signIn: true },
    { key: 'FORM_PROJECT', title: 'MA Climate Coalition Map — Add or edit a project', build: buildProjectForm_, tab: 'Responses: Projects', signIn: true },
    { key: 'FORM_FEEDBACK', title: 'MA Climate Coalition Map — Send feedback', build: buildFeedbackForm_, tab: 'Responses: Feedback', signIn: true },
  ];

  specs.forEach(function (s) {
    if (props.getProperty(s.key) && formExists_(props.getProperty(s.key))) {
      // Already built: just keep its title current (e.g. after a rename).
      var existing = FormApp.openById(props.getProperty(s.key));
      if (existing.getTitle() !== s.title) existing.setTitle(s.title);
      if (s.key === 'FORM_ORG') upgradeOrgForm_(existing);
      if (s.key === 'FORM_FEEDBACK') upgradeFeedbackForm_(existing);
      if (s.key === 'FORM_EVENT') upgradeEventForm_(existing);
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
  writeLinks_();
  SpreadsheetApp.getUi().alert(
    (dataLoaded === true ? 'Loaded the current map data into the tabs.\n\n' : '') +
    (built.length
      ? 'Built and shared with the core team:\n• ' + built.join('\n• ') + '\n\nLinks are on the Start Here tab.'
      : 'All four forms already exist. Links are on the Start Here tab.')
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

function header_(form, text) {
  form.setDescription(text);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Thank you! If you are a point-person for this organization, your changes are on their way to the map. Otherwise the map team will review them.');
}

function addTags_(form) {
  form.addCheckboxItem().setTitle(Q.tags)
    .setHelpText('Pick any that fit, or add your own under "Other". Answering replaces the current tags.')
    .setChoiceValues(BASE_TAGS.map(humanize_)).showOtherOption(true);
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
  form.addListItem().setTitle(Q.hostOrg).setChoiceValues([NONE])
    .setHelpText('The organization running the ' + what + '. Pick an organization, a coalition, or both.');
  form.addListItem().setTitle(Q.coalition).setChoiceValues([NONE])
    .setHelpText('If the ' + what + ' is part of a coalition\'s work. Leave as "None" for an organization\'s own ' + what + '.');
}

function buildOrgForm_(form) {
  header_(form,
    'Use this form to add your organization to the MA Climate Coalition Map, or to fill in and correct what we already have.\n\n' +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE + '\n\n' + SIGNIN_NOTE);
  addSelector_(form, Q.whichOrg, 'Pick your organization to update it, or choose "' + NEW_ORG + '".', NEW_ORG);
  form.addTextItem().setTitle(Q.orgName).setHelpText('Only if it is new or has changed.');
  form.addTextItem().setTitle(Q.orgAbbrev).setHelpText('e.g. MYCC, BLS YouthCAN');
  addOrgType_(form);
  form.addParagraphTextItem().setTitle(Q.orgDesc).setHelpText(ORG_HELP.desc);
  form.addTextItem().setTitle(Q.orgTown).setHelpText('e.g. Worcester, Cape Cod, Greater Boston, statewide.');
  form.addTextItem().setTitle(Q.orgHq).setHelpText(ORG_HELP.hq);
  form.addCheckboxItem().setTitle(Q.orgCoalitions)
    .setHelpText('If you answer this, check every coalition you are part of — it replaces your current list.')
    .setChoiceValues([NONE]);
  addTags_(form);
  form.addMultipleChoiceItem().setTitle(Q.youth).setChoiceValues(['Yes', 'No']);
  form.addMultipleChoiceItem().setTitle(Q.membership).setChoiceValues(MEMBERSHIP);
  form.addTextItem().setTitle(Q.website);
  form.addTextItem().setTitle(Q.logo)
    .setHelpText('A link to your logo (PNG or JPG) — e.g. from your website, or a Google Drive file shared as "anyone with the link".');
  addPublicContact_(form);
  addPointPerson_(form);

  form.addPageBreakItem().setTitle(WORKS_WITH_PAGE)
    .setHelpText('Which organizations do you work with, and how often? This draws the connections between organizations on the map.');
  addWorksWithGrid_(form);

  form.addPageBreakItem().setTitle('Anything else');
  addRemove_(form, 'organization');
}

var WORKS_WITH_PAGE = 'Who you work with';
var POINT_PERSON_PAGE = 'Point person (private)';

/** Org type as a multiple-choice question so "Other" can be a write-in. */
function addOrgType_(form) {
  return form.addMultipleChoiceItem().setTitle(Q.orgType)
    .setChoiceValues(ORG_TYPES.filter(function (t) { return t[1] !== 'other'; }).map(function (t) { return t[0]; }))
    .showOtherOption(true);
}
var FEEDBACK_TYPES = ["Something's broken", 'Info on the map is wrong or missing', 'Idea or feature request', 'Question'];

/** Who the core team contacts about this org. Private: stored on the Editors tab, never on the map.
 *  Their email can then update this org through the forms. */
function addPointPerson_(form) {
  form.addPageBreakItem().setTitle(POINT_PERSON_PAGE)
    .setHelpText('Who should we contact about your organization? Only the core team sees this; it is never shown on the map. ' +
      'This person can then update your organization\'s info through these forms (they sign in with this email).');
  form.addTextItem().setTitle(Q.pointName);
  form.addTextItem().setTitle(Q.pointEmail)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addTextItem().setTitle(Q.pointPhone);
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
  if (!items.some(function (it) { return it.getTitle() === Q.pointEmail; })) {
    var before = items.filter(function (it) { return it.getTitle() === WORKS_WITH_PAGE; })[0];
    var at = before ? before.getIndex() : null;
    var n0 = form.getItems().length;
    addPointPerson_(form);
    if (at !== null) {
      var added = form.getItems().slice(n0); // page break + 3 questions, in order
      added.forEach(function (it, k) { form.moveItem(it.getIndex(), at + k); });
    }
    items = form.getItems();
  }
  var typeItem = items.filter(function (it) { return it.getTitle() === Q.orgType; })[0];
  if (typeItem && typeItem.getType() === FormApp.ItemType.LIST) {
    var typeAt = typeItem.getIndex();
    form.deleteItem(typeItem);
    form.moveItem(addOrgType_(form).getIndex(), typeAt);
    items = form.getItems();
  }
  var hasGrid = items.some(function (it) { return it.getTitle() === Q.worksWithGrid; });
  var oldTitles = FREQUENCIES.map(function (f) { return Q.worksWith(f[0]); });
  if (!hasGrid) {
    var page = items.filter(function (it) { return it.getTitle() === WORKS_WITH_PAGE; })[0];
    var grid = addWorksWithGrid_(form);
    if (page) form.moveItem(grid.getIndex(), page.getIndex() + 1);
    var pageItem = page ? page.asPageBreakItem() : null;
    if (pageItem) pageItem.setHelpText('Which organizations do you work with, and how often? This draws the connections between organizations on the map.');
  }
  form.getItems().forEach(function (it) {
    var title = it.getTitle();
    if (oldTitles.indexOf(title) !== -1 || title === Q.orgRemote) form.deleteItem(it);
    else if (title === Q.orgDesc) it.setHelpText(ORG_HELP.desc);
    else if (title === Q.orgHq) it.setHelpText(ORG_HELP.hq);
  });
}

/** Older event forms had no end time; add it right after the start time (safe to run again). */
function upgradeEventForm_(form) {
  var items = form.getItems();
  if (items.some(function (it) { return it.getTitle() === Q.eventEndTime; })) return;
  var start = items.filter(function (it) { return it.getTitle() === Q.eventTime; })[0];
  var end = form.addTimeItem().setTitle(Q.eventEndTime);
  if (start) form.moveItem(end.getIndex(), start.getIndex() + 1);
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
  addLocation_(form, 'event');
  addTags_(form);
  form.addTextItem().setTitle(Q.link);
  addPublicContact_(form);
  addRemove_(form, 'event');
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
var FEEDBACK_DESC = 'Tell us what is working, what is broken, or what you wish the MA Climate Coalition Map did. ' +
  "You'll be asked to sign in with Google so we can follow up; only your feedback is required.";

function buildFeedbackForm_(form) {
  form.setDescription(FEEDBACK_DESC);
  form.setConfirmationMessage('Thank you — we read every one.');
  form.addMultipleChoiceItem().setTitle(Q.fbType).setChoiceValues(FEEDBACK_TYPES).showOtherOption(true);
  form.addCheckboxItem().setTitle(Q.fbArea).setChoiceValues([
    'Network map', 'Geographic map', 'Organizations list', 'Events list', 'Projects list', 'Suggested connections',
    'The forms', 'General']);
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

  var tags = uniq_(BASE_TAGS.concat(
    flat_(t.coalitions.map(function (c) { return list_(c.focus_tags); })),
    flat_(t.orgs.map(function (r) { return list_(r.topic_tags); })),
    flat_(t.events.map(function (r) { return list_(r.topic_tags); })),
    flat_(t.projects.map(function (r) { return list_(r.topic_tags); }))
  )).sort().map(humanize_);
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
  ['FORM_EVENT', 'FORM_PROJECT'].forEach(function (k) {
    set(k, Q.hostOrg, [NONE].concat(orgLabels));
    set(k, Q.coalition, [NONE].concat(coalitionLabels));
  });
  // The org form asks "youth-serving?" as its own question, so it isn't offered as a tag there too.
  set('FORM_ORG', Q.tags, tags.filter(function (x) { return x !== humanize_('youth_serving'); }));
  ['FORM_EVENT', 'FORM_PROJECT'].forEach(function (k) { set(k, Q.tags, tags); });
  set('FORM_PROJECT', Q.skills, skills);
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
};

/** { byId: {kind: {id: label}}, byLabel: {kind: {label: id}} } for all rows (hidden ones too). */
function buildLabelIndex_(t) {
  var tables = { org: t.orgs, coalition: t.coalitions, event: t.events, project: t.projects };
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
  return idx;
}
var LABEL_INDEX_ = null;

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
  var target = describeTarget_(kind, a, t);
  var access = approver ? { ok: true } : authorize_(email, kind, a, target, t);
  if (!access.ok) {
    queueForReview_(kind, a, email, target, access.reason);
    return;
  }
  var result = kind === 'org' ? saveOrg_(a, t) : kind === 'event' ? saveEvent_(a, t) : saveProject_(a, t);
  var flag = approver ? 'approved by ' + approver : '';
  logChange_(email, FORM_NAMES[kind], result.action, flag, result.type, result.id, result.name, result.changes);
  // An approved new org: its submitter becomes that org's point-person.
  if (approver && kind === 'org' && target.isNew && email) addEditorOrg_(email, result.id);
  if (kind === 'org' && result.id && result.action !== 'not found') savePointPerson_(result.id, a);
  refreshDropdowns();
}

var FORM_NAMES = { org: 'Update your organization', event: 'Add or edit an event', project: 'Add or edit a project', feedback: 'Send feedback' };

/** Which record a submission is about, and who owns it now / after the change. */
function describeTarget_(kind, a, t) {
  var sel = kind === 'org' ? a[Q.whichOrg] : kind === 'event' ? a[Q.whichEvent] : a[Q.whichProject];
  var isNew = sel === NEW_ORG || sel === NEW_EVENT || sel === NEW_PROJECT;
  var id = isNew ? '' : idFromLabel_(sel, kind);
  var rows = kind === 'org' ? t.orgs : kind === 'event' ? t.events : t.projects;
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

/** Point-person answers → an Editors row for that email with this org added (name/phone kept up to date). */
function savePointPerson_(orgId, a) {
  var email = String(a[Q.pointEmail] || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) return;
  var name = String(a[Q.pointName] || '').trim();
  var phone = String(a[Q.pointPhone] || '').trim();
  var sheet = ss_().getSheetByName(TAB.editors);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return String(r.email).toLowerCase() === email; })[0];
  var note = phone ? 'phone: ' + phone : '';
  if (row) {
    var up = { org_ids: uniq_(list_(row.org_ids).concat([orgId])).join(', ') };
    if (name) up.name = name;
    if (note) {
      var rest = str_(row.notes).split(/;\s*/).filter(function (x) { return x && x.indexOf('phone: ') !== 0; });
      up.notes = [note].concat(rest).join('; ');
    }
    writeFields_(sheet, table.headers, row._row, up);
  } else {
    appendObject_(sheet, { email: email, role: 'editor', org_ids: orgId, name: name, notes: note ? note + '; point person from the org form' : 'point person from the org form' });
  }
}

function queueForReview_(kind, a, email, target, reason) {
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
      MailApp.sendEmail(ADMIN_EMAILS.join(','), 'MA Climate Coalition Map: submission needs review (' + reason.split(' — ')[0] + ')',
        'From: ' + (email || 'unknown') + '\nForm: ' + FORM_NAMES[kind] + '\nAbout: ' + target.label +
        '\nWhy: ' + reason + '\n\n' + summary + '\n\nReview it on the "Needs Review" tab: ' + ss_().getUrl());
    } catch (err) { /* email quota; the Change Log still has it */ }
  }
}

/** Installable onEdit trigger: ticking "approve" on Needs Review applies the change. */
function onReviewEdit(e) {
  var sheet = e.range.getSheet();
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
    processSubmission_(p.kind, p.answers, p.email, reviewer || 'admin');
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
  if (a[Q.orgType]) put_(patch, 'type', lookup_(ORG_TYPES, a[Q.orgType]));
  put_(patch, 'geographic_focus', a[Q.orgTown]);
  put_(patch, 'description', a[Q.orgDesc]);
  if (asArray_(a[Q.orgCoalitions]).length) {
    patch.coalition_ids = asArray_(a[Q.orgCoalitions]).map(function (l) { return idFromLabel_(l, 'coalition'); }).filter(Boolean).join(', ');
  }
  putTags_(patch, a[Q.tags]);
  put_(patch, 'website', a[Q.website]);
  if (a[Q.logo]) put_(patch, 'logo', driveImage_(String(a[Q.logo]).trim()));
  if (a[Q.youth]) patch.youth_serving = a[Q.youth] === 'Yes' ? 'TRUE' : 'FALSE';
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
  if (!picked.length) return '';
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
    (mine.length ? ' — replaced ' + mine.length + ' earlier answer(s)' : '');
}

function freqWeight_(key) {
  for (var i = 0; i < FREQUENCIES.length; i++) if (FREQUENCIES[i][2] === key) return FREQUENCIES[i][1];
  return 0;
}

function saveEvent_(a, t) {
  var patch = {};
  ownerPatch_(patch, a);
  put_(patch, 'name', a[Q.eventName]);
  put_(patch, 'description', a[Q.eventDesc]);
  putTags_(patch, a[Q.tags]);
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';
  var existing = a[Q.whichEvent] === NEW_EVENT ? null : findById_(t.events, idFromLabel_(a[Q.whichEvent], 'event'));
  locationPatch_(patch, a, existing);
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
  if (patch.end) addMissingColumns_(ss_().getSheetByName(TAB.events), COLS[TAB.events]);
  return upsert_(TAB.events, 'event', a[Q.whichEvent], NEW_EVENT, patch);
}

function saveProject_(a, t) {
  var patch = {};
  ownerPatch_(patch, a);
  put_(patch, 'name', a[Q.projectName]);
  put_(patch, 'description', a[Q.projectDesc]);
  if (a[Q.projectStatus]) put_(patch, 'status', lookup_(STATUSES, a[Q.projectStatus]));
  if (asArray_(a[Q.skills]).length) {
    patch.skills_needed = uniq_(asArray_(a[Q.skills]).map(function (s) { return String(s).trim().toLowerCase(); })).join(', ');
  }
  putTags_(patch, a[Q.tags]);
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';
  var existing = a[Q.whichProject] === NEW_PROJECT ? null : findById_(t.projects, idFromLabel_(a[Q.whichProject], 'project'));
  locationPatch_(patch, a, existing);
  return upsert_(TAB.projects, 'project', a[Q.whichProject], NEW_PROJECT, patch);
}

function ownerPatch_(patch, a) {
  if (a[Q.hostOrg] && a[Q.hostOrg] !== NONE) patch.host_org_id = idFromLabel_(a[Q.hostOrg], 'org');
  if (a[Q.coalition] && a[Q.coalition] !== NONE) patch.coalition_id = idFromLabel_(a[Q.coalition], 'coalition');
}

/** Location text + online flag; geocode new/changed in-person locations for the map pin. */
function locationPatch_(patch, a, existing) {
  put_(patch, 'location', a[Q.location]);
  if (a[Q.online]) patch.online = a[Q.online] === 'Yes' ? 'TRUE' : 'FALSE';
  var online = patch.online ? isTrue_(patch.online) : existing ? isTrue_(existing.online) : false;
  var loc = patch.location || (existing ? str_(existing.location) : '');
  var changed = patch.location && (!existing || str_(existing.location) !== patch.location);
  var becameInPerson = patch.online === 'FALSE' && existing && isTrue_(existing.online);
  if (!online && loc && (changed || becameInPerson || (existing && !str_(existing.lat)))) {
    var ll = geocode_(loc);
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
    id = uniqueId_(base.slice(0, 40), table.rows);
    var row = { id: id, last_activity: now };
    if (recordType === 'project' && !patch.status) row.status = 'active';
    if (!patch.name) { row.hidden = 'TRUE'; changes.push('hidden until it has a name'); }
    if ((recordType === 'event' || recordType === 'project') && !patch.host_org_id && !patch.coalition_id) {
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
function doGet() {
  var data = buildDataFile_(readAll_(), nowIso_());
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
      if (k === 'online' || k === 'remote') { if (isTrue_(v)) obj[k] = true; return; }
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
      p, ['host_org_id', 'topic_tags', 'link', 'public_contact'].concat(place));
  });
  var events = group(t.events, function (e) {
    return extra({ id: str(e.id), name: str(e.name), date: str(e.date), location: str(e.location) },
      e, ['end', 'description', 'host_org_id', 'topic_tags', 'link', 'public_contact', 'online', 'lat', 'lng']);
  });
  var actions = group(t.actions.map(function (a) { var c = {}; for (var k in a) c[k] = a[k]; c.host_org_id = ''; return c; }), function (a) {
    return { id: str(a.id), kind: str(a.kind) || 'task', name: str(a.name), urgency: str(a.urgency) || 'medium',
      skills_needed: list_(a.skills_needed), deadline: str(a.deadline) || null };
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
    };
  });

  orgs.forEach(function (o) {
    if (projects['o:' + o.id]) o.projects = projects['o:' + o.id];
    if (events['o:' + o.id]) o.events = events['o:' + o.id];
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
  var ss = ss_();
  var r = function (name) { var sh = ss.getSheetByName(name); return sh ? readTable_(sh).rows : []; };
  return {
    coalitions: r(TAB.coalitions), orgs: r(TAB.orgs), connections: r(TAB.connections), projects: r(TAB.projects),
    events: r(TAB.events), actions: r(TAB.actions), editors: r(TAB.editors),
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
    ['Send feedback', 'FORM_FEEDBACK'],
  ].map(function (r) {
    var id = props.getProperty(r[1]);
    if (!id) return [r[0], '(not built)'];
    var f = FormApp.openById(id);
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
      var li = items[i].asListItem();
      var url = form.createResponse().withItemResponse(li.createResponse(li.getChoices()[0].getValue())).toPrefilledUrl();
      var m = /[?&](entry\.\d+)=/.exec(url);
      return m ? m[1] : '';
    }
    return '';
  };
  var one = function (key, fields) {
    var id = props.getProperty(key);
    if (!id) return { url: '' };
    var f = FormApp.openById(id);
    var out = { url: f.getPublishedUrl() };
    Object.keys(fields || {}).forEach(function (k) { out[k] = entry(f, fields[k]); });
    return out;
  };
  return {
    org: one('FORM_ORG', { orgEntry: Q.whichOrg }),
    event: one('FORM_EVENT', { hostOrgEntry: Q.hostOrg, coalitionEntry: Q.coalition }),
    project: one('FORM_PROJECT', { hostOrgEntry: Q.hostOrg, coalitionEntry: Q.coalition }),
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

function geocode_(place) {
  try {
    place = String(place).trim();
    if (/^(statewide|national|new england|northeast|online|remote|zoom)$/i.test(place)) return null;
    var q = /\b(MA|Massachusetts)\b/i.test(place) ? place : place + ', Massachusetts';
    var res = Maps.newGeocoder().setRegion('us').geocode(q);
    if (res.status === 'OK' && res.results.length) {
      var loc = res.results[0].geometry.location;
      return [Math.round(loc.lat * 1e6) / 1e6, Math.round(loc.lng * 1e6) / 1e6];
    }
  } catch (e) { /* fall through */ }
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
function putTags_(patch, v) {
  var arr = asArray_(v).map(slug_).filter(Boolean);
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
  return LABEL_INDEX_.byLabel[kind][text] || '';
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
