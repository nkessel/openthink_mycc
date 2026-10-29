// Smooth wheel and trackpad zoom for the geographic map (10/18: "zoom in and out more smoothly and not in jumps").
// Leaflet's own wheel zoom waits for the wheel to stop, then animates one step, so a long scroll lands in jumps.
// Here every wheel event moves a target zoom, and each animation frame glides part of the way there, keeping
// the place under the pointer still. The usual zoom/move events fire as it goes, and zoomend/moveend fire once
// it settles, so pins, clusters and district lines update exactly as before.
import L from "leaflet";

type Internals = L.Map & {
  _move(center: L.LatLng, zoom: number, data?: unknown): L.Map;
  _moveEnd(zoomChanged: boolean): L.Map;
  _stop(): L.Map;
};

export function smoothWheelZoom(map: L.Map): void {
  const m = map as Internals;
  map.scrollWheelZoom.disable();
  const el = map.getContainer();
  let target = 0;
  let moving = false;
  let raf = 0;
  let lastWheel = 0;
  let startZoom = 0;
  // set by each wheel event (the map has no view yet when this is attached)
  let pt = L.point(0, 0);
  let ll = L.latLng(0, 0);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  el.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      // lines and pages → pixels; trackpad pinch arrives as ctrl+wheel with small deltas, so it counts for more
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const per = e.ctrlKey ? 0.01 : 0.0035;
      if (!moving) {
        m._stop(); // cancel any running pan or button animation
        moving = true;
        startZoom = map.getZoom();
        target = startZoom;
        map.fire("movestart").fire("zoomstart");
      }
      target = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), target - Math.max(-120, Math.min(120, dy)) * per));
      pt = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
      ll = map.containerPointToLatLng(pt);
      lastWheel = performance.now();
      if (!raf) raf = requestAnimationFrame(step);
    },
    { passive: false },
  );

  function step() {
    raf = 0;
    const z = map.getZoom();
    const gap = target - z;
    const next = reduced || Math.abs(gap) < 0.003 ? target : z + gap * 0.22;
    if (next !== z) {
      // the point under the pointer stays under the pointer
      const half = map.getSize().divideBy(2);
      const center = map.unproject(map.project(ll, next).subtract(pt.subtract(half)), next);
      m._move(center, next);
    }
    if (next === target && performance.now() - lastWheel > 140) {
      moving = false;
      m._moveEnd(target !== startZoom);
      return;
    }
    raf = requestAnimationFrame(step);
  }
}
