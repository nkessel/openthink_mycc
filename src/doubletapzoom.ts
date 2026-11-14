// One-finger zoom for phones (Nov 12): tap twice and keep the second tap down, then drag down to zoom in or up to
// zoom out, as in the maps apps. A plain double tap still does whatever the view did before (zoom in, reset…).
//
// The view's own handlers (d3-zoom, d3-drag, Leaflet) would pan or drag during the second touch, so while the
// gesture runs its events are stopped here, in the capture phase, before they reach them.

const TAP_MS = 280;      // longest a touch may last and still count as a tap
const GAP_MS = 320;      // longest pause between the first tap and the second touch
const TAP_SLOP = 28;     // px the two taps may be apart
const DRAG_START = 7;    // px of vertical movement before the drag takes over from a plain double tap
const PX_PER_DOUBLING = 110; // drag this far to double (or halve) the zoom

export interface DoubleTapZoomTarget {
  /** Current zoom as a scale factor (2 = twice as large). */
  getScale(): number;
  /** Zoom to this scale, keeping the point `at` ([x, y] inside the element, in px) where it is. */
  zoomTo(scale: number, at: [number, number]): void;
  /** Called once when the drag starts and once when it ends, e.g. to pause another gesture handler. */
  onActive?(active: boolean): void;
}

export function attachDoubleTapDragZoom(el: Element, target: DoubleTapZoomTarget): void {
  let down: { t: number; x: number; y: number } | null = null; // the touch now down, while it may still be a tap
  let lastTap: { t: number; x: number; y: number } | null = null;
  let g: { y0: number; k0: number; at: [number, number]; moved: boolean; target: EventTarget | null; x: number; y: number } | null = null;

  const swallow = (e: Event, prevent = true) => {
    e.stopPropagation();
    if (prevent && e.cancelable) e.preventDefault();
  };
  const begin = (x: number, y: number, t: EventTarget | null): boolean => {
    if (g) return true;
    if (!lastTap || performance.now() - lastTap.t > GAP_MS || Math.hypot(x - lastTap.x, y - lastTap.y) > TAP_SLOP) return false;
    const r = el.getBoundingClientRect();
    g = { y0: y, k0: target.getScale(), at: [x - r.left, y - r.top], moved: false, target: t, x, y };
    lastTap = null;
    return true;
  };
  const move = (y: number) => {
    if (!g) return;
    const dy = y - g.y0;
    if (!g.moved) {
      if (Math.abs(dy) < DRAG_START) return;
      g.moved = true;
      target.onActive?.(true);
    }
    target.zoomTo(g.k0 * Math.pow(2, dy / PX_PER_DOUBLING), g.at);
  };
  const end = (cancelled: boolean) => {
    if (!g) return;
    const was = g;
    g = null;
    if (was.moved) { target.onActive?.(false); return; }
    if (cancelled || !(was.target instanceof Element)) return;
    // A plain double tap: hand the view the click and double click it would have had.
    const init: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX: was.x, clientY: was.y };
    was.target.dispatchEvent(new MouseEvent("click", init));
    was.target.dispatchEvent(new MouseEvent("dblclick", { ...init, detail: 2 }));
  };

  const opts: AddEventListenerOptions = { capture: true, passive: false };
  // Pointer events arrive before touch events; Leaflet listens to them, d3 to touch events. Both are covered.
  el.addEventListener("pointerdown", (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== "touch" || !e.isPrimary) { if (g && e.pointerType === "touch") { swallow(e, false); end(true); } return; }
    if (begin(e.clientX, e.clientY, e.target)) swallow(e, false);
  }, opts);
  el.addEventListener("pointermove", (ev) => {
    const e = ev as PointerEvent;
    if (!g || e.pointerType !== "touch") return;
    swallow(e, false);
    move(e.clientY);
  }, opts);
  for (const type of ["pointerup", "pointercancel"]) {
    el.addEventListener(type, (ev) => {
      if (!g || (ev as PointerEvent).pointerType !== "touch") return;
      swallow(ev, false); // the touch events below finish the gesture
    }, opts);
  }
  el.addEventListener("touchstart", (ev) => {
    const e = ev as TouchEvent;
    if (e.touches.length !== 1) { down = null; lastTap = null; if (g) { swallow(e); end(true); } return; }
    const t = e.touches[0];
    if (begin(t.clientX, t.clientY, e.target)) { swallow(e); down = null; return; }
    down = { t: performance.now(), x: t.clientX, y: t.clientY };
  }, opts);
  el.addEventListener("touchmove", (ev) => {
    const e = ev as TouchEvent;
    if (!g) return;
    swallow(e);
    if (e.touches.length === 1) move(e.touches[0].clientY);
  }, opts);
  el.addEventListener("touchend", (ev) => {
    const e = ev as TouchEvent;
    if (g) { swallow(e); end(false); return; }
    const t = e.changedTouches[0];
    const now = performance.now();
    lastTap = down && t && e.touches.length === 0 && now - down.t < TAP_MS && Math.hypot(t.clientX - down.x, t.clientY - down.y) < 10
      ? { t: now, x: t.clientX, y: t.clientY }
      : null;
    down = null;
  }, opts);
  el.addEventListener("touchcancel", (ev) => {
    down = null; lastTap = null;
    if (g) { swallow(ev); end(true); }
  }, opts);
}
