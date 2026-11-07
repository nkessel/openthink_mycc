/**
 * Sign-in for the on-map forms (Nov 5). The + menu's forms can be sent straight from the map, without the
 * Google Form step, once the person has signed in one of two ways:
 *  - "Sign in with Google" (top right, or in the form): the site gets a Google ID token, and this script checks
 *    it with Google (tokeninfo) against the script property GOOGLE_CLIENT_ID.
 *  - "Confirm with email" (for Yahoo, Hotmail, …): the site sends the email and the filled-in form. If the email
 *    is on the Editors tab (or ADMIN_EMAILS), it gets a one-time link that works for 15 minutes. The link opens
 *    the map, which asks the person to press "Log in" (so email link scanners can't use it up); that signs them in
 *    and sends the waiting form. An email that isn't on file gets no email: its form goes to Needs Review,
 *    marked as unconfirmed. The site always shows the same neutral message, so nobody can use it to find out
 *    whose email is on file.
 * Either way the person stays signed in for 30 days: a session token signed with the script property
 * SESSION_SECRET (made automatically). Delete SESSION_SECRET to sign everyone out.
 *
 * Every submission still goes through processSubmission_ (Code.gs): the same access check against the Editors
 * tab (point person of the group picked in the form), Needs Review, Change Log and emails as the Google Forms.
 * Removing someone from Editors takes away their access straight away, even if they are still signed in.
 *
 * Paste this file next to Code.gs and Confirm.gs in Apps Script (+ → Script → "SignIn"), then deploy a new version.
 */

var SIGNIN_ACTIONS = ['google', 'emailLink', 'login', 'submitForm'];
var SESSION_DAYS = 30;
var LOGIN_LINK_MINUTES = 15;
var LOGIN_LINKS_PER_EMAIL = 3; // per 15 minutes, so the form can't be used to flood someone's inbox
var LOGIN_PREFIX = 'LOGIN_';
var UNCONFIRMED_PER_HOUR = 20; // forms from emails that aren't on file (see sendLoginLink_)
var FORM_KINDS = ['org', 'event', 'project', 'action'];

/** Where login links point: the map's home page (override with the script property SITE_URL). */
function siteUrl_() {
  var url = PropertiesService.getScriptProperties().getProperty('SITE_URL') || confirmPageUrl_().replace(/confirm\.html.*$/, '');
  return url.replace(/\/?$/, '/');
}

/** doPost for the sign-in actions. b is the parsed JSON body. */
function signInPost_(action, b) {
  if (action === 'google') return googleSignIn_(String(b.credential || ''));
  if (action === 'emailLink') return sendLoginLink_(b);
  if (action === 'login') return redeemLogin_(String(b.token || ''));
  return submitSignedIn_(b);
}

// ---------------------------------------------------------------- sessions (30 days)

function sessionSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SESSION_SECRET');
  if (!s) {
    s = newToken_() + newToken_();
    p.setProperty('SESSION_SECRET', s);
  }
  return s;
}
function b64_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
function unb64_(s) {
  var padded = s + '===='.slice(0, (4 - (s.length % 4)) % 4);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
}
function signature_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, sessionSecret_())).replace(/=+$/, '');
}
/** Compares two strings in time that doesn't depend on where they differ. */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A signed session token: base64url(JSON {e: email, x: expiry ms, h: how}) + "." + HMAC. */
function makeSession_(email, how) {
  var exp = Date.now() + SESSION_DAYS * 864e5;
  var payload = b64_(JSON.stringify({ e: email, x: exp, h: how }));
  return { ok: true, session: payload + '.' + signature_(payload), email: email, expires: new Date(exp).toISOString(), how: how };
}

/** The session's email, or null when the token is missing, altered or expired. */
function readSession_(token) {
  var m = /^([A-Za-z0-9_-]{10,800})\.([A-Za-z0-9_-]{20,100})$/.exec(String(token || ''));
  if (!m || !sameText_(signature_(m[1]), m[2])) return null;
  var p;
  try { p = JSON.parse(unb64_(m[1])); } catch (e) { return null; }
  if (!p || typeof p.e !== 'string' || !/@/.test(p.e) || !(Number(p.x) > Date.now())) return null;
  return { email: p.e, expires: Number(p.x), how: String(p.h || '') };
}

// ---------------------------------------------------------------- Google sign-in

/** Checks a Google ID token (from the site's "Sign in with Google" button) and starts a session. */
function googleSignIn_(credential) {
  var clientId = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim();
  if (!clientId) return { ok: false, error: 'Google sign-in isn\'t set up yet. Please use "Confirm with email" instead.' };
  if (!/^[A-Za-z0-9_.-]{100,4096}$/.test(credential)) return { ok: false, error: 'Google sign-in didn\'t work. Please try again.' };
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'Google sign-in didn\'t work. Please try again.' };
  var info;
  try { info = JSON.parse(res.getContentText()); } catch (e) { info = null; }
  var email = info ? String(info.email || '').trim().toLowerCase() : '';
  var good = info && info.aud === clientId && /^(https:\/\/)?accounts\.google\.com$/.test(String(info.iss)) &&
    String(info.email_verified) === 'true' && Number(info.exp) * 1000 > Date.now() && /@/.test(email);
  if (!good) return { ok: false, error: 'Google sign-in didn\'t work. Please try again.' };
  return makeSession_(email, 'google');
}

// ---------------------------------------------------------------- "Confirm with email" (login links)

function validEmail_(email) { return /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(email) && email.length <= 200; }

/**
 * Only real question titles (Q in Code.gs) of the right form get through, as text or lists of text, so nothing
 * from the site can set the script's own internal fields. Returns null when the form can't be used.
 */
function cleanForm_(kind, answers) {
  if (FORM_KINDS.indexOf(kind) === -1 || !answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  var titles = {};
  Object.keys(Q).forEach(function (k) { if (typeof Q[k] === 'string') titles[Q[k]] = true; });
  var out = {}, size = 0;
  for (var key in answers) {
    if (!Object.prototype.hasOwnProperty.call(answers, key) || !titles[key]) continue;
    var v = answers[key];
    if (Array.isArray(v)) {
      v = v.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 200).map(function (x) { return x.trim().slice(0, 500); });
      if (!v.length) continue;
    } else if (typeof v === 'string') {
      v = v.trim().slice(0, 10000);
      if (!v) continue;
    } else continue;
    out[key] = v;
    size += JSON.stringify(v).length;
  }
  var which = { org: Q.whichOrg, event: Q.whichEvent, project: Q.whichProject, action: Q.whichAction }[kind];
  if (!out[which] || size > 60000) return null;
  return out;
}

/** Sends a login link (with the filled-in form waiting for it) to an email that's on file. */
function sendLoginLink_(b) {
  var email = String(b.email || '').trim().toLowerCase();
  if (!validEmail_(email)) return { ok: false, error: 'Please enter a valid email address.' };
  var form = null;
  if (b.kind) {
    var a = cleanForm_(String(b.kind), b.answers);
    if (!a) return { ok: false, error: 'That form could not be read. Please reload the page and try again.' };
    form = { kind: String(b.kind), answers: a };
  }
  var neutral = form
    ? 'Thanks. If ' + email + ' belongs to a point person for this group, we\'ve emailed a link to log in and send your changes. ' +
      'It works for ' + LOGIN_LINK_MINUTES + ' minutes (check Junk or Spam too). If it doesn\'t, the map team will check your changes.'
    : 'Thanks. If ' + email + ' belongs to a point person, we\'ve emailed a link to log in. It works for ' + LOGIN_LINK_MINUTES +
      ' minutes (check Junk or Spam too).';
  return withScriptLock_(function () {
    var cache = CacheService.getScriptCache();
    var rateKey = 'LOGINRATE_' + email;
    var sent = Number(cache.get(rateKey) || 0);
    if (sent >= LOGIN_LINKS_PER_EMAIL) {
      return { ok: false, error: 'We\'ve already sent a few links to that address. Please check your email (and Junk), or try again in ' + LOGIN_LINK_MINUTES + ' minutes.' };
    }
    cache.put(rateKey, String(sent + 1), LOGIN_LINK_MINUTES * 60);
    var t = readAll_();
    if (permissionsFor_(email, t.editors).known) {
      var token = newToken_();
      cache.put(LOGIN_PREFIX + token, JSON.stringify({ email: email, form: form, exp: Date.now() + LOGIN_LINK_MINUTES * 60000 }), LOGIN_LINK_MINUTES * 60);
      var url = siteUrl_() + '?login=' + token;
      logChange_(email, 'Sign-in', 'login link sent', '', 'sign-in', '', '', form ? 'waiting to send: ' + FORM_NAMES[form.kind] : '');
      try {
        // Wording chosen by the team (Nov 6). Signed with MAIL_NAME (the sender name) when it's set.
        var signOff = String(PropertiesService.getScriptProperties().getProperty('MAIL_NAME') || '').trim() || REGION.title;
        sendMail_(email, 'Your link to update the ' + REGION.title,
          'Hi! Here\'s your login link for the ' + REGION.title + ':\n\n' + url + '\n\n' +
          'Tap it, then press "Log in" (it works for ' + LOGIN_LINK_MINUTES + ' minutes). ' +
          'You\'ll stay logged in on this device for ' + SESSION_DAYS + ' days.' +
          (form ? ' Your changes to "' + FORM_NAMES[form.kind] + '" are sent when you log in.' : '') + '\n\n' +
          'It\'s a secure personal link, so please don\'t forward it. Teammates who need edit access can be added as point people using the link.\n\n' +
          'Thanks for keeping the map accurate!\n' +
          'Didn\'t ask for this? You can ignore it; nothing changes.\n\n— ' + signOff);
      } catch (e) {
        return { ok: false, error: 'We couldn\'t send the email right now. Please try again later, or use the Google Form.' };
      }
    } else if (form) {
      // Not on file: no email (nobody has shown this address is theirs). The form waits in Needs Review with no
      // email attached, so it is never applied automatically for someone else's address; the team sees the typed one.
      // Anyone can send these, so at most UNCONFIRMED_PER_HOUR an hour reach Needs Review (and the admins' inbox).
      var held = Number(cache.get('UNCONFIRMED_HOUR') || 0);
      if (held < UNCONFIRMED_PER_HOUR) {
        cache.put('UNCONFIRMED_HOUR', String(held + 1), 3600);
        NOTE_ = 'typed email (not confirmed): ' + email;
        VIA_ = 'email not confirmed';
        try { processSubmission_(form.kind, form.answers, '', null); } finally { NOTE_ = ''; VIA_ = ''; }
      }
    }
    return { ok: true, message: neutral };
  });
}

/** The "Log in" button on the page a login link opens: one use, then gone. */
function redeemLogin_(token) {
  if (!/^[0-9a-f]{32}$/.test(token)) return { ok: false, error: loginExpired_() };
  return withScriptLock_(function () {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(LOGIN_PREFIX + token);
    if (!raw) return { ok: false, error: loginExpired_() };
    cache.remove(LOGIN_PREFIX + token);
    var v;
    try { v = JSON.parse(raw); } catch (e) { return { ok: false, error: loginExpired_() }; }
    if (!(v.exp > Date.now())) return { ok: false, error: loginExpired_() };
    var out = makeSession_(v.email, 'email');
    if (v.form) out.result = submitAs_(v.email, v.form.kind, v.form.answers, 'email link');
    return out;
  });
}
function loginExpired_() {
  return 'This login link has expired or was already used. Links work for ' + LOGIN_LINK_MINUTES + ' minutes: go back to the map and ask for a new one.';
}

// ---------------------------------------------------------------- sending a form while signed in

function submitSignedIn_(b) {
  var s = readSession_(b.session);
  if (!s) return { ok: false, signedOut: true, error: 'Your sign-in has expired. Please sign in again; your answers are still here.' };
  var kind = String(b.kind || '');
  var a = cleanForm_(kind, b.answers);
  if (!a) return { ok: false, error: 'That form could not be read. Please reload the page and try again.' };
  return withScriptLock_(function () {
    var out = submitAs_(s.email, kind, a, s.how === 'google' ? 'Google sign-in' : 'email sign-in');
    out.ok = true;
    return out;
  });
}

/** Runs the same checks and saving as a Google Form submission, and says what happened, for the site to show. */
function submitAs_(email, kind, a, via) {
  OUTCOME_ = { queued: '' };
  VIA_ = via;
  var queued = '';
  try {
    processSubmission_(kind, a, email, null);
  } finally {
    queued = OUTCOME_.queued || '';
    OUTCOME_ = null;
    VIA_ = '';
  }
  if (!queued) return { status: 'live', message: 'Saved. It shows on the map within a few minutes (reload the page to see it).' };
  if (/^UNAUTHORIZED/.test(queued)) {
    return { status: 'review', notOnFile: true, message: 'This email isn\'t registered with a point person for this group. Your changes were sent to the map team to review.' };
  }
  var why = queued.split(' · ')[0];
  return { status: 'review', message: 'Your changes were sent to the map team to check first: ' + (why.split(' — ')[1] || why) + '.' };
}
