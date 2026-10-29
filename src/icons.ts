// Small inline icons for each kind of item, shared by the header card and legends.
const NS = "http://www.w3.org/2000/svg";

// Shared with the map bubbles (graph.ts) so the volunteer icon looks the same everywhere.
// A person (head and shoulders) raising an open hand, palm out: "I'll help".
export const VOL_HEAD = "M-7.4 0a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0";
export const VOL_BODY = "M-11 11C-11 6.2-8.2 4.6-4 4.6C-0.6 4.6 1.6 5.8 3 8";
export const VOL_ARM = "M3 8L5.6-2";
export const VOL_FINGERS = "M4.4-2.6V-8.8a1 1 0 0 1 2 0V-5M6.4-9.6a1 1 0 0 1 2 0V-5M8.4-8.8a1 1 0 0 1 2 0V-3.6C10.4-1.4 9-0.4 7-0.6H6C5-0.6 4.4-1.4 4.4-2.6M4.4-4.6L3-6.2a1 1 0 0 0-1.6 1.2L4.4-1.6";

export const PATHS: Record<string, string[]> = {
  // calendar
  event: ["M-8 -7h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-16a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2z", "M-10 -2h20", "M-4 -10v5", "M4 -10v5"],
  // seedling
  project: ["M-8 9H8", "M0 9V-1", "M0 3C-8 3-10-3-10-6C-4-6 0-3 0 3", "M0-1C0-7 4-11 10-11C10-5 6-1 0-1"],
  // checkmark
  action: ["M-7 0.5L-2.2 5.5L7.5-5"],
  // a person (head and shoulders) raising an open hand
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
