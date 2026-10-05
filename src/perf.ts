// Animation level for the Topics views. "Full" draws everything; "Simple" draws fewer, plainer particles at
// a lower canvas resolution. With no choice saved, the views start in Full and switch themselves to Simple
// when the browser can't keep up (frames slower than about 20 per second for a few seconds).

export type AnimChoice = "full" | "simple";
const KEY = "openthink.anim.v1";
const SLOW_MS = 50; // a frame interval above this (under ~20 fps) counts as slow
const SLOW_FOR_MS = 4000; // ...for this long before switching

let choice: AnimChoice | null = null;
try {
  const v = localStorage.getItem(KEY);
  if (v === "full" || v === "simple") choice = v;
} catch {
  /* ignore */
}
let auto = false; // switched to Simple automatically (this visit only)
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** True when the views should draw the simple animation. */
export const animSimple = () => (choice ?? (auto ? "simple" : "full")) === "simple";
/** True when Simple was turned on automatically (not chosen). */
export const animAuto = () => choice === null && auto;

export function setAnim(c: AnimChoice) {
  choice = c;
  if (c === "full") auto = false;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* ignore */
  }
  notify();
}

/** Call fn whenever the level changes; returns an unsubscribe function. */
export function onAnimChange(fn: () => void): () => void {
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
    // a tab switch or a pause, not slowness
    slowSince = 0;
    return;
  }
  ema = ema ? ema * 0.92 + intervalMs * 0.08 : intervalMs;
  if (!firstAt) firstAt = now;
  if (++samples < 20 || now - firstAt < 2000) return; // let things settle first
  if (ema > SLOW_MS) {
    if (!slowSince) slowSince = now;
    else if (now - slowSince > SLOW_FOR_MS) {
      auto = true;
      notify();
    }
  } else slowSince = 0;
}

/** For tests: forget the saved choice and the automatic switch. */
export function resetAnim() {
  choice = null;
  auto = false;
  ema = 0;
  samples = 0;
  firstAt = 0;
  slowSince = 0;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
}
(window as unknown as { __anim?: unknown }).__anim = { animSimple, animAuto, setAnim, resetAnim };
