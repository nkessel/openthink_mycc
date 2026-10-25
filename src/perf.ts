// Visual effects level for the Topics views (Nathan, Oct 24: one control on the Topics bar to lessen the effects
// for slower devices). Three steps:
//   0 "Less": few particles, ~15 frames a second, no ripples or sparks
//   1 "Some": the light animation, ~30 frames a second
//   2 "More": the full picture: every particle, trail, ripple and spark (the default, Oct 24)
// With "Reduce motion" on (Accessibility), nothing flows at all: the views show a still picture (see stillPicture).
//
// Keeping a slow device smooth without making the picture worse (Oct 24): with no level chosen, a device that can't
// keep up first draws the canvas a little less sharp, then at 30 frames a second (the particles move slowly, so
// that looks the same), and only then drops to "Some". Particles, trails and the paths that light up on hover stay.
import { h } from "./dom";

export type FxLevel = 0 | 1 | 2;
export const FX_LEVELS: { level: FxLevel; label: string; hint: string }[] = [
  { level: 0, label: "Less", hint: "Fewest moving particles and no extra effects. Best for older phones and slow computers." },
  { level: 1, label: "Some", hint: "A light animation that runs well on most devices." },
  { level: 2, label: "More", hint: "More particles, ripples and sparks. For fast computers." },
];
const KEY = "openthink.topics.fx.v2"; // v2: "More" is the default again
const SLOW_MS = 40; // a frame interval above this (under ~25 fps) counts as slow
const SLOW_FOR_MS = 3000; // ...for this long before dropping to "Less"

let choice: FxLevel | null = null;
try {
  const v = Number(localStorage.getItem(KEY));
  if (localStorage.getItem(KEY) !== null && (v === 0 || v === 1 || v === 2)) choice = v;
} catch {
  /* ignore */
}
let auto = false; // dropped to "Some" automatically (this visit only)
let ease = 0; // 0 = full quality; 1 = softer canvas; 2 = also 30 fps (this visit only, before dropping a level)
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const lowPowerDevice = () => document.documentElement.classList.contains("low-power");

/** The effects level the views should draw now. */
export function fxLevel(): FxLevel {
  if (choice !== null) return choice;
  return auto ? 1 : 2;
}
/** Reduce motion (Accessibility → Reduce motion, or the system setting): comets and seeds stop; a still picture. */
export function stillPicture(): boolean {
  return lowPowerDevice() || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}
/** True when a lower level was turned on automatically (not chosen). */
export const fxAuto = () => choice === null && auto;

/** Per-level drawing budget shared by both views. */
export function fxBudget(level: FxLevel = fxLevel()) {
  const e = choice === null && level === 2 ? ease : 0;
  return {
    frameMs: level === 0 ? 66 : level === 1 || e >= 2 ? 31 : 15, // minimum time between frames
    particles: level === 0 ? 0.2 : level === 1 ? 0.35 : 1, // share of the full particle budget
    extras: level === 2, // trails, ripples, sparks, sprouts
    dprMax: level === 0 ? 1 : level === 1 || e >= 1 ? 1.5 : 2, // canvas sharpness
  };
}

export function setFxLevel(l: FxLevel) {
  choice = l;
  auto = false;
  ease = 0;
  try {
    localStorage.setItem(KEY, String(l));
  } catch {
    /* ignore */
  }
  notify();
}

/** Call fn whenever the level changes; returns an unsubscribe function. */
export function onFxChange(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

// frame governor: an average of recent frame intervals, measured only while the page is visible
let ema = 0;
let slowSince = 0;
let samples = 0;
let firstAt = 0;
/** Report one animation frame's interval (ms since the previous frame). */
export function reportFrame(intervalMs: number, now: number) {
  if (choice !== null || auto) return;
  if (document.visibilityState !== "visible" || intervalMs > 1000) {
    slowSince = 0; // a tab switch or a pause, not slowness
    return;
  }
  // the views skip frames on purpose (frameMs), so judge against that, not against 60 fps
  const expected = fxBudget().frameMs;
  const slow = Math.max(SLOW_MS, expected * 1.4);
  ema = ema ? ema * 0.92 + intervalMs * 0.08 : intervalMs;
  if (!firstAt) firstAt = now;
  if (++samples < 20 || now - firstAt < 2000) return; // let things settle first
  if (ema > slow) {
    if (!slowSince) slowSince = now;
    else if (now - slowSince > SLOW_FOR_MS) {
      // one step at a time: softer canvas, then 30 fps, then the "Some" level
      if (ease < 2) ease++;
      else auto = true;
      slowSince = 0;
      ema = 0;
      samples = 0;
      firstAt = 0;
      notify();
    }
  } else slowSince = 0;
}

/** The "Visual effects: Less · Some · More" control for the Topics bar. */
export function fxControl(): HTMLElement {
  const seg = h("div", { class: "cr-seg topics-fxseg", role: "group", "aria-label": "Visual effects" });
  const btns = FX_LEVELS.map((f) => {
    const b = h("button", { type: "button", "data-l": String(f.level), title: f.hint }, f.label) as HTMLButtonElement;
    b.addEventListener("click", () => setFxLevel(f.level));
    seg.appendChild(b);
    return b;
  });
  const note = h("span", { class: "cr-anim-note", title: "Turned down by itself because this device was drawing slowly. Pick a level to choose for yourself." }, "auto");
  const sync = () => {
    for (const b of btns) {
      const on = Number(b.dataset.l) === fxLevel();
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    note.style.display = fxAuto() ? "" : "none";
  };
  sync();
  onFxChange(sync);
  return h("div", { class: "cr-ctl topics-fx" }, h("span", { class: "cr-ctl-label" }, "Visual effects"), seg, note);
}

(window as unknown as { __fx?: unknown }).__fx = { fxLevel, setFxLevel };
