// Two whole-site display modes, remembered in this browser:
//  - Large print: bigger text and buttons, fewer things on screen (no item dots around groups, no legend, no
//    Topics page), for anyone who finds the full map too busy or too small to read.
//  - Low-power: no decorative animation and the Topics page in its Simple style, for older phones and tablets.
//    Turned on automatically on devices that report very little memory or very few processor cores.
// Both work by a class on <html> (styles.css) plus a few checks elsewhere (perf.ts, index.html's loading screen).

const LP = "openthink.lowpower";
const LG = "openthink.largeprint";

function stored(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}
function store(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** A device that reports at most 2 GB of memory or 2 processor cores starts in low-power mode. */
export function weakDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || (navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency <= 2);
}

const root = document.documentElement;
const subs = new Set<() => void>();
export function onDisplayChange(f: () => void) {
  subs.add(f);
}

export const lowPower = () => root.classList.contains("low-power");
export const largePrint = () => root.classList.contains("large-print");

export function setLowPower(on: boolean, remember = true) {
  root.classList.toggle("low-power", on);
  if (remember) store(LP, on);
  subs.forEach((f) => f());
}
export function setLargePrint(on: boolean) {
  root.classList.toggle("large-print", on);
  store(LG, on);
  subs.forEach((f) => f());
}

/** Apply the saved choices (or the automatic low-power guess) before anything is drawn. */
export function initDisplay() {
  root.classList.toggle("low-power", stored(LP) ?? weakDevice());
  root.classList.toggle("large-print", stored(LG) ?? false);
}

function switchRow(label: string, hint: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "control";
  const top = document.createElement("div");
  top.className = "toggle-row";
  const l = document.createElement("label");
  l.className = "ctrl-label";
  l.textContent = label;
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", label);
  sw.innerHTML = '<span class="knob"></span>';
  const sync = () => {
    sw.classList.toggle("on", get());
    sw.setAttribute("aria-checked", String(get()));
  };
  sync();
  onDisplayChange(sync);
  sw.addEventListener("click", () => set(!get()));
  top.append(l, sw);
  const h = document.createElement("div");
  h.className = "ctrl-hint";
  h.textContent = hint;
  row.append(top, h);
  return row;
}

/** The two switches for Map settings → Advanced display settings. */
export function displayControls(): HTMLElement {
  const box = document.createElement("div");
  box.append(
    switchRow("Large print", "Bigger text, fewer things on screen, simpler pages.", largePrint, setLargePrint),
    switchRow("Low-power mode", weakDevice() ? "On by default for this device: no decorative animation, lighter Topics page." : "No decorative animation and a lighter Topics page, for older phones and tablets.", lowPower, (v) => setLowPower(v)),
  );
  return box;
}

/** The "Aa" button in the top bar: large print on or off in one tap. */
export function largePrintButton(): HTMLElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lp-btn";
  const sync = () => {
    b.setAttribute("aria-pressed", String(largePrint()));
    b.title = largePrint() ? "Large print is on — tap for the full map" : "Large print: bigger text, fewer things on screen";
    b.textContent = "Aa";
  };
  sync();
  onDisplayChange(sync);
  b.addEventListener("click", () => setLargePrint(!largePrint()));
  return b;
}
