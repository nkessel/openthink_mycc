// Item types (event, project, action, volunteer role): colour and icon, in one place (Nov 6).
// Developers can change these at any time. A later admin settings page will let site admins edit them
// (admins only for now; maybe a per-person preference one day). Until that page exists, edit this file.
//
// Colours: the four were tuned to stay distinct under red-green and blue-yellow colour blindness
// (ΔE ≥ 29 between every pair under simulated protan, deutan and tritan vision). Re-check if you change one.
// Icons are drawn in a 24×24 box centred on 0,0 (-11..11), stroke only, 2px lines.

/** Volunteer role icons to choose from (Nov 6 design round 3). Each is a list of SVG path "d" strings. */
export const VOLUNTEER_ICONS = {
  /** An open palm raised: "count me in". The default. */
  "raised-hand": [
    "M-3 11V7.5C-3 6 -4.5 5 -5.5 3.5L-9 -1.5A1.8 1.8 0 0 1 -6.2 -3.6L-5 -2V-6A5 4 0 0 1 5 -6V3C5 5 3 6.5 3 8V11",
    "M-1.7 -9V-3M1.7 -9V-3",
  ],
  /** An open hand offering a small heart: lending a hand. */
  "hand-heart": [
    "M0 0C-3 -2 -5.5 -4 -5.5 -6.5C-5.5 -8.3 -4.2 -9.5 -2.7 -9.5C-1.5 -9.5 -0.5 -8.8 0 -7.8C0.5 -8.8 1.5 -9.5 2.7 -9.5C4.2 -9.5 5.5 -8.3 5.5 -6.5C5.5 -4 3 -2 0 0Z",
    "M-11 4.5H-8C-6.5 4.5 -5 3.5 -3.5 3.5H1C2.6 3.5 2.6 6.5 1 6.5H-2.5",
    "M-8 10H0.5L8.5 6C10.3 5.1 9.5 2.6 7.6 3.3L2.6 5.4",
  ],
  /** The earlier icon: a person (head and shoulders) raising a hand with fingers. */
  "person-raised-hand": [
    "M-7.4 0a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0",
    "M-11 11C-11 6.2-8.2 4.6-4 4.6C-0.6 4.6 1.6 5.8 3 8",
    "M3 8L5.6-2",
    "M4.4-2.6V-8.8a1 1 0 0 1 2 0V-5M6.4-9.6a1 1 0 0 1 2 0V-5M8.4-8.8a1 1 0 0 1 2 0V-3.6C10.4-1.4 9-0.4 7-0.6H6C5-0.6 4.4-1.4 4.4-2.6M4.4-4.6L3-6.2a1 1 0 0 0-1.6 1.2L4.4-1.6",
  ],
} as const;
export type VolunteerIcon = keyof typeof VOLUNTEER_ICONS;

export const KIND_STYLE: {
  event: { color: string };
  project: { color: string };
  action: { color: string };
  volunteer: { color: string; icon: VolunteerIcon };
} = {
  event: { color: "#2dd4bf" },
  project: { color: "#bef264" },
  action: { color: "#ea580c" },
  volunteer: { color: "#8b5cf6", icon: "raised-hand" },
};

/** Puts the colours above into the page's CSS variables (--k-event, --k-project, --k-action, --k-volunteer). */
export function applyKindStyle(root: HTMLElement = document.documentElement): void {
  for (const k of ["event", "project", "action", "volunteer"] as const) root.style.setProperty(`--k-${k}`, KIND_STYLE[k].color);
}
