/**
 * Group Confirmation Screen (10/29 meeting): each organization and coalition gets its own private link. The link
 * opens a page with everything the map has for that group (its details, events, projects and actions). The point
 * person enters their name and email, then for each card: Edit, Approve or Remove. "Save for later" keeps their
 * work (and the page autosaves as they type); "Finalize and Submit" puts it on the map: approved items are marked
 * verified, removed items are hidden, edits are written in, and every change goes in Change Log. The point person
 * (plus up to two others they name) is added to the Editors tab (up to three per group), pending until they open
 * the email confirmation link.
 *
 * The page itself is static (confirm.html on the map's site, address in CONFIRM_PAGE_URL). It talks to this web
 * app with plain requests and no cookies (Nov 3: Apps Script's own pages fail with "Sorry, unable to open the file"
 * when the browser is signed into several Google accounts). GET ?api=confirm&t=TOKEN returns the page's data; POST
 * (doPost in Code.gs → confirmPost_) takes claim, takeover, ping, release, save, submit and verify.
 *
 * The links live in their own spreadsheet, shared only with the core team (not in the repo, not in the public
 * data): menu → "Make confirmation links". Its id is the script property LINKS_SHEET_ID.
 *
 * One editor at a time per link: whoever claims the page holds a lock (CacheService, LOCK_SECONDS) that their open
 * page keeps alive with a ping every few seconds. Anyone else can look, and press "Take over". The first
 * "Finalize and Submit" wins: a submit that was started from an older version of the page is refused.
 *
 * Paste this file next to Code.gs in Apps Script (+ → Script → "Confirm"). It uses Code.gs's helpers.
 */

var LINK_TAB = 'Links';
var LINK_COLS = ['org_id', 'org_name', 'link', 'status', 'point_people', 'opened_at', 'saved_at', 'submitted_at', 'notes', 'token', 'draft', 'kind'];
var MAX_POINT_PEOPLE = 3;
/** The page lock lasts this long without a ping (longer than a background tab's throttled timer, about 60 s). */
var LOCK_SECONDS = 150;
var PING_SECONDS = 15;
/** Fields a point person can change on each kind of card (sheet column names). */
var CONFIRM_FIELDS = {
  org: ['name', 'description', 'website', 'geographic_focus', 'public_contact'],
  coalition: ['name', 'description', 'website', 'geographic_scope'],
  event: ['name', 'date', 'end', 'location', 'online', 'description', 'link', 'rsvp_link'],
  project: ['name', 'description', 'status', 'location', 'online', 'link'],
  action: ['name', 'description', 'deadline', 'link'],
};
var CONFIRM_FORM = 'Confirmation screen';
/** Where the static confirmation page lives (override with the script property CONFIRM_PAGE_URL). */
var DEFAULT_CONFIRM_PAGE_URL = 'https://ma.climateorgmap.earth/confirm.html';

function confirmPageUrl_() {
  return PropertiesService.getScriptProperties().getProperty('CONFIRM_PAGE_URL') || DEFAULT_CONFIRM_PAGE_URL;
}

// ---------------------------------------------------------------- links spreadsheet (admins)

/** Menu: makes (or tops up) the private links spreadsheet: one row and one link per organization and coalition. */
function makeConfirmationLinks() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('LINKS_SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create(REGION.title + ': confirmation links (private)');
    props.setProperty('LINKS_SHEET_ID', ss.getId());
    adminEmails_().forEach(function (e) { try { ss.addEditor(e); } catch (err) { /* share by hand */ } });
  }
  var added = addConfirmationLinks_(ss, readAll_(), confirmPageUrl_());
  var msg = 'Confirmation links: ' + added + ' new row(s). The spreadsheet: ' + ss.getUrl() +
    '\nIt is shared only with the admins. Send each group its own link (column "link").';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor */ }
  return msg;
}

/**
 * Menu: points every existing link at the current confirmation page address (CONFIRM_PAGE_URL) and marks the
 * rows made before coalitions had links as organizations. Tokens never change, so links already sent keep working.
 */
function updateConfirmationLinkAddresses() {
  var sheet = linksSheet_();
  var msg;
  if (!sheet) msg = 'There is no links spreadsheet yet: run "Make confirmation links" first.';
  else {
    addMissingColumns_(sheet, LINK_COLS);
    var table = readTable_(sheet);
    var page = confirmPageUrl_();
    var n = Math.max(0, sheet.getLastRow() - 1);
    var linkCol = table.headers.indexOf('link') + 1, kindCol = table.headers.indexOf('kind') + 1;
    var links = n ? sheet.getRange(2, linkCol, n, 1).getValues() : [];
    var kinds = n ? sheet.getRange(2, kindCol, n, 1).getValues() : [];
    var changed = 0;
    table.rows.forEach(function (r) {
      var i = r._row - 2, token = str_(r.token);
      if (!token || i < 0 || i >= n) return;
      var want = page + '?t=' + token;
      if (str_(links[i][0]) !== want) { links[i][0] = want; changed++; }
      if (!str_(kinds[i][0])) kinds[i][0] = 'organization';
    });
    if (n) {
      sheet.getRange(2, linkCol, n, 1).setValues(links);
      sheet.getRange(2, kindCol, n, 1).setValues(kinds);
    }
    msg = 'Confirmation links: ' + changed + ' link(s) now point to ' + page + '.';
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run from the editor */ }
  return msg;
}

/** Adds a row (with a new secret token) for every visible organization and every coalition that has none yet. Returns how many. */
function addConfirmationLinks_(ss, t, pageUrl) {
  var sheet = ss.getSheetByName(LINK_TAB);
  if (!sheet) {
    sheet = ss.getSheets && ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(LINK_TAB) : ss.insertSheet(LINK_TAB);
    sheet.getRange(1, 1, 1, LINK_COLS.length).setValues([LINK_COLS]);
    try { sheet.setFrozenRows(1); sheet.hideColumns(LINK_COLS.indexOf('token') + 1, 2); } catch (e) { /* fake sheet in tests */ }
  } else {
    addMissingColumns_(sheet, LINK_COLS); // sheets made before coalitions had links get the kind column
  }
  var have = {};
  readTable_(sheet).rows.forEach(function (r) { have[linkKind_(r) + ':' + str_(r.org_id)] = true; });
  var editors = t.editors || [];
  var n = 0;
  var add = function (kind, g) {
    if (have[kind + ':' + g.id]) return;
    var token = newToken_();
    appendObject_(sheet, {
      org_id: g.id, org_name: str_(g.name), kind: kind, token: token,
      link: pageUrl ? pageUrl + '?t=' + token : '(set CONFIRM_PAGE_URL, then run "Update confirmation link addresses")',
      status: 'not sent', point_people: pointPeopleOf_(g.id, editors, kind).map(function (p) { return p.email; }).join(', '),
    });
    have[kind + ':' + g.id] = true;
    n++;
  };
  t.orgs.filter(function (o) { return o.id && !isTrue_(o.hidden); }).sort(byName_).forEach(function (o) { add('organization', o); });
  (t.coalitions || []).filter(function (c) { return c.id && !isTrue_(c.hidden); }).sort(byName_).forEach(function (c) { add('coalition', c); });
  return n;
}

/** "organization" or "coalition" (rows made before coalitions had links have no kind: organizations). */
function linkKind_(rec) { return str_(rec.kind).toLowerCase() === 'coalition' ? 'coalition' : 'organization'; }

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

/**
 * Confirmed and pending point people (Editors rows naming this group; admins and "*" rows don't count).
 * kind 'coalition' looks at coalition_ids, anything else at org_ids (so the forms' calls stay as they were).
 */
function pointPeopleOf_(id, editors, kind) {
  var col = kind === 'coalition' ? 'coalition_ids' : 'org_ids';
  return (editors || []).filter(function (r) {
    return r.email && !/^admin$/i.test(str_(r.role)) && list_(r[col]).indexOf(id) !== -1;
  }).map(function (r) { return { email: String(r.email).trim().toLowerCase(), name: str_(r.name), pending: isPending_(r) }; });
}

// ---------------------------------------------------------------- the web app's JSON (doGet / doPost)

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function badLinkMessage_() {
  return 'This link doesn\'t work. Please ask the ' + REGION.title + ' team for a new one.';
}

/** doGet(?confirm=token): links already sent point here; the page now lives on the map's site. */
function confirmMovedPage_(token) {
  var ok = /^[0-9a-f]{32}$/.test(String(token || ''));
  var body = ok
    ? 'This page has moved. <a target="_top" href="' + confirmPageUrl_().replace(/[<>&"]/g, '') + '?t=' + token + '">Open your group\'s page here</a>.'
    : badLinkMessage_().replace(/[<>&]/g, '');
  return HtmlService.createHtmlOutput('<p style="font:17px system-ui;max-width:520px;margin:48px auto;padding:0 16px">' + body + '</p>')
    .setTitle(REGION.title);
}

/** doGet(?api=confirm&t=token): everything the page shows, or { ok: false, error }. */
function confirmApiGet_(token) {
  try {
    var link = linkRow_(token);
    if (!link) return { ok: false, error: badLinkMessage_() };
    var data = confirmData_(link.rec, readAll_());
    if (!str_(link.rec.opened_at)) setLinkFields_(link, { opened_at: nowIso_(), status: str_(link.rec.status) === 'not sent' || !str_(link.rec.status) ? 'opened' : link.rec.status });
    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: friendlyError_(err) };
  }
}

/** doPost: body is JSON { action, token, sid, ... }. Never throws. */
function confirmPost_(e) {
  try {
    var b = null;
    try { b = JSON.parse((e && e.postData && e.postData.contents) || ''); } catch (x) { b = null; }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, error: 'That request could not be read. Please reload the page and try again.' };
    var action = String(b.action || '');
    if (action === 'verify') return { ok: true, message: confirmVerification_(String(b.verify || '')) };
    if (['claim', 'takeover', 'ping', 'release', 'save', 'submit'].indexOf(action) === -1) return { ok: false, error: 'Please reload the page and try again.' };
    var token = String(b.token || '');
    if (!/^[0-9a-f]{32}$/.test(token)) return action === 'ping' ? { ok: false, gone: true, error: badLinkMessage_() } : { ok: false, error: badLinkMessage_() };
    var sid = String(b.sid || '');
    if (!/^[0-9a-f]{32}$/.test(sid)) return { ok: false, error: 'Please reload the page and try again.' };
    if (action === 'release') return confirmRelease_(token, sid);
    return withScriptLock_(function () {
      var link = linkRow_(token);
      if (!link) return action === 'ping' ? { ok: false, gone: true, error: badLinkMessage_() } : { ok: false, error: badLinkMessage_() };
      if (action === 'claim') return confirmClaim_(link, token, sid, b, false);
      if (action === 'takeover') return confirmClaim_(link, token, sid, b, true);
      if (action === 'ping') return confirmPing_(link, token, sid, b);
      if (action === 'save') return confirmSave_(link, token, sid, b);
      return confirmSubmit_(link, token, sid, b);
    });
  } catch (err) {
    return { ok: false, error: friendlyError_(err) };
  }
}

/** Plain messages we wrote are shown as they are; anything else (Google service errors, bugs) is not. */
function friendlyError_(err) {
  var m = err && err.message ? String(err.message) : '';
  if (err && err.name === 'Error' && m && !/^Exception/.test(m)) return m;
  try { console.error(err && err.stack ? err.stack : String(err)); } catch (x) { /* no console */ }
  return 'Something went wrong. Please try again in a moment.';
}

function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- the page lock: one editor at a time

function lockKey_(token) { return 'lock:' + token; }
function readLock_(token) { try { return JSON.parse(CacheService.getScriptCache().get(lockKey_(token)) || 'null'); } catch (e) { return null; } }
/** sid, name, since (when this person took it), at (last ping); replaced = sids that were taken over, so they hear "lost". */
function putLock_(token, h) { CacheService.getScriptCache().put(lockKey_(token), JSON.stringify(h), LOCK_SECONDS); }
function personName_(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 60) || 'Someone'; }

/** Takes the lock for sid (keeps `since` when it already had it). h = the lock as it was. */
function takeLock_(token, sid, name, h) {
  var now = nowIso_();
  var replaced = ((h && h.replaced) || []).filter(function (x) { return x !== sid; });
  if (h && h.sid !== sid) replaced.unshift(h.sid);
  putLock_(token, { sid: sid, name: personName_(name), since: h && h.sid === sid ? h.since : now, at: now, replaced: replaced.slice(0, 5) });
}

function holderMessage_(h) { return (h ? h.name : 'Someone') + ' is editing this page now. Press Take over to edit.'; }

function draftOf_(rec) {
  var draft = null;
  try { draft = str_(rec.draft) ? JSON.parse(str_(rec.draft)) : null; } catch (e) { draft = null; }
  if (draft) { delete draft.who; delete draft.others; } // never show one person's details to the next
  return draft;
}

function editorState_(rec) {
  return { ok: true, editor: true, draft: draftOf_(rec), draftAt: str_(rec.saved_at), submittedAt: str_(rec.submitted_at) };
}

function confirmClaim_(link, token, sid, b, takeover) {
  var h = readLock_(token);
  if (h && h.sid !== sid && !takeover) return { ok: true, editor: false, heldBy: h.name, since: h.since };
  takeLock_(token, sid, b.name, h);
  if (takeover && h && h.sid !== sid) {
    setLinkFields_(link, { notes: 'taken over by ' + personName_(b.name) + ' at ' + nowIso_() });
  }
  return editorState_(link.rec);
}

/** Every ~15 s from an open page: keeps the lock alive, autosaves a changed page, tells viewers what the editor did. */
function confirmPing_(link, token, sid, b) {
  var rec = link.rec, h = readLock_(token);
  var draftAt = str_(rec.saved_at);
  var others = function (heldBy, since, lost) {
    var out = { ok: true, editor: false, heldBy: heldBy, since: since, lost: lost, draftAt: draftAt, submittedAt: str_(rec.submitted_at) };
    if (str_(b.draftAt) !== draftAt) out.draft = draftOf_(rec); // viewers see the editor's work without reloading
    return out;
  };
  if (h && h.sid !== sid) return others(h.name, h.since, (h.replaced || []).indexOf(sid) !== -1);
  // The lock ran out: take it back quietly, but only if nobody saved in between (otherwise their work would be overwritten).
  if (!h && b.draftAt !== undefined && b.draftAt !== null && str_(b.draftAt) !== draftAt) return others('', '', true);
  takeLock_(token, sid, b.name, h);
  var out = { ok: true, editor: true };
  if (b.state !== undefined && b.state !== null) out.savedAt = saveDraft_(link, b.state, true).savedAt;
  return out;
}

function confirmRelease_(token, sid) {
  var h = readLock_(token);
  if (h && h.sid === sid) CacheService.getScriptCache().remove(lockKey_(token));
  return { ok: true };
}

// ---- the group's data

/** Everything the page shows for one group: its details, its items, its point people and any saved draft. */
function confirmData_(rec, t) {
  var id = str_(rec.org_id);
  var kind = linkKind_(rec);
  var coalition = kind === 'coalition';
  var o = findById_(coalition ? t.coalitions : t.orgs, id) || { id: id, name: rec.org_name };
  var pick = function (row, k) {
    var out = { id: str_(row.id), kind: k };
    CONFIRM_FIELDS[k].forEach(function (f) { out[f] = f === 'online' ? isTrue_(row[f]) : str_(row[f]); });
    if (k !== 'org' && k !== 'coalition') { out.verified = isTrue_(row.verified); out.needs_info = isTrue_(row.needs_info); }
    return out;
  };
  // An organization's items are the ones it hosts; a coalition's are the ones tagged with it (member orgs' too).
  var mine = function (rows, k) {
    return rows.filter(function (r) { return r.id && !isTrue_(r.hidden) && ownsItem_(kind, id, r); })
      .map(function (r) { return pick(r, k); });
  };
  return {
    token: str_(rec.token), title: REGION.title, kind: kind, submittedAt: str_(rec.submitted_at),
    org: pick(o, coalition ? 'coalition' : 'org'),
    items: mine(t.events, 'event').concat(mine(t.projects, 'project'), mine(t.actions, 'action')),
    fields: CONFIRM_FIELDS,
    pointPeople: pointPeopleOf_(id, t.editors, kind).map(function (p) { return { name: p.name, pending: p.pending, email: maskEmail_(p.email) }; }),
    maxPointPeople: MAX_POINT_PEOPLE, draft: draftOf_(rec), draftAt: str_(rec.saved_at),
    lockSeconds: LOCK_SECONDS, pingSeconds: PING_SECONDS,
  };
}

function ownsItem_(kind, id, row) {
  return kind === 'coalition' ? str_(row.coalition_id) === id : str_(row.host_org_id) === id;
}

/** "na•••@gmail.com": enough to recognise yourself, not enough to harvest addresses from a forwarded link. */
function maskEmail_(e) {
  var m = /^([^@]{0,2})[^@]*(@.*)$/.exec(String(e || ''));
  return m ? m[1] + '•••' + m[2] : '';
}

// ---------------------------------------------------------------- saving and submitting

/**
 * Checks a person's details. `other` = one of the extra point people (the messages then talk about "them").
 * "Best way to reach" only means something with a phone number, so it is cleared without one.
 */
function confirmWho_(who, other) {
  var email = String((who && who.email) || '').trim().toLowerCase();
  var name = String((who && who.name) || '').trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(other ? 'Please check the email address of the other point person.' : 'Please enter your email address at the top of the page.');
  if (!name) throw new Error(other ? 'Please enter the name of the other point person (' + email + ').' : 'Please enter your name at the top of the page.');
  var phone = String((who && who.phone) || '').trim().slice(0, 40);
  if (phone && !/^[0-9+().\-\s x ext]{7,40}$/i.test(phone)) throw new Error('Please check the phone number' + (other ? ' for ' + name : '') + ' (digits, spaces, dashes and + only).');
  var best = String((who && who.best) || '').trim();
  if (!phone || ['', 'Email', 'Text', 'Phone call', 'Any'].indexOf(best) === -1) best = '';
  return { email: email, name: name, phone: phone, best: best };
}

/** The extra point people on the page: blank rows are skipped, the rest must be complete. At most two. */
function confirmOthers_(state) {
  var rows = state && Array.isArray(state.others) ? state.others.slice(0, 2) : [];
  return rows.filter(function (w) {
    return w && (String(w.name || '').trim() || String(w.email || '').trim() || String(w.phone || '').trim());
  }).map(function (w) { return confirmWho_(w, true); });
}

/** Writes the page's state on the Links row. The shared draft never holds personal details (each browser keeps its own). */
function saveDraft_(link, state, auto) {
  if (!state || typeof state !== 'object') throw new Error('There is nothing to save yet.');
  var copy = JSON.parse(JSON.stringify(state));
  var savedBy = copy.who ? String(copy.who.email || '').trim().toLowerCase() : '';
  delete copy.who; delete copy.others;
  var json = JSON.stringify(copy);
  if (json.length > 45000) throw new Error('That is too much to save at once. Please submit what you have.');
  var at = nowIso_();
  if (auto) {
    // Autosave touches only the draft: notes may hold an admin's own text or the submitter's name.
    setLinkFields_(link, { draft: json, saved_at: at, status: str_(link.rec.submitted_at) ? link.rec.status : 'in progress' });
  } else {
    setLinkFields_(link, { draft: json, saved_at: at, status: str_(link.rec.submitted_at) ? link.rec.status : 'saved for later', notes: savedBy ? 'last saved by ' + savedBy : str_(link.rec.notes) });
  }
  return { savedAt: at };
}

/** Save for later: only the person editing (or anyone, when nobody is). */
function confirmSave_(link, token, sid, b) {
  var h = readLock_(token);
  if (h && h.sid !== sid) return { ok: false, error: holderMessage_(h) };
  var r = saveDraft_(link, b.state);
  takeLock_(token, sid, b.name, h);
  return { ok: true, savedAt: r.savedAt };
}

/** Finalize and Submit: applies the page's decisions to the main sheet. The first one to submit wins. */
function confirmSubmit_(link, token, sid, b) {
  var h = readLock_(token);
  if (h && h.sid !== sid) return { ok: false, error: holderMessage_(h) };
  var was = str_(link.rec.submitted_at);
  if (was !== str_(b.baseSubmittedAt)) {
    var m = /^submitted by (.*?) \(/.exec(str_(link.rec.notes));
    return { ok: false, conflict: true, error: (m ? m[1] : 'Someone') + ' already submitted this page at ' + was.slice(0, 16).replace('T', ' ') +
      ' UTC. Reload to see what\'s on the map now.' };
  }
  var state = b.state;
  var who = confirmWho_(state && state.who);
  var others = confirmOthers_(state);
  var id = str_(link.rec.org_id), kind = linkKind_(link.rec);
  var result = confirmApply_(id, state, who, readAll_(), kind, others);
  var at = nowIso_();
  setLinkFields_(link, {
    status: 'submitted', submitted_at: at, draft: '',
    point_people: pointPeopleOf_(id, readAll_().editors, kind).map(function (p) { return p.email + (p.pending ? ' (pending)' : ''); }).join(', '),
    notes: 'submitted by ' + who.name.replace(/[()]/g, '') + ' (' + who.email + '): ' + result.summary,
  });
  CacheService.getScriptCache().remove(lockKey_(token));
  var to = alertEmails_();
  if (to.length) {
    try {
      MailApp.sendEmail(to.join(','), REGION.title + ': ' + str_(link.rec.org_name) + ' checked their information',
        who.name + ' (' + who.email + ') submitted the confirmation screen for ' + str_(link.rec.org_name) + '.\n\n' + result.lines.join('\n') +
        '\n\nEvery change is in Change Log: ' + ss_().getUrl());
    } catch (e) { /* quota */ }
  }
  result.ok = true;
  result.submittedAt = at;
  return result;
}

/**
 * Applies one submission. state = { who, others, org: { decision, fields }, items: { <id>: { kind, decision, fields } } }
 * decision: 'approve' (as it is, or with the edits in fields) | 'remove' | anything else = left alone.
 * Only the group's own items, and only the fields in CONFIRM_FIELDS, can be changed. kind is 'organization' (the
 * default) or 'coalition'; others = extra point people, already checked by confirmWho_.
 */
function confirmApply_(orgId, state, who, t, kind, others) {
  var coalition = kind === 'coalition';
  var cardKind = coalition ? 'coalition' : 'org';
  var lines = [], counts = { approved: 0, removed: 0, edited: 0 };
  var tabs = { event: [TAB.events, t.events], project: [TAB.projects, t.projects], action: [TAB.actions, t.actions] };
  var clean = function (k, fields) {
    var out = {};
    CONFIRM_FIELDS[k].forEach(function (f) {
      if (!fields || fields[f] === undefined || fields[f] === null) return;
      var v = f === 'online' ? (fields[f] === true || isTrue_(fields[f]) ? 'TRUE' : 'FALSE') : String(fields[f]).trim().slice(0, 4000);
      if (f === 'name' && !v) return; // a card can't lose its name
      if ((f === 'date' || f === 'end') && v && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(v)) return;
      if ((f === 'date' || f === 'end') && /T\d{2}:\d{2}$/.test(v)) v += ':00';
      if ((f === 'link' || f === 'rsvp_link' || f === 'website') && v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      out[f] = v;
    });
    return out;
  };
  var record = function (r, type) {
    logChange_(who.email, CONFIRM_FORM, 'applied', '', type, r.id, r.name, r.changes);
    lines.push('- ' + r.name + ' (' + type + '): ' + r.action);
  };

  var o = state && state.org;
  if (o && o.decision === 'approve' && findById_(coalition ? t.coalitions : t.orgs, orgId)) {
    var op = clean(cardKind, o.fields);
    var r = upsert_(coalition ? TAB.coalitions : TAB.orgs, coalition ? 'coalition' : 'organization', '[' + orgId + ']', '', op);
    if (r.changes) counts.edited++;
    record(r, coalition ? 'coalition' : 'organization');
  }

  var items = (state && state.items) || {};
  Object.keys(items).forEach(function (id) {
    var it = items[id] || {};
    var tab = tabs[it.kind];
    if (!tab || (it.decision !== 'approve' && it.decision !== 'remove')) return;
    var row = findById_(tab[1], id);
    if (!row || !ownsItem_(coalition ? 'coalition' : 'organization', orgId, row)) return; // not this group's
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

  // Point people (pending until they confirm their email), up to three per group: first the person filling it in,
  // then anyone they named. Someone already on file is skipped, so nobody can overwrite another person's details.
  var people = function () { return pointPeopleOf_(orgId, readTable_(ss_().getSheetByName(TAB.editors)).rows, kind); };
  var addPerson = function (w, label, keepDetails) {
    var now = people();
    var known = now.some(function (p) { return p.email === w.email; });
    if (known) {
      lines.push('- ' + w.email + ' (already a point person' + (keepDetails ? ': their details were not changed' : '') + ')');
      if (keepDetails) logChange_(w.email, CONFIRM_FORM, 'skipped', 'ON FILE', 'editor', orgId, orgId, label + ' is already a point person; details not changed');
      if (!keepDetails) {
        var a0 = { bestContact: w.best, via: 'the confirmation screen', groupKind: cardKind }; a0[Q.pointEmail] = w.email; a0[Q.pointName] = w.name; a0[Q.pointPhone] = w.phone;
        savePointPerson_(orgId, a0, '');
      }
      return;
    }
    if (now.length >= MAX_POINT_PEOPLE) {
      lines.push('- ' + w.email + ' not added as a point person: the group already has ' + MAX_POINT_PEOPLE);
      logChange_(w.email, CONFIRM_FORM, 'not added', 'FULL', 'editor', orgId, orgId, 'already ' + MAX_POINT_PEOPLE + ' point people');
      return;
    }
    var a = { bestContact: w.best, via: 'the confirmation screen', groupKind: cardKind, keepDetails: keepDetails }; a[Q.pointEmail] = w.email; a[Q.pointName] = w.name; a[Q.pointPhone] = w.phone;
    savePointPerson_(orgId, a, '');
    var added = people().filter(function (p) { return p.email === w.email; })[0];
    lines.push('- ' + w.email + ' added as ' + label + (added && !added.pending ? '' : ' (asked to confirm their email)'));
    if (keepDetails) logChange_(w.email, CONFIRM_FORM, 'added', 'PENDING', 'editor', orgId, orgId, label + ' named by ' + who.email);
  };
  addPerson(who, 'a point person', false);
  (others || []).forEach(function (w) { addPerson(w, 'another point person', true); });

  var summary = counts.approved + ' approved, ' + counts.removed + ' removed, ' + counts.edited + ' edited';
  return { summary: summary, lines: lines, counts: counts };
}
