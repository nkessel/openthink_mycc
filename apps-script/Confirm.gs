/**
 * Group Confirmation Screen (10/29 meeting): each organization gets its own private link. The link opens a page
 * with everything the map has for that group (its details, events, projects and actions). The point person
 * enters their name and email, then for each card: Edit, Approve or Remove. "Save for later" keeps their work;
 * "Finalize and Submit" puts it on the map: approved items are marked verified, removed items are hidden, edits
 * are written in, and every change goes in Change Log. The point person is added to the Editors tab (up to three
 * per group), pending until they open the email confirmation link.
 *
 * The links live in their own spreadsheet, shared only with the core team (not in the repo, not in the public
 * data): menu → "Make confirmation links". Its id is the script property LINKS_SHEET_ID.
 *
 * Two people editing the same card at once: the first one holds it; the second sees who is editing and can ask
 * for it. The first person sees the request and can hand it over. Holds last 10 minutes without activity.
 *
 * Paste this file next to Code.gs in Apps Script (+ → Script → "Confirm"). It uses Code.gs's helpers.
 */

var LINK_TAB = 'Links';
var LINK_COLS = ['org_id', 'org_name', 'link', 'status', 'point_people', 'opened_at', 'saved_at', 'submitted_at', 'notes', 'token', 'draft'];
var MAX_POINT_PEOPLE = 3;
var HOLD_SECONDS = 600;
/** Fields a point person can change on each kind of card (sheet column names). */
var CONFIRM_FIELDS = {
  org: ['name', 'description', 'website', 'geographic_focus', 'public_contact'],
  event: ['name', 'date', 'end', 'location', 'online', 'description', 'link', 'rsvp_link'],
  project: ['name', 'description', 'status', 'location', 'online', 'link'],
  action: ['name', 'description', 'deadline', 'link'],
};
var CONFIRM_FORM = 'Confirmation screen';

// ---------------------------------------------------------------- links spreadsheet (admins)

/** Menu: makes (or tops up) the private links spreadsheet: one row and one link per organization on the map. */
function makeConfirmationLinks() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LINKS_SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create(REGION.title + ': confirmation links (private)');
    props.setProperty('LINKS_SHEET_ID', ss.getId());
    adminEmails_().forEach(function (e) { try { ss.addEditor(e); } catch (err) { /* share by hand */ } });
  }
  var added = addConfirmationLinks_(ss, readAll_(), webAppUrl_());
  var msg = 'Confirmation links: ' + added + ' new row(s). The spreadsheet: ' + ss.getUrl() +
    '\nIt is shared only with the admins. Send each group its own link (column "link").';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor */ }
  return msg;
}

function webAppUrl_() {
  // Run from the editor, getUrl() gives the editors-only /dev address (Oct 29: the first links had it), so the
  // public /exec address is taken from the script property WEB_APP_URL, or from the live site's LIVE_DATA_URL.
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not deployed yet */ }
  if (/\/dev$/.test(url)) url = '';
  return url || PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || DEFAULT_WEB_APP_URL;
}
/** The deployed web app (the same address as LIVE_DATA_URL in src/data.config.ts). */
var DEFAULT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwj2109KXf2Ndv-0ZCHp0a6MH3aVSejxkqofBOfOFHRSvMi61DXjkeIe25OlsHNbs5S/exec';

/** Adds a row (with a new secret token) for every visible organization that has none yet. Returns how many. */
function addConfirmationLinks_(ss, t, baseUrl) {
  var sheet = ss.getSheetByName(LINK_TAB);
  if (!sheet) {
    sheet = ss.getSheets && ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(LINK_TAB) : ss.insertSheet(LINK_TAB);
    sheet.getRange(1, 1, 1, LINK_COLS.length).setValues([LINK_COLS]);
    try { sheet.setFrozenRows(1); sheet.hideColumns(LINK_COLS.indexOf('token') + 1, 2); } catch (e) { /* fake sheet in tests */ }
  }
  var have = {};
  readTable_(sheet).rows.forEach(function (r) { have[str_(r.org_id)] = true; });
  var editors = t.editors || [];
  var n = 0;
  t.orgs.filter(function (o) { return o.id && !isTrue_(o.hidden); }).sort(byName_).forEach(function (o) {
    if (have[o.id]) return;
    var token = newToken_();
    appendObject_(sheet, {
      org_id: o.id, org_name: str_(o.name), token: token, link: baseUrl ? baseUrl + '?confirm=' + token : '(deploy the web app, then run this again)',
      status: 'not sent', point_people: pointPeopleOf_(o.id, editors).map(function (p) { return p.email; }).join(', '),
    });
    n++;
  });
  return n;
}

function newToken_() {
  var s = '';
  try { s = Utilities.getUuid().replace(/-/g, ''); } catch (e) { /* tests */ }
  while (s.length < 32) s += Math.floor(Math.random() * 0x100000000).toString(16);
  return s.slice(0, 32);
}

function linksSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('LINKS_SHEET_ID');
  if (!id) return null;
  var ss = SpreadsheetApp.openById(id);
  return ss ? ss.getSheetByName(LINK_TAB) : null;
}

/** The Links row for a token, or null. */
function linkRow_(token) {
  if (!token || !/^[0-9a-f]{32}$/.test(String(token))) return null;
  var sheet = linksSheet_();
  if (!sheet) return null;
  var table = readTable_(sheet);
  for (var i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i].token) === String(token)) return { sheet: sheet, headers: table.headers, rec: table.rows[i] };
  }
  return null;
}

function setLinkFields_(link, fields) { writeFields_(link.sheet, link.headers, link.rec._row, fields); }

/** Confirmed and pending point people (Editors rows naming this org; admins and "*" rows don't count). */
function pointPeopleOf_(orgId, editors) {
  return (editors || []).filter(function (r) {
    return r.email && !/^admin$/i.test(str_(r.role)) && list_(r.org_ids).indexOf(orgId) !== -1;
  }).map(function (r) { return { email: String(r.email).trim().toLowerCase(), name: str_(r.name), pending: isPending_(r) }; });
}

// ---------------------------------------------------------------- the page

/** doGet(?confirm=token): the confirmation page, or a short message when the link is wrong. */
function confirmPage_(token) {
  var link = linkRow_(token);
  if (!link) {
    return HtmlService.createHtmlOutput('<p style="font:17px system-ui;max-width:520px;margin:48px auto;padding:0 16px">' +
      'This link doesn\'t work. Please ask the ' + REGION.title.replace(/[<>&]/g, '') + ' team for a new one.</p>').setTitle(REGION.title);
  }
  var data = confirmData_(link.rec, readAll_());
  if (!str_(link.rec.opened_at)) setLinkFields_(link, { opened_at: nowIso_(), status: str_(link.rec.status) === 'not sent' || !str_(link.rec.status) ? 'opened' : link.rec.status });
  var json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return HtmlService.createHtmlOutput(CONFIRM_HTML.replace('__DATA__', json).replace(/__TITLE__/g, REGION.title.replace(/[<>&]/g, '')))
    .setTitle(REGION.title + ': check your information')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Everything the page shows for one group: its details, its items, its point people and any saved draft. */
function confirmData_(rec, t) {
  var orgId = str_(rec.org_id);
  var o = findById_(t.orgs, orgId) || { id: orgId, name: rec.org_name };
  var pick = function (row, kind) {
    var out = { id: str_(row.id), kind: kind };
    CONFIRM_FIELDS[kind].forEach(function (k) { out[k] = k === 'online' ? isTrue_(row[k]) : str_(row[k]); });
    if (kind !== 'org') { out.verified = isTrue_(row.verified); out.needs_info = isTrue_(row.needs_info); }
    return out;
  };
  var mine = function (rows, kind) {
    return rows.filter(function (r) { return r.id && !isTrue_(r.hidden) && str_(r.host_org_id) === orgId; })
      .map(function (r) { return pick(r, kind); });
  };
  var draft = null;
  try { draft = str_(rec.draft) ? JSON.parse(str_(rec.draft)) : null; } catch (e) { draft = null; }
  if (draft) delete draft.who; // never show one person's details to the next
  return {
    token: str_(rec.token), title: REGION.title, submittedAt: str_(rec.submitted_at),
    org: pick(o, 'org'),
    items: mine(t.events, 'event').concat(mine(t.projects, 'project'), mine(t.actions, 'action')),
    pointPeople: pointPeopleOf_(orgId, t.editors).map(function (p) { return { name: p.name, pending: p.pending, email: maskEmail_(p.email) }; }),
    maxPointPeople: MAX_POINT_PEOPLE, draft: draft, holdSeconds: HOLD_SECONDS,
  };
}

/** "na•••@gmail.com": enough to recognise yourself, not enough to harvest addresses from a forwarded link. */
function maskEmail_(e) {
  var m = /^([^@]{0,2})[^@]*(@.*)$/.exec(String(e || ''));
  return m ? m[1] + '•••' + m[2] : '';
}

// ---------------------------------------------------------------- called from the page (google.script.run)

function confirmWho_(who) {
  var email = String((who && who.email) || '').trim().toLowerCase();
  var name = String((who && who.name) || '').trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please enter your email address at the top of the page.');
  if (!name) throw new Error('Please enter your name at the top of the page.');
  var phone = String((who && who.phone) || '').trim().slice(0, 40);
  if (phone && !/^[0-9+().\-\s x ext]{7,40}$/i.test(phone)) throw new Error('Please check the phone number (digits, spaces, dashes and + only).');
  var best = String((who && who.best) || '').trim();
  if (['', 'Email', 'Text', 'Phone call', 'Any'].indexOf(best) === -1) best = '';
  return { email: email, name: name, phone: phone, best: best };
}

/** Save for later: keeps the page's state on the Links row. */
function confirmSave(token, state) {
  var link = linkRow_(token);
  if (!link) throw new Error('This link no longer works.');
  // The draft is shared by everyone with this group's link, so no personal details go in it (each browser keeps its own).
  var copy = JSON.parse(JSON.stringify(state || {}));
  var savedBy = copy.who ? String(copy.who.email || '').trim().toLowerCase() : '';
  delete copy.who;
  var json = JSON.stringify(copy);
  if (json.length > 45000) throw new Error('That is too much to save at once. Please submit what you have.');
  setLinkFields_(link, { draft: json, saved_at: nowIso_(), status: str_(link.rec.submitted_at) ? link.rec.status : 'saved for later', notes: savedBy ? 'last saved by ' + savedBy : str_(link.rec.notes) });
  return { savedAt: nowIso_() };
}

/** Finalize and Submit: applies the page's decisions to the main sheet. */
function confirmSubmit(token, state) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var link = linkRow_(token);
    if (!link) throw new Error('This link no longer works.');
    var who = confirmWho_(state && state.who);
    var t = readAll_();
    var result = confirmApply_(str_(link.rec.org_id), state, who, t);
    setLinkFields_(link, {
      status: 'submitted', submitted_at: nowIso_(), draft: '',
      point_people: pointPeopleOf_(str_(link.rec.org_id), readAll_().editors).map(function (p) { return p.email + (p.pending ? ' (pending)' : ''); }).join(', '),
      notes: 'submitted by ' + who.email + ': ' + result.summary,
    });
    var to = alertEmails_();
    if (to.length) {
      try {
        MailApp.sendEmail(to.join(','), REGION.title + ': ' + str_(link.rec.org_name) + ' checked their information',
          who.name + ' (' + who.email + ') submitted the confirmation screen for ' + str_(link.rec.org_name) + '.\n\n' + result.lines.join('\n') +
          '\n\nEvery change is in Change Log: ' + ss_().getUrl());
      } catch (e) { /* quota */ }
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Applies one submission. state = { who, org: { decision, fields }, items: { <id>: { kind, decision, fields } } }
 * decision: 'approve' (as it is, or with the edits in fields) | 'remove' | anything else = left alone.
 * Only the group's own items, and only the fields in CONFIRM_FIELDS, can be changed.
 */
function confirmApply_(orgId, state, who, t) {
  var lines = [], counts = { approved: 0, removed: 0, edited: 0 };
  var tabs = { event: [TAB.events, t.events], project: [TAB.projects, t.projects], action: [TAB.actions, t.actions] };
  var clean = function (kind, fields) {
    var out = {};
    CONFIRM_FIELDS[kind].forEach(function (k) {
      if (!fields || fields[k] === undefined || fields[k] === null) return;
      var v = k === 'online' ? (fields[k] === true || isTrue_(fields[k]) ? 'TRUE' : 'FALSE') : String(fields[k]).trim().slice(0, 4000);
      if (k === 'name' && !v) return; // a card can't lose its name
      if ((k === 'date' || k === 'end') && v && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(v)) return;
      if ((k === 'date' || k === 'end') && /T\d{2}:\d{2}$/.test(v)) v += ':00';
      if ((k === 'link' || k === 'rsvp_link' || k === 'website') && v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      out[k] = v;
    });
    return out;
  };
  var record = function (r, kind) {
    logChange_(who.email, CONFIRM_FORM, 'applied', '', kind, r.id, r.name, r.changes);
    lines.push('- ' + r.name + ' (' + kind + '): ' + r.action);
  };

  var o = state && state.org;
  if (o && o.decision === 'approve' && findById_(t.orgs, orgId)) {
    var op = clean('org', o.fields);
    var r = upsert_(TAB.orgs, 'organization', '[' + orgId + ']', '', op);
    if (r.changes) counts.edited++;
    record(r, 'organization');
  }

  var items = (state && state.items) || {};
  Object.keys(items).forEach(function (id) {
    var it = items[id] || {};
    var tab = tabs[it.kind];
    if (!tab || (it.decision !== 'approve' && it.decision !== 'remove')) return;
    var row = findById_(tab[1], id);
    if (!row || str_(row.host_org_id) !== orgId) return; // not this group's
    var patch;
    if (it.decision === 'remove') { patch = { hidden: 'TRUE' }; counts.removed++; }
    else {
      patch = clean(it.kind, it.fields);
      if (Object.keys(patch).length) counts.edited++;
      patch.verified = 'TRUE';
      patch.needs_info = 'FALSE';
      counts.approved++;
    }
    addMissingColumns_(ss_().getSheetByName(tab[0]), COLS[tab[0]]);
    record(upsert_(tab[0], it.kind, '[' + id + ']', '', patch), it.kind);
  });

  // The person filling it in becomes a point person (pending until they confirm their email), up to three per group.
  var people = pointPeopleOf_(orgId, t.editors);
  var known = people.some(function (p) { return p.email === who.email; });
  if (known || people.length < MAX_POINT_PEOPLE) {
    var a = { bestContact: who.best, via: 'the confirmation screen' }; a[Q.pointEmail] = who.email; a[Q.pointName] = who.name; a[Q.pointPhone] = who.phone;
    savePointPerson_(orgId, a, '');
    lines.push('- ' + who.email + (known ? ' (already a point person)' : ' added as a point person (asked to confirm their email)'));
  } else {
    lines.push('- ' + who.email + ' not added as a point person: the group already has ' + MAX_POINT_PEOPLE);
    logChange_(who.email, CONFIRM_FORM, 'not added', 'FULL', 'editor', orgId, orgId, 'already ' + MAX_POINT_PEOPLE + ' point people');
  }
  var summary = counts.approved + ' approved, ' + counts.removed + ' removed, ' + counts.edited + ' edited';
  return { summary: summary, lines: lines, counts: counts };
}

// ---- holds: one person edits a card at a time

function holdKey_(token, itemId) { return 'hold:' + token + ':' + itemId; }
function readHold_(cache, key) { try { return JSON.parse(cache.get(key) || 'null'); } catch (e) { return null; } }

/** Start editing a card. Returns { ok: true } or { ok: false, heldBy: name, since } when someone else has it. */
function confirmHold(token, itemId, who) {
  if (!linkRow_(token)) throw new Error('This link no longer works.');
  who = confirmWho_(who);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache(), key = holdKey_(token, itemId);
    var h = readHold_(cache, key);
    if (h && h.email !== who.email) return { ok: false, heldBy: h.name, since: h.since };
    cache.put(key, JSON.stringify({ email: who.email, name: who.name, since: (h && h.since) || nowIso_(), requests: (h && h.requests) || [] }), HOLD_SECONDS);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** Done editing a card (or handing it over). */
function confirmRelease(token, itemId, who) {
  who = confirmWho_(who);
  var cache = CacheService.getScriptCache(), key = holdKey_(token, itemId);
  var h = readHold_(cache, key);
  if (h && h.email === who.email) cache.remove(key);
  return { ok: true };
}

/** The second person asks the one editing a card to hand it over. */
function confirmAsk(token, itemId, who) {
  who = confirmWho_(who);
  var cache = CacheService.getScriptCache(), key = holdKey_(token, itemId);
  var h = readHold_(cache, key);
  if (!h) return { free: true };
  if (!h.requests.some(function (r) { return r.email === who.email; })) h.requests.push({ email: who.email, name: who.name });
  cache.put(key, JSON.stringify(h), HOLD_SECONDS);
  return { asked: true };
}

/** Every 30 s while the page is open: keeps this person's holds alive and reports others' holds and requests. */
function confirmPing(token, who, itemIds) {
  if (!linkRow_(token)) return { gone: true };
  var email = String((who && who.email) || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var out = {};
  (itemIds || []).slice(0, 200).forEach(function (id) {
    var key = holdKey_(token, id), h = readHold_(cache, key);
    if (!h) return;
    if (h.email === email) {
      cache.put(key, JSON.stringify(h), HOLD_SECONDS);
      if (h.requests.length) out[id] = { mine: true, requests: h.requests.map(function (r) { return r.name; }) };
    } else out[id] = { heldBy: h.name };
  });
  return { holds: out };
}

// ---------------------------------------------------------------- page HTML (served by confirmPage_)
var CONFIRM_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><base target="_top">',
  '<style>',
  ':root{--bg:#f6f7f9;--card:#fff;--text:#16202a;--dim:#55616e;--line:#d9dee4;--accent:#0b6e4f;--accent-soft:#e2f3eb;--warn:#8a5a00;--warn-soft:#fff3d6;--bad:#a12a2a;--bad-soft:#fbe4e4}',
  '@media (prefers-color-scheme:dark){:root{--bg:#10151b;--card:#18202a;--text:#e6ebf0;--dim:#a3aeb9;--line:#2b3540;--accent:#5fd3a6;--accent-soft:#173329;--warn:#f2c46b;--warn-soft:#3a2f17;--bad:#ff8f8f;--bad-soft:#3d1f22}}',
  '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '.wrap{max-width:760px;margin:0 auto;padding:20px 16px 120px}h1{font-size:1.5em;margin:.2em 0}h2{font-size:1.1em;margin:28px 0 8px}',
  '.lead{color:var(--dim);margin:0 0 16px}.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}',
  'label{display:block;font-size:.85em;color:var(--dim);margin:8px 0 2px}input,textarea,select{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text)}',
  'textarea{min-height:90px;resize:vertical}.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:560px){.row2{grid-template-columns:1fr}}',
  '.card{position:relative}.card .kind{font-size:.75em;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}.card h3{margin:2px 92px 4px 0;font-size:1.05em}',
  '.card .meta{color:var(--dim);font-size:.9em}.card .desc{margin:6px 0 0;white-space:pre-wrap}.card .edit-btn{position:absolute;top:12px;right:12px}',
  'button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:7px 14px}',
  'button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}',
  'button.primary{background:var(--accent);border-color:var(--accent);color:#fff}@media(prefers-color-scheme:dark){button.primary{color:#0b1a14}}',
  '.decide{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.decide button[aria-pressed="true"].ok{background:var(--accent-soft);border-color:var(--accent);font-weight:600}',
  '.decide button[aria-pressed="true"].rm{background:var(--bad-soft);border-color:var(--bad);color:var(--bad);font-weight:600}',
  '.card.removed h3,.card.removed .desc{text-decoration:line-through;opacity:.6}.held{background:var(--warn-soft);border-left:4px solid var(--warn);padding:8px 10px;border-radius:6px;margin-top:10px;font-size:.92em}',
  '.edited-tag{font-size:.75em;background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:1px 8px;margin-left:6px}',
  '.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:10px;justify-content:center;align-items:center;flex-wrap:wrap}',
  '.status{font-size:.9em;color:var(--dim);min-width:12em;text-align:center}.err{color:var(--bad)}.done{background:var(--accent-soft);border-color:var(--accent)}',
  '.empty{color:var(--dim);font-style:italic}.pp{font-size:.9em;color:var(--dim)}',
  '</style></head><body><div class="wrap" id="app"></div>',
  '<div class="bar" role="region" aria-label="Save or submit"><button type="button" id="save">Save for later</button><span class="status" id="status" aria-live="polite"></span><button type="button" class="primary" id="submit">Finalize and Submit</button></div>',
  '<script>var DATA=__DATA__;</script>',
  '<script>',
  '(function(){',
  'var KIND={org:"Your organization",event:"Event",project:"Project",action:"Action or volunteer role"};',
  'var LABEL={name:"Name",description:"Description",website:"Website",geographic_focus:"Where you work (towns or region)",public_contact:"Public contact (email or phone people can use)",date:"Starts",end:"Ends",location:"Where",online:"Online",link:"Web page",rsvp_link:"Sign-up / RSVP link",status:"Status",deadline:"Deadline"};',
  'var FIELDS=' + JSON.stringify(CONFIRM_FIELDS) + ';',
  'var cards=[DATA.org].concat(DATA.items);',
  'var st=DATA.draft||{org:{decision:"",fields:{}},items:{}};st.who={name:"",email:"",phone:"",best:""};try{var mem=JSON.parse(localStorage.getItem("confirm.me")||"null");if(mem)st.who=mem;}catch(e){}st.org=st.org||{decision:"",fields:{}};st.items=st.items||{};',
  'var editing={},holds={},dirty=false;',
  'function S(id){return cards[0].id===id?st.org:(st.items[id]=st.items[id]||{kind:find(id).kind,decision:"",fields:{}});}',
  'function find(id){for(var i=0;i<cards.length;i++)if(cards[i].id===id)return cards[i];}',
  'function val(c,k){var s=S(c.id);return s.fields&&s.fields[k]!==undefined?s.fields[k]:c[k];}',
  'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(ch){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[ch];});}',
  'function when(c){var d=val(c,"date");if(!d)return"";try{var x=new Date(d);return x.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch(e){return d;}}',
  'function el(h){var t=document.createElement("template");t.innerHTML=h.trim();return t.content.firstChild;}',
  'function msg(t,bad){var s=document.getElementById("status");s.textContent=t;s.className="status"+(bad?" err":"");}',
  'function remember(w){try{localStorage.setItem("confirm.me",JSON.stringify(w));}catch(e){}}function who(){return{name:document.getElementById("pname").value.trim(),email:document.getElementById("pemail").value.trim(),phone:document.getElementById("pphone").value.trim(),best:document.getElementById("pbest").value};}',
  'function render(){',
  ' var app=document.getElementById("app");app.innerHTML="";',
  ' app.appendChild(el("<div><h1>Check "+esc(DATA.org.name)+"\\u2019s information</h1><p class=\\"lead\\">This is what the "+esc(DATA.title)+" shows for your group. For each card, choose <b>Approve</b> (it\\u2019s right, or right after your edits) or <b>Remove</b> (it shouldn\\u2019t be on the map). Nothing changes until you press <b>Finalize and Submit</b>; <b>Save for later</b> keeps your work.</p></div>"));',
  ' if(DATA.submittedAt)app.appendChild(el("<div class=\\"box done\\">Thank you: this was submitted on "+esc(new Date(DATA.submittedAt).toLocaleDateString())+". You can check it again and submit any changes.</div>"));',
  ' var pp=DATA.pointPeople.length?"Point people on file: "+DATA.pointPeople.map(function(p){return esc(p.name||p.email)+(p.pending?" (waiting for email confirmation)":"");}).join(", ")+".":"No point person on file yet.";',
  ' var me=el("<div class=\\"box\\"><h2 style=\\"margin-top:0\\">You</h2><div class=\\"row2\\"><div><label for=\\"pname\\">Your name</label><input id=\\"pname\\" autocomplete=\\"name\\"></div><div><label for=\\"pemail\\">Your email</label><input id=\\"pemail\\" type=\\"email\\" autocomplete=\\"email\\"></div><div><label for=\\"pphone\\">Phone (optional)</label><input id=\\"pphone\\" type=\\"tel\\" autocomplete=\\"tel\\"></div><div><label for=\\"pbest\\">Best way to reach you</label><select id=\\"pbest\\"><option value=\\"\\">No preference</option><option>Email</option><option>Text</option><option>Phone call</option></select></div></div><p class=\\"pp\\">"+pp+" You\\u2019ll be added as a point person (up to "+DATA.maxPointPeople+" per group); we\\u2019ll email you a link to confirm your address. Your phone and email are only seen by the map\\u2019s core team, never shown on the map.</p></div>");',
  ' app.appendChild(me);document.getElementById("pname").value=st.who.name||"";document.getElementById("pemail").value=st.who.email||"";document.getElementById("pphone").value=st.who.phone||"";document.getElementById("pbest").value=st.who.best||"";',
  ' ["pname","pemail","pphone","pbest"].forEach(function(id){document.getElementById(id).addEventListener(id==="pbest"?"change":"input",function(){st.who=who();remember(st.who);dirty=true;});});',
  ' app.appendChild(el("<h2>Your organization</h2>"));app.appendChild(card(DATA.org));',
  ' app.appendChild(el("<h2>Events, projects and actions ("+DATA.items.length+")</h2>"));',
  ' if(!DATA.items.length)app.appendChild(el("<p class=\\"empty\\">The map has no events, projects or actions for your group yet. You can add them with the + button on the map.</p>"));',
  ' DATA.items.forEach(function(c){app.appendChild(card(c));});',
  '}',
  'function card(c){',
  ' var s=S(c.id),ed=!!editing[c.id],k=c.kind,edited=s.fields&&Object.keys(s.fields).length;',
  ' var box=el("<div class=\\"box card"+(s.decision==="remove"?" removed":"")+"\\" id=\\"card-"+esc(c.id)+"\\"></div>");',
  ' var head="<div class=\\"kind\\">"+KIND[k]+(edited?"<span class=\\"edited-tag\\">edited</span>":"")+"</div><h3>"+esc(val(c,"name")||"(no name)")+"</h3>";',
  ' var meta=[when(c),val(c,"location"),val(c,"online")===true||val(c,"online")==="TRUE"?"online":"",val(c,"status"),val(c,"deadline")?"deadline "+val(c,"deadline"):"",val(c,"geographic_focus"),val(c,"website")||val(c,"link")].filter(Boolean).map(esc).join(" \\u00b7 ");',
  ' if(!ed){box.innerHTML=head+(meta?"<div class=\\"meta\\">"+meta+"</div>":"")+(val(c,"description")?"<p class=\\"desc\\">"+esc(val(c,"description"))+"</p>":"<p class=\\"desc empty\\">No description yet.</p>")+"<button type=\\"button\\" class=\\"edit-btn\\">Edit</button>";}',
  ' else{var f="";FIELDS[k].forEach(function(key){var v=val(c,key),id="f-"+c.id+"-"+key;',
  '   if(key==="description")f+="<label for=\\""+id+"\\">"+LABEL[key]+"</label><textarea id=\\""+id+"\\" data-k=\\""+key+"\\">"+esc(v)+"</textarea>";',
  '   else if(key==="online")f+="<label><input type=\\"checkbox\\" style=\\"width:auto\\" data-k=\\"online\\""+(v===true||v==="TRUE"?" checked":"")+"> Online</label>";',
  '   else if(key==="status")f+="<label for=\\""+id+"\\">"+LABEL[key]+"</label><select id=\\""+id+"\\" data-k=\\"status\\">"+["active","planning","paused","done"].map(function(o){return"<option"+(o===v?" selected":"")+">"+o+"</option>";}).join("")+"</select>";',
  '   else{var type=key==="date"||key==="end"?"datetime-local":key==="deadline"?"date":"text";var vv=type==="datetime-local"?String(v||"").slice(0,16):type==="date"?String(v||"").slice(0,10):v;f+="<label for=\\""+id+"\\">"+LABEL[key]+"</label><input id=\\""+id+"\\" type=\\""+type+"\\" data-k=\\""+key+"\\" value=\\""+esc(vv)+"\\">";}});',
  '  box.innerHTML="<div class=\\"kind\\">"+KIND[k]+" \\u00b7 editing</div>"+f+"<div class=\\"decide\\"><button type=\\"button\\" class=\\"primary done-btn\\">Done editing</button><button type=\\"button\\" class=\\"cancel-btn\\">Cancel</button></div>";}',
  ' var n=notice(c);if(n)box.appendChild(n);',
  ' if(!ed){var d=el("<div class=\\"decide\\" role=\\"group\\" aria-label=\\"Decision\\"><button type=\\"button\\" class=\\"ok\\" aria-pressed=\\""+(s.decision==="approve")+"\\">\\u2713 Approve</button>"+(k==="org"?"":"<button type=\\"button\\" class=\\"rm\\" aria-pressed=\\""+(s.decision==="remove")+"\\">Remove</button>")+"</div>");box.appendChild(d);}',
  ' box.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;',
  '  if(b.classList.contains("edit-btn"))return startEdit(c);',
  '  if(b.classList.contains("done-btn")){var fs={};box.querySelectorAll("[data-k]").forEach(function(i){var key=i.getAttribute("data-k"),v=i.type==="checkbox"?i.checked:i.value.trim();var orig=c[key];if(i.type==="checkbox"?(v!==(orig===true||orig==="TRUE")):String(v)!==String(orig||"").slice(0,i.type==="datetime-local"?16:i.type==="date"?10:9999))fs[key]=v;});s.fields=fs;s.decision="approve";dirty=true;return endEdit(c);}',
  '  if(b.classList.contains("cancel-btn"))return endEdit(c);',
  '  if(b.classList.contains("ok")){s.decision=s.decision==="approve"?"":"approve";dirty=true;return rerender(c);}',
  '  if(b.classList.contains("rm")){s.decision=s.decision==="remove"?"":"remove";dirty=true;return rerender(c);}',
  '  if(b.classList.contains("ask-btn")){if(!ready())return;google.script.run.withSuccessHandler(function(r){msg(r&&r.free?"It\\u2019s free now: press Edit.":"Asked. You\\u2019ll be able to edit it once it\\u2019s handed over.");if(r&&r.free){delete holds[c.id];rerender(c);}}).withFailureHandler(fail).confirmAsk(DATA.token,c.id,who());}',
  '  if(b.classList.contains("give-btn")){editing[c.id]=false;delete holds[c.id];rerender(c);google.script.run.withSuccessHandler(function(){delete holds[c.id];rerender(c);}).withFailureHandler(fail).confirmRelease(DATA.token,c.id,who());}',
  ' });',
  ' return box;',
  '}',
  'function notice(c){var h=holds[c.id];if(h&&h.heldBy)return el("<div class=\\"held\\">"+esc(h.heldBy)+" is editing this right now. <button type=\\"button\\" class=\\"ask-btn\\">Ask for it</button></div>");if(h&&h.mine&&h.requests&&h.requests.length)return el("<div class=\\"held\\">"+esc(h.requests.join(", "))+" would like to edit this. <button type=\\"button\\" class=\\"give-btn\\">Hand it over</button></div>");return null;}',
  // an open card keeps what is being typed: only its notice changes
  'function rerender(c,soft){var old=document.getElementById("card-"+c.id);if(!old)return;if(soft&&editing[c.id]){var o=old.querySelector(".held");if(o)o.remove();var n=notice(c);if(n)old.appendChild(n);return;}old.replaceWith(card(c));}',
  'function ready(){st.who=who();if(!st.who.name||!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(st.who.email)){msg("Please enter your name and email at the top first.",true);document.getElementById(st.who.name?"pemail":"pname").focus();return false;}return true;}',
  'function startEdit(c){if(!ready())return;msg("Opening\\u2026");google.script.run.withSuccessHandler(function(r){if(r.ok){editing[c.id]=true;delete holds[c.id];msg("");rerender(c);var f=document.querySelector("#card-"+CSS.escape(c.id)+" [data-k]");if(f)f.focus();}else{holds[c.id]={heldBy:r.heldBy};msg("");rerender(c);}}).withFailureHandler(fail).confirmHold(DATA.token,c.id,who());}',
  'function endEdit(c){editing[c.id]=false;rerender(c);google.script.run.withFailureHandler(function(){}).confirmRelease(DATA.token,c.id,who());}',
  'function fail(e){msg((e&&e.message)||"Something went wrong. Please try again.",true);}',
  'document.getElementById("save").addEventListener("click",function(){st.who=who();msg("Saving\\u2026");google.script.run.withSuccessHandler(function(){dirty=false;msg("Saved. Open this same link to pick up where you left off.");}).withFailureHandler(fail).confirmSave(DATA.token,st);});',
  'document.getElementById("submit").addEventListener("click",function(){if(!ready())return;if(Object.keys(editing).some(function(k){return editing[k];})){msg("Press \\u201cDone editing\\u201d on the open card first.",true);return;}',
  ' var n=cards.filter(function(c){return !S(c.id).decision;}).length;if(n&&!confirm(n+" card(s) have no decision yet and will be left as they are. Submit anyway?"))return;',
  ' msg("Submitting\\u2026");document.getElementById("submit").disabled=true;',
  ' google.script.run.withSuccessHandler(function(r){dirty=false;document.getElementById("app").innerHTML="<div class=\\"box done\\"><h1>Thank you!</h1><p>Your changes are on the map ("+esc(r.summary)+"). Check your email for a link to confirm your address as a point person.</p><p>You can open this link again any time to make more changes.</p></div>";document.querySelector(".bar").remove();}).withFailureHandler(function(e){document.getElementById("submit").disabled=false;fail(e);}).confirmSubmit(DATA.token,st);});',
  'window.addEventListener("beforeunload",function(e){if(dirty){e.preventDefault();e.returnValue="";}});',
  'setInterval(function(){var w=who();if(!w.email)return;google.script.run.withSuccessHandler(function(r){if(!r||!r.holds)return;cards.forEach(function(c){var nh=r.holds[c.id]||null,oh=holds[c.id]||null;if(JSON.stringify(nh)===JSON.stringify(oh))return;if(nh)holds[c.id]=nh;else delete holds[c.id];rerender(c,true);});}).confirmPing(DATA.token,w,cards.map(function(c){return c.id;}));},30000);',
 'render();',
  '})();',
  '</script></body></html>',
].join('\n');
