// Sign-in for the on-map forms (Nov 5): "Sign in with Google" or a login link by email ("Confirm with email",
// for Yahoo, Hotmail, …). Either way the sheet script (apps-script/SignIn.gs) gives back a session token that
// works for 30 days; it is kept in this browser only. Signed in, the + menu's forms are sent straight to the
// map (src/quickform.ts) instead of through the Google Form. The script still checks every submission against
// the Editors tab, so the token alone can't change anything a person doesn't manage.
import { LIVE_DATA_URL } from "./data.config";
import { GOOGLE_CLIENT_ID } from "./signin.config";
import { h } from "./dom";

export interface Session { token: string; email: string; expires: number; how: string }
export type Answers = Record<string, string | string[]>;
type Reply = Record<string, any>;

const KEY = "mycc-session";
const listeners = new Set<() => void>();
let current: Session | null = load();

function load(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && typeof s.token === "string" && typeof s.email === "string" && s.expires > Date.now()) return s;
    localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
  return null;
}
function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: signed in for this page only */ }
}

/** The current session, or null (signed out or expired). */
export function session(): Session | null {
  if (current && current.expires <= Date.now()) setSession(null);
  return current;
}
function setSession(s: Session | null) {
  current = s;
  save(s);
  listeners.forEach((fn) => fn());
}
export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function signOut(): void {
  setSession(null);
  try { window.google?.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
}
// Another tab signed in or out
window.addEventListener("storage", (e) => {
  if (e.key === KEY) { current = load(); listeners.forEach((fn) => fn()); }
});

/** A reply that carries a session (Google sign-in, Log in): keep it. */
function keep(r: Reply): void {
  if (r.ok && r.session) setSession({ token: r.session, email: r.email, expires: Date.parse(r.expires), how: r.how });
}

/** POST to the sheet's web app, the same way the confirmation page does (no cookies, text/plain: no preflight). */
export async function api(body: Reply): Promise<Reply> {
  try {
    const res = await fetch(LIVE_DATA_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), credentials: "omit", redirect: "follow" });
    return await res.json();
  } catch {
    return { ok: false, error: "Couldn't reach the map's server. Check your connection and try again." };
  }
}

/** Sends the filled-in form as the signed-in person. On an expired session, signs out (the answers stay put). */
export async function submitSignedIn(kind: string, answers: Answers): Promise<Reply> {
  const s = session();
  if (!s) return { ok: false, signedOut: true, error: "Please sign in first." };
  const r = await api({ action: "submitForm", session: s.token, kind, answers });
  if (r.signedOut) setSession(null);
  return r;
}

/** "Confirm with email": asks for a login link (with the form waiting for it, when there is one). */
export function requestLoginLink(email: string, kind?: string, answers?: Answers): Promise<Reply> {
  return api(kind ? { action: "emailLink", email, kind, answers } : { action: "emailLink", email });
}

// ---------------------------------------------------------------- Google Identity Services

interface GoogleId {
  initialize(o: Record<string, unknown>): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

export const googleEnabled = (): boolean => !!GOOGLE_CLIENT_ID;
let gis: Promise<GoogleId> | null = null;
let onGoogle: ((r: Reply) => void) | null = null;
function loadGoogle(): Promise<GoogleId> {
  gis ??= new Promise<GoogleId>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      const id = window.google?.accounts.id;
      if (!id) return reject(new Error("no Google"));
      id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        callback: async (resp: { credential?: string }) => {
          const r = resp.credential ? await api({ action: "google", credential: resp.credential }) : { ok: false, error: "Google sign-in was cancelled." };
          keep(r);
          onGoogle?.(r);
        },
      });
      resolve(id);
    };
    s.onerror = () => { gis = null; reject(new Error("Google sign-in couldn't load")); };
    document.head.appendChild(s);
  });
  return gis;
}

/** Puts Google's own "Sign in with Google" button in `box`. `done` gets the script's reply after sign-in. */
export function googleButton(box: HTMLElement, done: (r: Reply) => void): void {
  if (!googleEnabled()) return;
  loadGoogle()
    .then((id) => {
      box.replaceChildren();
      id.renderButton(box, { type: "standard", theme: "filled_black", size: "large", shape: "pill", text: "signin_with", width: 260 });
      // Google's button is an iframe, so clicks inside it aren't seen here: the button the pointer last
      // entered (or the last one drawn) gets the reply.
      onGoogle = done;
      box.addEventListener("pointerenter", () => { onGoogle = done; });
      box.addEventListener("focusin", () => { onGoogle = done; });
    })
    .catch(() => { box.replaceChildren(h("span", { class: "acct-note" }, "Google sign-in couldn't load. Use your email instead.")); });
}

// ---------------------------------------------------------------- top right: "Sign in" / signed-in email

/** The top bar's account button and its panel (Google, or a login link by email; Sign out when signed in). */
export function accountButton(): HTMLElement {
  const wrap = h("div", { class: "acct-wrap" });
  const btn = h("button", { type: "button", class: "acct-btn", "aria-haspopup": "dialog", "aria-expanded": "false" }) as HTMLButtonElement;
  const panel = h("div", { class: "acct-panel", role: "dialog", "aria-label": "Sign in" });
  panel.hidden = true;
  wrap.append(btn, panel);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) renderPanel();
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(panel.hidden); });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target as Node)) setOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); } });

  function renderButton() {
    const s = session();
    btn.classList.toggle("on", !!s);
    btn.title = s ? `Signed in as ${s.email}` : "Point people: sign in to send the + forms straight to the map";
    btn.replaceChildren(
      h("span", { class: "acct-avatar", "aria-hidden": "true" }, s ? s.email[0].toUpperCase() : "👤"),
      h("span", { class: "acct-word" }, s ? s.email : "Sign in"),
    );
    btn.setAttribute("aria-label", s ? `Signed in as ${s.email}` : "Sign in");
  }

  function renderPanel() {
    const s = session();
    if (s) {
      const out = h("button", { type: "button", class: "acct-out" }, "Sign out");
      out.addEventListener("click", () => { signOut(); setOpen(false); });
      panel.replaceChildren(
        h("div", { class: "acct-head" }, "Signed in"),
        h("p", { class: "acct-email" }, s.email),
        h("p", { class: "acct-note" }, `Until ${new Date(s.expires).toLocaleDateString(undefined, { month: "short", day: "numeric" })} on this device. The + forms are sent straight to the map for the groups you're a point person for.`),
        out,
      );
      return;
    }
    const msg = h("p", { class: "acct-msg", role: "status" });
    const gbox = h("div", { class: "acct-google" });
    googleButton(gbox, (r) => {
      if (r.ok) setOpen(false);
      else msg.textContent = r.error || "Google sign-in didn't work.";
    });
    panel.replaceChildren(
      h("div", { class: "acct-head" }, "Sign in"),
      h("p", { class: "acct-note" }, "For point people: once you're signed in, the + forms are sent straight to the map."),
      ...(googleEnabled() ? [gbox] : []),
      emailBox(msg, () => undefined),
      msg,
    );
  }

  renderButton();
  onSessionChange(() => { renderButton(); if (!panel.hidden) renderPanel(); });
  return wrap;
}

/** Email field + Send button. With a form (`form()` returns its kind and answers), the form waits for the link. */
export function emailBox(msg: HTMLElement, form: () => { kind: string; answers: Answers } | undefined, onSent?: () => void): HTMLElement {
  const label = googleEnabled() ? "Or get a login link by email (Yahoo, Hotmail, …)" : "Get a login link by email";
  const input = h("input", { type: "email", class: "acct-input", placeholder: "you@example.org", autocomplete: "email", "aria-label": "Your email" }) as HTMLInputElement;
  const send = h("button", { type: "button", class: "acct-send" }, "Send") as HTMLButtonElement;
  const go = async () => {
    const email = input.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Please enter your email address."; input.focus(); return; }
    send.disabled = true;
    msg.textContent = "Sending…";
    const f = form();
    const r = await requestLoginLink(email, f?.kind, f?.answers);
    send.disabled = false;
    msg.textContent = r.ok ? r.message : r.error || "That didn't work. Please try again.";
    if (r.ok) onSent?.();
  };
  send.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  return h("div", { class: "acct-emailbox" }, h("span", { class: "acct-label" }, label), h("div", { class: "acct-row" }, input, send));
}

// ---------------------------------------------------------------- the page a login link opens

/**
 * A login link (…/?login=token) opens the map. Nothing happens until the person presses "Log in", so email
 * scanners that open links on their own (Outlook, some Yahoo filters) can't use it up.
 */
export function handleLoginLink(): void {
  const params = new URLSearchParams(location.search);
  const token = params.get("login");
  if (token === null) return;
  params.delete("login");
  const rest = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);

  const text = h("p", { class: "qf-note login-text" }, "Press Log in to finish signing in. If you filled in a form, it's sent to the map at the same time.");
  const btn = h("button", { type: "button", class: "qf-go" }, "Log in") as HTMLButtonElement;
  const cancel = h("button", { type: "button", class: "qf-cancel" }, "Cancel");
  const dialog = h("div", { class: "qf login-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Log in" },
    h("div", { class: "qf-head" }, h("h2", {}, "Log in to the map")), text, h("div", { class: "qf-foot" }, cancel, btn));
  const shade = h("div", { class: "qf-shade login-shade" }, dialog);
  const close = () => shade.remove();
  const done = (message: string) => {
    text.textContent = message;
    btn.remove();
    cancel.textContent = "Close";
    cancel.focus();
  };
  cancel.addEventListener("click", close);
  shade.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    text.textContent = "Logging in…";
    const r = await api({ action: "login", token });
    if (!r.ok) return done(r.error || "That didn't work. Please ask for a new link.");
    keep(r);
    done(`You're signed in as ${r.email} on this device for 30 days.${r.result?.message ? ` ${r.result.message}` : ""}`);
  });
  document.body.appendChild(shade);
  btn.focus();
}
