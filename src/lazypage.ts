// Each page (Geographic, Events, Organizations, Projects, Actions, Topics) is its own download, fetched the first
// time it's opened, so the map opens without waiting for the others (10/18: "load each page separately"). When
// nobody has touched the page for a moment, the next page is fetched and set up in the background, so switching
// to it is still instant.
import { h } from "./dom";
import { lowPower } from "./display";

export interface LazyPage<T extends { el: HTMLElement }> {
  /** The page's box in the content area: shown and hidden by the tabs, filled once the page has loaded. */
  holder: HTMLElement;
  /** The page, loading it first if needed. */
  get(): Promise<T>;
  /** The page if it has loaded, else null. */
  now(): T | null;
  /** Download the page's code only (no setup): the light preload for low-power devices. */
  warm(): Promise<unknown>;
}

export function lazyPage<M, T extends { el: HTMLElement }>(
  content: HTMLElement,
  name: string,
  importer: () => Promise<M>,
  build: (mod: M) => T,
): LazyPage<T> {
  const holder = h("div", { class: "lazy-page", style: "display:none;position:absolute;inset:0;height:100%" });
  content.appendChild(holder);
  let view: T | null = null;
  let loading: Promise<T> | null = null;
  let mod: Promise<M> | null = null;
  const warm = () => (mod ??= importer());
  const get = (): Promise<T> =>
    (loading ??= (async () => {
      // Only shown if the download takes a moment (first visit on a slow connection).
      const note = h("div", { class: "lazy-loading", role: "status" }, `Loading ${name}…`);
      const t = setTimeout(() => holder.appendChild(note), 250);
      try {
        const v = build(await warm());
        v.el.style.height = "100%";
        v.el.style.position = "absolute";
        v.el.style.inset = "0";
        holder.appendChild(v.el);
        view = v;
        return v;
      } catch (err) {
        loading = null; // let the next tap try again
        mod = null;
        holder.appendChild(h("div", { class: "lazy-loading" }, `Couldn't load ${name}. Check your connection and tap the tab again.`));
        throw err;
      } finally {
        clearTimeout(t);
        note.remove();
      }
    })());
  return { holder, get, now: () => view, warm };
}

/**
 * Loads the pages one at a time while the page is quiet: no pointer, key, wheel or touch for 2 seconds, the tab
 * visible, and the browser idle. On low-power devices or Save-Data connections only the code is downloaded.
 */
export function preloadWhenQuiet(pages: LazyPage<{ el: HTMLElement }>[], startAfterMs = 3000): void {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  let last = performance.now();
  const touched = () => (last = performance.now());
  const evs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
  evs.forEach((e) => window.addEventListener(e, touched, { passive: true, capture: true }));
  const idle = (cb: () => void) =>
    "requestIdleCallback" in window ? window.requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 200);
  const queue = [...pages];
  const next = () => {
    const p = queue.shift();
    if (!p) {
      evs.forEach((e) => window.removeEventListener(e, touched, { capture: true }));
      return;
    }
    if (p.now()) return next();
    const tryNow = () => {
      if (document.visibilityState !== "visible" || performance.now() - last < 2000) {
        setTimeout(tryNow, 1000);
        return;
      }
      idle(() => {
        if (performance.now() - last < 2000) return void setTimeout(tryNow, 1000);
        (lowPower() ? p.warm() : p.get()).catch(() => undefined).finally(() => setTimeout(next, 500));
      });
    };
    tryNow();
  };
  setTimeout(next, startAfterMs);
}
