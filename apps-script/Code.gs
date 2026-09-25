/**
 * Openthink — forms + spreadsheet backend
 * ---------------------------------------
 * Paste this whole file into the Openthink data Google Sheet:
 *   Extensions → Apps Script → replace Code.gs → Save.
 * Then reload the sheet and run  Openthink → Set up sheet + forms  once. It loads the current
 * map data from GitHub into the tabs (only if they're empty) and builds the forms.
 *
 * What it does
 *  - Builds four Google Forms linked to this sheet:
 *      1. Update your organization
 *      2. Add or edit an event
 *      3. Add or edit a project
 *      4. Send feedback
 *  - Every field is optional except "which one is this about?", so groups only fill in
 *    what's missing or changed. Blank answers never overwrite existing info.
 *  - Each submission is written straight into the Organizations / Events / Projects tabs
 *    (or Feedback), and recorded in Change Log with old → new values so it can be undone.
 *  - Dropdowns of existing orgs / events / projects refresh after every submission.
 *  - doGet() serves the public tabs as data.json, so the site (or scripts/pull-data.mjs)
 *    can read it without exposing Feedback or Change Log.
 */

// ---------------------------------------------------------------- settings
/** Put an email here to get a note for every submission (leave '' for none). */
var NOTIFY_EMAIL = '';
/** Where the starting data comes from (the repo's current public/data.json). */
var SEED_URL = 'https://raw.githubusercontent.com/nkessel/openthink_mycc/development_branch/public/data.json';

var TAB = {
  coalitions: 'Coalitions',
  orgs: 'Organizations',
  projects: 'Projects',
  events: 'Events',
  actions: 'Actions',
  feedback: 'Feedback',
  log: 'Change Log',
  start: 'Start Here',
};

var NEW_ORG = '➕ Add a new organization';
var NEW_EVENT = '➕ Add a new event';
var NEW_PROJECT = '➕ Add a new project';
var NONE = '— None / not sure —';
var REMOVE_YES = 'Yes, take it off the map';

var OPTIONAL_NOTE =
  'Everything below is optional — only fill in what is new or needs changing. ' +
  'Blank answers keep the current info as it is.';
var PUBLIC_NOTE = 'Please only include information that is safe to share publicly.';

/** Question titles (the submit handler looks answers up by these). */
var Q = {
  // shared
  tags: 'Climate topic tags',
  publicContact: 'Public contact information',
  submitter: 'Your name and email (private)',
  remove: 'Remove from the map?',
  link: 'Link (website, RSVP, or info page)',
  hostOrg: 'Organization',
  coalition: 'Coalition (if any)',
  // org
  whichOrg: 'Which organization is this about?',
  orgName: 'Organization name',
  orgType: 'Type of organization',
  orgTown: 'Town or region you focus on',
  orgDesc: 'Short description',
  orgCoalitions: 'Coalitions you belong to',
  website: 'Website',
  orgAbbrev: 'Short name or abbreviation',
  logo: 'Logo image link',
  youth: 'Is your organization youth-serving?',
  membership: 'About how many active members do you have?',
  // event
  whichEvent: 'Which event is this about?',
  eventName: 'Event name',
  eventDesc: 'Event description',
  eventDate: 'Date',
  eventTime: 'Start time',
  eventLocation: 'Location',
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
  fbEmail: 'Email',
  fbFollowUp: 'Is it OK for us to follow up with you?',
};

var ORG_TYPES = [
  ['Nonprofit — 501(c)(3)', '501c3'],
  ['Nonprofit — 501(c)(4)', '501c4'],
  ['Volunteer group', 'volunteer'],
  ['Youth organization', 'youth_org'],
  ['School club', 'school_club'],
  ['Faith community', 'faith_org'],
  ['Professional association', 'professional'],
  ['Union', 'union'],
  ['Media', 'media'],
  ['Government / regional body', 'regional_gov'],
  ['Other', 'other'],
];
var MEMBERSHIP = ['Under 10', '10+', '25+', '50+', '100+'];
var STATUSES = [['Active', 'active'], ['Planning', 'planning'], ['Completed', 'completed']];
var BASE_TAGS = ['clean_energy', 'climate_policy', 'environmental_justice', 'grassroots',
  'green_buildings', 'health', 'housing', 'just_transition', 'school_clubs', 'youth_serving'];
var BASE_SKILLS = ['data entry', 'event logistics', 'facilitation', 'fundraising', 'graphic design',
  'legal', 'outreach', 'photography', 'public speaking', 'research', 'social media', 'spanish',
  'portuguese', 'translation', 'video editing', 'writing'];

// ---------------------------------------------------------------- menu
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Openthink')
    .addItem('Set up sheet + forms (run once)', 'setUp')
    .addItem('Refresh form dropdowns', 'refreshDropdowns')
    .addItem('Show form + data links', 'showLinks')
    .addToUi();
}

// ---------------------------------------------------------------- set up
/** Org profile fields from the MA Climate Coalition Map (org.profile in data.json). */
var PROFILE_BOOL = ['youth_serving', 'school_club', 'hub', 'inactive', 'paid_staff'];
var PROFILE_NUM = ['ej_focus', 'grassroots', 'policy_expertise', 'in_building'];
var PROFILE_STR = ['membership_size', 'c3_tier', 'c4_tier', 'geo_precision'];
var PROFILE_COLS = PROFILE_BOOL.concat(PROFILE_NUM, PROFILE_STR);

var COLS = {
  'Coalitions': ['id', 'name', 'abbrev', 'description', 'focus_tags', 'geographic_scope', 'color', 'lat', 'lng', 'last_activity'],
  'Organizations': ['id', 'name', 'abbrev', 'type', 'geographic_focus', 'description', 'coalition_ids', 'topic_tags',
    'website', 'logo', 'public_contact', 'lat', 'lng', 'last_activity', 'hidden', 'coalition_weights'].concat(PROFILE_COLS),
  'Projects': ['id', 'coalition_id', 'host_org_id', 'name', 'description', 'status', 'skills_needed', 'topic_tags', 'link',
    'public_contact', 'last_activity', 'hidden'],
  'Events': ['id', 'coalition_id', 'host_org_id', 'name', 'description', 'date', 'location', 'topic_tags', 'link',
    'public_contact', 'last_activity', 'hidden'],
  'Actions': ['id', 'coalition_id', 'kind', 'name', 'urgency', 'skills_needed', 'deadline', 'hidden'],
  'Feedback': ['submitted_at', 'type', 'area', 'message', 'name', 'email', 'ok_to_follow_up', 'status', 'notes'],
  'Change Log': ['timestamp', 'form', 'action', 'record_type', 'record_id', 'record_name', 'changes', 'submitted_by'],
};

var START_TEXT = [
  ['Openthink data', ''],
  ['', ''],
  ['This spreadsheet is the source of truth for the Openthink map. The forms write into it; the site reads from it.', ''],
  ['', ''],
  ['Tabs', ''],
  ['Coalitions / Organizations / Projects / Events / Actions', 'The map data. Safe to edit by hand. Lists are comma-separated ids or tags.'],
  ['Feedback', 'Everything sent through the feedback form. Use the status column (new / in progress / done).'],
  ['Change Log', 'Every change a form made, with old → new values and who sent it. Use it to review or undo.'],
  ['', ''],
  ['Rules', ''],
  ['id', 'Never change an existing id — other rows point to it. New rows get an id automatically from the forms.'],
  ['hidden', 'Put TRUE to take something off the map without deleting it (the forms\' "remove" option does this).'],
  ['Private info', 'Only Feedback and Change Log hold submitters\' names and emails. Those tabs are never published.'],
  ['', ''],
  ['Form links', ''],
];

/** One-time setup: create tabs, load the current map data, build the forms. */
function setUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  var loaded = seedSheet_(ss);
  buildForms(loaded);
}

function seedSheet_(ss) {
  var start = ss.getSheetByName(TAB.start);
  if (!start) {
    start = ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(TAB.start) : ss.insertSheet(TAB.start, 0);
    start.getRange(1, 1, START_TEXT.length, 2).setValues(START_TEXT);
    start.getRange('A1').setFontSize(16).setFontWeight('bold');
    ['A5', 'A10', 'A15'].forEach(function (a) { start.getRange(a).setFontWeight('bold'); });
    start.setColumnWidth(1, 380); start.setColumnWidth(2, 700);
  }
  var needsData = !ss.getSheetByName(TAB.orgs) || ss.getSheetByName(TAB.orgs).getLastRow() <= 1;
  var rows = needsData ? sheetRowsFromData_(JSON.parse(UrlFetchApp.fetch(SEED_URL).getContentText())) : {};
  Object.keys(COLS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]])
        .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937');
      sh.setFrozenRows(1); sh.setFrozenColumns(1);
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
  return needsData;
}

/** Pure: DataFile (data.json) → { tabName: rows[][] } in COLS order. */
function sheetRowsFromData_(d) {
  var L = function (xs) { return (xs || []).join(', '); };
  var v = function (x) { return x === undefined || x === null ? '' : x; };
  var out = { Coalitions: [], Organizations: [], Projects: [], Events: [], Actions: [] };
  d.coalitions.forEach(function (c) {
    out.Coalitions.push([c.id, c.name, c.abbrev, c.description, L(c.focus_tags), c.geographic_scope, c.color,
      c.lat, c.lng, v(c.last_activity)]);
    (c.projects || []).forEach(function (p) {
      out.Projects.push([p.id, c.id, v(p.host_org_id), p.name, v(p.description), v(p.status), L(p.skills_needed),
        L(p.topic_tags), v(p.link), v(p.public_contact), '', '']);
    });
    (c.events || []).forEach(function (e) {
      out.Events.push([e.id, c.id, v(e.host_org_id), e.name, v(e.description), v(e.date), v(e.location),
        L(e.topic_tags), v(e.link), v(e.public_contact), '', '']);
    });
    (c.actions || []).forEach(function (a) {
      out.Actions.push([a.id, c.id, v(a.kind), a.name, v(a.urgency), L(a.skills_needed), v(a.deadline), '']);
    });
  });
  d.organizations.forEach(function (o) {
    var weights = Object.keys(o.coalition_weights || {}).map(function (k) { return k + ':' + o.coalition_weights[k]; });
    var prof = o.profile || {};
    out.Organizations.push([o.id, o.name, v(o.abbrev), v(o.type), v(o.geographic_focus), v(o.description),
      L(o.coalition_ids), L(o.topic_tags), v(o.website), v(o.logo), v(o.public_contact),
      Math.round(o.lat * 1e6) / 1e6, Math.round(o.lng * 1e6) / 1e6, v(o.last_activity), '', weights.join(', ')]
      .concat(PROFILE_BOOL.map(function (k) { return prof[k] === undefined ? '' : prof[k] ? 'TRUE' : 'FALSE'; }))
      .concat(PROFILE_NUM.map(function (k) { return prof[k] === undefined ? '' : prof[k]; }))
      .concat(PROFILE_STR.map(function (k) { return v(prof[k]); })));
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
    { key: 'FORM_ORG', title: 'Openthink — Update your organization', build: buildOrgForm_, tab: 'Responses: Organizations' },
    { key: 'FORM_EVENT', title: 'Openthink — Add or edit an event', build: buildEventForm_, tab: 'Responses: Events' },
    { key: 'FORM_PROJECT', title: 'Openthink — Add or edit a project', build: buildProjectForm_, tab: 'Responses: Projects' },
    { key: 'FORM_FEEDBACK', title: 'Openthink — Send feedback', build: buildFeedbackForm_, tab: 'Responses: Feedback' },
  ];

  specs.forEach(function (s) {
    if (props.getProperty(s.key) && formExists_(props.getProperty(s.key))) return; // already built
    var form = FormApp.create(s.title);
    s.build(form);
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
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
      ? 'Built:\n• ' + built.join('\n• ') + '\n\nLinks are on the Start Here tab.'
      : 'All four forms already exist. Links are on the Start Here tab.')
  );
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
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Thank you! Your changes are on their way to the map.');
}

function addTags_(form) {
  form.addCheckboxItem().setTitle(Q.tags)
    .setHelpText('Pick any that fit, or add your own under "Other".')
    .setChoiceValues(BASE_TAGS.map(humanize_)).showOtherOption(true);
}
function addPublicContact_(form) {
  form.addTextItem().setTitle(Q.publicContact)
    .setHelpText('An email, phone, or contact name people can use to reach you. This is shown on the map.');
}
function addSubmitter_(form) {
  form.addTextItem().setTitle(Q.submitter)
    .setHelpText('So we can check with you if something is unclear. Only the map team sees this.');
}
function addRemove_(form, what) {
  form.addCheckboxItem().setTitle(Q.remove)
    .setHelpText('Check this to take the ' + what + ' off the map. It stays in our records and can be restored.')
    .setChoiceValues([REMOVE_YES]);
}
function addSelector_(form, title, help, placeholder) {
  form.addListItem().setTitle(title).setHelpText(help).setRequired(true).setChoiceValues([placeholder]);
}

function buildOrgForm_(form) {
  header_(form,
    'Use this form to add your organization to the Openthink climate coalition map, or to fill in and correct what we already have.\n\n' +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE);
  addSelector_(form, Q.whichOrg, 'Pick your organization to update it, or choose "' + NEW_ORG + '".', NEW_ORG);
  form.addTextItem().setTitle(Q.orgName).setHelpText('Only if it is new or has changed.');
  form.addListItem().setTitle(Q.orgType).setChoiceValues(ORG_TYPES.map(function (t) { return t[0]; }));
  form.addTextItem().setTitle(Q.orgTown).setHelpText('e.g. Worcester, Cape Cod, Greater Boston, statewide. Used to place you on the geographic map.');
  form.addParagraphTextItem().setTitle(Q.orgDesc).setHelpText('One or two sentences about what you do.');
  form.addCheckboxItem().setTitle(Q.orgCoalitions)
    .setHelpText('If you answer this, check every coalition you are part of — it replaces your current list.')
    .setChoiceValues([NONE]);
  addTags_(form);
  form.addTextItem().setTitle(Q.orgAbbrev).setHelpText('e.g. MYCC, BLS YouthCAN');
  form.addMultipleChoiceItem().setTitle(Q.youth).setChoiceValues(['Yes', 'No']);
  form.addMultipleChoiceItem().setTitle(Q.membership).setChoiceValues(MEMBERSHIP);
  form.addTextItem().setTitle(Q.website);
  form.addTextItem().setTitle(Q.logo)
    .setHelpText('A link to your logo (PNG or JPG) — e.g. from your website, or a Google Drive file shared as "anyone with the link".');
  addPublicContact_(form);
  addRemove_(form, 'organization');
  addSubmitter_(form);
}

function buildEventForm_(form) {
  header_(form,
    "Use this form to add your organization's public event to the coalition map, or to update or remove one that's already there.\n\n" +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE);
  addSelector_(form, Q.whichEvent, 'Pick an event to update it, or choose "' + NEW_EVENT + '".', NEW_EVENT);
  form.addListItem().setTitle(Q.hostOrg).setHelpText('The organization hosting the event.').setChoiceValues([NONE]);
  form.addListItem().setTitle(Q.coalition).setHelpText('If the event is part of a coalition\'s work.').setChoiceValues([NONE]);
  form.addTextItem().setTitle(Q.eventName);
  form.addParagraphTextItem().setTitle(Q.eventDesc);
  form.addDateItem().setTitle(Q.eventDate);
  form.addTimeItem().setTitle(Q.eventTime);
  form.addTextItem().setTitle(Q.eventLocation).setHelpText('Venue and town, an address, or "Online".');
  addTags_(form);
  form.addTextItem().setTitle(Q.link);
  addPublicContact_(form);
  addRemove_(form, 'event');
  addSubmitter_(form);
}

function buildProjectForm_(form) {
  header_(form,
    "Use this form to add a project your organization or coalition is working on, or to update one that's already on the map. " +
    'Projects are how volunteers find ways to help, so the skills question matters.\n\n' +
    OPTIONAL_NOTE + '\n\n' + PUBLIC_NOTE);
  addSelector_(form, Q.whichProject, 'Pick a project to update it, or choose "' + NEW_PROJECT + '".', NEW_PROJECT);
  form.addListItem().setTitle(Q.hostOrg).setHelpText('The organization leading the project.').setChoiceValues([NONE]);
  form.addListItem().setTitle(Q.coalition).setHelpText("If the project is part of a coalition's work.").setChoiceValues([NONE]);
  form.addTextItem().setTitle(Q.projectName);
  form.addParagraphTextItem().setTitle(Q.projectDesc);
  form.addMultipleChoiceItem().setTitle(Q.projectStatus).setChoiceValues(STATUSES.map(function (s) { return s[0]; }));
  form.addCheckboxItem().setTitle(Q.skills)
    .setHelpText('If you answer this, check everything you need — it replaces the current list.')
    .setChoiceValues(BASE_SKILLS.map(capitalize_)).showOtherOption(true);
  addTags_(form);
  form.addTextItem().setTitle(Q.link);
  addPublicContact_(form);
  addRemove_(form, 'project');
  addSubmitter_(form);
}

function buildFeedbackForm_(form) {
  form.setDescription('Tell us what is working, what is broken, or what you wish the Openthink map did. Only your feedback is required.');
  form.setCollectEmail(false);
  form.setConfirmationMessage('Thank you — we read every one.');
  form.addMultipleChoiceItem().setTitle(Q.fbType).setChoiceValues([
    "Something's broken", 'Info on the map is wrong or missing', 'Idea or feature request', 'Question', 'Other']);
  form.addCheckboxItem().setTitle(Q.fbArea).setChoiceValues([
    'Network map', 'Geographic map', 'Events list', 'Projects list', 'Organization details', 'The forms', 'General']);
  form.addParagraphTextItem().setTitle(Q.fbMessage).setRequired(true);
  form.addTextItem().setTitle(Q.fbName);
  form.addTextItem().setTitle(Q.fbEmail);
  form.addMultipleChoiceItem().setTitle(Q.fbFollowUp).setChoiceValues(['Yes', 'No']);
}

// ---------------------------------------------------------------- dropdown refresh
function refreshDropdowns() {
  var props = PropertiesService.getScriptProperties();
  var t = readAll_();
  var visible = function (r) { return !isTrue_(r.hidden); };

  var orgs = t.orgs.filter(visible).sort(byName_);
  var orgLabels = orgs.map(function (o) { return o.name + ' [' + o.id + ']'; });
  var coalitionLabels = t.coalitions.map(function (c) { return c.name + ' (' + c.abbrev + ') [' + c.id + ']'; });
  var eventLabels = t.events.filter(visible)
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
    .map(function (e) { return e.name + ' — ' + shortDate_(e.date) + ' [' + e.id + ']'; });
  var projectLabels = t.projects.filter(visible).sort(byName_)
    .map(function (p) { return p.name + ' [' + p.id + ']'; });

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
    if (!id) return;
    var form = FormApp.openById(id);
    var items = form.getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].getTitle() !== title) continue;
      var type = items[i].getType();
      if (type === FormApp.ItemType.LIST) items[i].asListItem().setChoiceValues(values);
      else if (type === FormApp.ItemType.CHECKBOX) items[i].asCheckboxItem().setChoiceValues(values);
    }
  };

  set('FORM_ORG', Q.whichOrg, [NEW_ORG].concat(orgLabels));
  set('FORM_ORG', Q.orgCoalitions, coalitionLabels);
  set('FORM_EVENT', Q.whichEvent, [NEW_EVENT].concat(eventLabels));
  set('FORM_PROJECT', Q.whichProject, [NEW_PROJECT].concat(projectLabels));
  ['FORM_EVENT', 'FORM_PROJECT'].forEach(function (k) {
    set(k, Q.hostOrg, [NONE].concat(orgLabels));
    set(k, Q.coalition, [NONE].concat(coalitionLabels));
  });
  ['FORM_ORG', 'FORM_EVENT', 'FORM_PROJECT'].forEach(function (k) { set(k, Q.tags, tags); });
  set('FORM_PROJECT', Q.skills, skills);
}

// ---------------------------------------------------------------- submissions
function handleSubmit(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var formId = e.source.getId();
    var a = answers_(e.response);
    var kind =
      formId === props.getProperty('FORM_ORG') ? 'org' :
      formId === props.getProperty('FORM_EVENT') ? 'event' :
      formId === props.getProperty('FORM_PROJECT') ? 'project' :
      formId === props.getProperty('FORM_FEEDBACK') ? 'feedback' : null;
    if (!kind) return;

    var summary;
    if (kind === 'feedback') summary = saveFeedback_(a);
    else {
      summary = kind === 'org' ? saveOrg_(a) : kind === 'event' ? saveEvent_(a) : saveProject_(a);
      refreshDropdowns();
    }
    if (NOTIFY_EMAIL && summary) {
      MailApp.sendEmail(NOTIFY_EMAIL, 'Openthink: ' + summary.subject, summary.body +
        '\n\nSheet: ' + ss_().getUrl());
    }
  } finally {
    lock.releaseLock();
  }
}

function answers_(response) {
  var out = {};
  response.getItemResponses().forEach(function (ir) {
    out[ir.getItem().getTitle()] = ir.getResponse();
  });
  return out;
}

function saveOrg_(a) {
  var patch = {};
  var t = readAll_();
  put_(patch, 'name', a[Q.orgName]);
  if (a[Q.orgType]) put_(patch, 'type', lookup_(ORG_TYPES, a[Q.orgType]));
  put_(patch, 'geographic_focus', a[Q.orgTown]);
  put_(patch, 'description', a[Q.orgDesc]);
  if (a[Q.orgCoalitions]) {
    var ids = asArray_(a[Q.orgCoalitions]).map(idFromLabel_).filter(Boolean);
    patch.coalition_ids = ids.join(', ');
  }
  putTags_(patch, a[Q.tags]);
  put_(patch, 'website', a[Q.website]);
  put_(patch, 'abbrev', a[Q.orgAbbrev]);
  if (a[Q.logo]) put_(patch, 'logo', driveImage_(String(a[Q.logo]).trim()));
  if (a[Q.youth]) patch.youth_serving = a[Q.youth] === 'Yes' ? 'TRUE' : 'FALSE';
  put_(patch, 'membership_size', a[Q.membership]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';

  var isNew = a[Q.whichOrg] === NEW_ORG;
  var existing = isNew ? null : findById_(t.orgs, idFromLabel_(a[Q.whichOrg]));
  // place on the geographic map when the town is new or changed
  if (patch.geographic_focus && (!existing || existing.geographic_focus !== patch.geographic_focus)) {
    var ll = geocode_(patch.geographic_focus);
    if (ll) { patch.lat = ll[0]; patch.lng = ll[1]; patch.geo_precision = 'approx'; }
  }
  if (isNew && patch.lat === undefined) {
    var c = patch.coalition_ids ? findById_(t.coalitions, list_(patch.coalition_ids)[0]) : null;
    var base = c ? [Number(c.lat), Number(c.lng)] : [42.3601, -71.0589];
    patch.lat = jitter_(base[0]); patch.lng = jitter_(base[1]);
  }
  return upsert_(TAB.orgs, 'organization', 'Update your organization', a[Q.whichOrg], NEW_ORG, patch, a[Q.submitter]);
}

function saveEvent_(a) {
  var patch = {};
  var t = readAll_();
  hostAndCoalition_(patch, a);
  put_(patch, 'name', a[Q.eventName]);
  put_(patch, 'description', a[Q.eventDesc]);
  put_(patch, 'location', a[Q.eventLocation]);
  putTags_(patch, a[Q.tags]);
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';

  var date = a[Q.eventDate], time = a[Q.eventTime];
  if (date || time) {
    var existing = a[Q.whichEvent] === NEW_EVENT ? null : findById_(t.events, idFromLabel_(a[Q.whichEvent]));
    var old = existing ? String(existing.date) : '';
    var d = date || old.slice(0, 10);
    var tm = time || old.slice(11, 16) || '00:00';
    if (d) patch.date = d + 'T' + tm + ':00';
  }
  return upsert_(TAB.events, 'event', 'Add or edit an event', a[Q.whichEvent], NEW_EVENT, patch, a[Q.submitter]);
}

function saveProject_(a) {
  var patch = {};
  hostAndCoalition_(patch, a);
  put_(patch, 'name', a[Q.projectName]);
  put_(patch, 'description', a[Q.projectDesc]);
  if (a[Q.projectStatus]) put_(patch, 'status', lookup_(STATUSES, a[Q.projectStatus]));
  if (a[Q.skills] && asArray_(a[Q.skills]).length) {
    patch.skills_needed = uniq_(asArray_(a[Q.skills]).map(function (s) { return String(s).trim().toLowerCase(); })).join(', ');
  }
  putTags_(patch, a[Q.tags]);
  put_(patch, 'link', a[Q.link]);
  put_(patch, 'public_contact', a[Q.publicContact]);
  if (isRemove_(a)) patch.hidden = 'TRUE';
  var r = upsert_(TAB.projects, 'project', 'Add or edit a project', a[Q.whichProject], NEW_PROJECT, patch, a[Q.submitter]);
  return r;
}

function hostAndCoalition_(patch, a) {
  if (a[Q.hostOrg] && a[Q.hostOrg] !== NONE) patch.host_org_id = idFromLabel_(a[Q.hostOrg]);
  if (a[Q.coalition] && a[Q.coalition] !== NONE) patch.coalition_id = idFromLabel_(a[Q.coalition]);
}

function saveFeedback_(a) {
  var sheet = ss_().getSheetByName(TAB.feedback);
  appendObject_(sheet, {
    submitted_at: nowIso_(),
    type: a[Q.fbType] || '',
    area: asArray_(a[Q.fbArea]).join(', '),
    message: a[Q.fbMessage] || '',
    name: a[Q.fbName] || '',
    email: a[Q.fbEmail] || '',
    ok_to_follow_up: a[Q.fbFollowUp] || '',
    status: 'new',
    notes: '',
  });
  return { subject: 'new feedback (' + (a[Q.fbType] || 'feedback') + ')', body: a[Q.fbMessage] || '' };
}

/**
 * Add a new row or apply non-empty fields to an existing one, then log it.
 * `patch` only holds fields the person actually answered.
 */
function upsert_(tabName, recordType, formName, selection, newLabel, patch, submitter) {
  var ss = ss_();
  var sheet = ss.getSheetByName(tabName);
  var table = readTable_(sheet);
  var now = nowIso_();
  var action, id, name, changes = [];

  if (selection === newLabel) {
    action = 'added';
    var fallback = recordType === 'organization' ? 'new org' : 'new ' + recordType;
    var base = slug_(patch.name || fallback);
    if (recordType === 'event') base = 'ev_' + base;
    if (recordType === 'project') base = 'pr_' + base;
    id = uniqueId_(base.slice(0, 40), table.rows);
    var row = { id: id, last_activity: now };
    if (recordType === 'project' && !patch.status) row.status = 'active';
    if (!patch.name) { row.hidden = 'TRUE'; changes.push('hidden until it has a name'); }
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; changes.push(k + ': ' + patch[k]); });
    appendObject_(sheet, row);
    name = patch.name || '(no name yet)';
  } else {
    id = idFromLabel_(selection);
    var rec = findById_(table.rows, id);
    if (!rec) {
      logChange_(formName, 'NOT FOUND', recordType, id, selection, JSON.stringify(patch), submitter);
      return { subject: recordType + ' not found: ' + selection, body: JSON.stringify(patch, null, 2) };
    }
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
  logChange_(formName, action, recordType, id, name, changes.join('\n'), submitter);
  return { subject: recordType + ' ' + action + ': ' + name, body: changes.join('\n') + '\n\nFrom: ' + (submitter || 'anonymous') };
}

function logChange_(form, action, type, id, name, changes, submitter) {
  var sheet = ss_().getSheetByName(TAB.log);
  appendObject_(sheet, {
    timestamp: nowIso_(), form: form, action: action, record_type: type,
    record_id: id, record_name: name, changes: changes, submitted_by: submitter || '',
  });
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
  var str = function (v) { return v === undefined || v === null ? '' : String(v).trim(); };
  var extra = function (obj, src, keys) {
    keys.forEach(function (k) {
      var v = src[k];
      if (k === 'topic_tags') { var l = list_(v); if (l.length) obj[k] = l; return; }
      if (str(v)) obj[k] = str(v);
    });
    return obj;
  };

  var coalitionIds = {};
  t.coalitions.forEach(function (c) { if (c.id) coalitionIds[c.id] = true; });

  var orgs = t.orgs.filter(visible).map(function (o) {
    return extra({
      id: str(o.id), name: str(o.name), type: str(o.type), geographic_focus: str(o.geographic_focus),
      description: str(o.description),
      coalition_ids: list_(o.coalition_ids).filter(function (id) { return coalitionIds[id]; }),
      lat: Number(o.lat), lng: Number(o.lng), last_activity: str(o.last_activity),
    }, o, ['abbrev', 'website', 'logo', 'public_contact', 'topic_tags']);
  }).map(function (org, i) {
    var o = t.orgs.filter(visible)[i];
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

  // Events/projects without a coalition sit under their host org's first coalition.
  var home = function (r) {
    if (str(r.coalition_id) && coalitionIds[str(r.coalition_id)]) return str(r.coalition_id);
    var host = orgById[str(r.host_org_id)];
    return host && host.coalition_ids.length ? host.coalition_ids[0] : null;
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
  var projects = group(t.projects, function (p) {
    return extra({ id: str(p.id), name: str(p.name), description: str(p.description),
      status: str(p.status) || 'active', skills_needed: list_(p.skills_needed) },
      p, ['host_org_id', 'topic_tags', 'link', 'public_contact']);
  });
  var events = group(t.events, function (e) {
    return extra({ id: str(e.id), name: str(e.name), date: str(e.date), location: str(e.location) },
      e, ['description', 'host_org_id', 'topic_tags', 'link', 'public_contact']);
  });
  var actions = group(t.actions, function (a) {
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
      projects: projects[c.id] || [], events: events[c.id] || [], actions: actions[c.id] || [],
      last_activity: str(c.last_activity),
    };
  });

  var edges = [];
  coalitions.forEach(function (c) { c.member_ids.forEach(function (m) { edges.push({ source: c.id, target: m }); }); });
  return { generated_at: generatedAt, coalitions: coalitions, organizations: orgs, edges: edges };
}

// ---------------------------------------------------------------- sheet helpers
/** Form-submit triggers have no "active" spreadsheet, so open it by the id saved at build time. */
function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function readAll_() {
  var ss = ss_();
  var r = function (name) { return readTable_(ss.getSheetByName(name)).rows; };
  return {
    coalitions: r(TAB.coalitions), orgs: r(TAB.orgs), projects: r(TAB.projects),
    events: r(TAB.events), actions: r(TAB.actions),
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
      if (v !== '' && v !== null) blank = false;
    });
    if (!blank) rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function appendObject_(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length);
  range.setNumberFormats([row.map(function (v) { return typeof v === 'number' ? '0.00000' : '@'; })]);
  range.setValues([row]);
}

function writeFields_(sheet, headers, rowNum, updates) {
  Object.keys(updates).forEach(function (k) {
    var col = headers.indexOf(k);
    if (col === -1) return;
    var cell = sheet.getRange(rowNum, col + 1);
    cell.setNumberFormat(typeof updates[k] === 'number' ? '0.00000' : '@');
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
    return [r[0], f.shortenFormUrl(f.getPublishedUrl()) + '    (edit: ' + f.getEditUrl() + ')'];
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
    (url ? 'data.json URL: ' + url : 'data.json URL: not deployed yet (Deploy → New deployment → Web app).'));
}

function findRow_(sheet, text) {
  var v = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === text) return i + 1;
  return 0;
}

function geocode_(place) {
  try {
    var q = /\b(MA|Massachusetts)\b/i.test(place) || /statewide|national|new england/i.test(place)
      ? place : place + ', Massachusetts';
    if (/^(statewide|national|new england|northeast)$/i.test(place.trim())) return [jitter_(42.3601), jitter_(-71.0589)];
    var res = Maps.newGeocoder().setRegion('us').geocode(q);
    if (res.status === 'OK' && res.results.length) {
      var loc = res.results[0].geometry.location;
      return [jitter_(loc.lat, 0.01), jitter_(loc.lng, 0.01)];
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
function list_(v) {
  if (Array.isArray(v)) return v;
  return String(v === undefined || v === null ? '' : v).split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
}
function flat_(arrs) { return [].concat.apply([], arrs); }
function uniq_(arr) { var seen = {}; return arr.filter(function (x) { return seen[x] ? false : (seen[x] = true); }); }
function isTrue_(v) { return v === true || /^(true|yes|1|x)$/i.test(String(v === undefined || v === null ? '' : v).trim()); }
function idFromLabel_(label) { var m = /\[([^\]]+)\]\s*$/.exec(String(label || '')); return m ? m[1] : ''; }
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
