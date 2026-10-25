// Visual effects level for the Topics views (Nathan, Oct 24: one control on the Topics bar to lessen the effects
// for slower devices). Three steps:
//   0 "Less": few particles, ~15 frames a second, no ripples or sparks (low-power devices start here)
//   1 "Some": the light animation, ~30 frames a second (the default)
//   2 "More": more particles, ripples and sparks, full frame rate
// With no choice saved, the views drop to "Less" by themselves when the browser can't keep up.
import { h } from "./dom";

export type FxLevel = 0 | 1 | 2;
export const FX_LEVELS: { level: FxLevel; label: string; hint: string }[] = [
  { level: 0, label: "Less", hint: "Fewest moving particles and no extra effects. Best for older phones and slow computers." },
  { level: 1, label: "Some", hint: "A light animation that runs well on most devices." },
  { level: 2, label: "More", hint: "More particles, ripples and sparks. For fast computers." },
];
const KEY = "openthink.topics.fx.v1";
const SLOW_MS = 40; // a frame interval above this (under ~25 fps) counts as slow
const SLOW_FOR_MS = 3000; // ...for this long before dropping to "Less"

let choice: FxLevel | null = null;
try {
  const v = Number(localStorage.getItem(KEY));
  if (localStorage.getItem(KEY) !== null && (v === 0 || v === 1 || v === 2)) choice = v;
} catch {
  /* ignore */
}
let auto = false; // dropped to "Less" automatically (this visit only)
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const lowPowerDevice = () => document.documentElement.classList.contains("low-power");

/** The effects level the views should draw now. */
export function fxLevel(): FxLevel {
  if (choice !== null) return choice;
  return lowPowerDevice() || auto ? 0 : 1;
}
/** True when "Less" was turned on automatically (not chosen). */
export const fxAuto = () => choice === null && auto;

/** Per-level drawing budget shared by both views. */
export function fxBudget(level: FxLevel = fxLevel()) {
  return {
    frameMs: level === 0 ? 66 : level === 1 ? 31 : 15, // minimum time between frames
    particles: level === 0 ? 0.2 : level === 1 ? 0.35 : 0.8, // share of the full particle budget
    extras: level === 2, // ripples, sparks, sprouts
    dprMax: level === 0 ? 1 : level === 1 ? 1.5 : 2, // canvas sharpness
  };
}

export function setFxLevel(l: FxLevel) {
  choice = l;
  auto = false;
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
  if (choice !== null || auto || fxLevel() === 0) return;
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
      auto = true;
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
  const note = h("span", { class: "cr-anim-note", title: "Turned down by itself because this device was drawing slowly. Pick another level to change it." }, "auto");
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
