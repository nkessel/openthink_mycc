// Small inline icons for each kind of item, shared by the header card and legends.
const NS = "http://www.w3.org/2000/svg";

// Shared with the map bubbles (graph.ts) so the volunteer icon looks the same everywhere.
export const VOL_HEAD = "M-5.6-1.5a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0-7.2 0";
export const VOL_BODY = "M-10.5 10.5C-10.5 5-7 3.4-2 3.4C1.5 3.4 3.6 4.4 4.8 6";
export const VOL_ARM = "M4.8 6L7.6-4.5";
export const VOL_FINGERS = "M6.2-4.6L6.7-10.2M8.2-4.2L9.4-9.6M9.6-3L11.4-6.6";

const PATHS: Record<string, string[]> = {
  // calendar
  event: ["M-8 -7h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-16a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2z", "M-10 -2h20", "M-4 -10v5", "M4 -10v5"],
  // seedling
  project: ["M-8 9H8", "M0 9V-1", "M0 3C-8 3-10-3-10-6C-4-6 0-3 0 3", "M0-1C0-7 4-11 10-11C10-5 6-1 0-1"],
  // checkmark
  action: ["M-7 0.5L-2.2 5.5L7.5-5"],
  // a person (head and shoulders) with one hand raised
  volunteer: [VOL_HEAD, VOL_BODY, VOL_ARM, VOL_FINGERS],
};

export type IconKind = "event" | "project" | "action" | "volunteer";

export function typeIcon(kind: IconKind, size = 16): SVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-12 -12 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", `type-icon ti-${kind}`);
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS[kind]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}
