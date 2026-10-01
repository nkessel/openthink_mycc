// Small inline icons for each kind of item, shared by the header card and legends.
const NS = "http://www.w3.org/2000/svg";

const PATHS: Record<string, string[]> = {
  // calendar
  event: ["M-8 -7h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-16a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2z", "M-10 -2h20", "M-4 -10v5", "M4 -10v5"],
  // seedling
  project: ["M-8 9H8", "M0 9V-1", "M0 3C-8 3-10-3-10-6C-4-6 0-3 0 3", "M0-1C0-7 4-11 10-11C10-5 6-1 0-1"],
  // checkmark
  action: ["M-7 0.5L-2.2 5.5L7.5-5"],
};

export function typeIcon(kind: "event" | "project" | "action", size = 16): SVGElement {
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
