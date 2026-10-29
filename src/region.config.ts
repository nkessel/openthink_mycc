// The region this copy of the map covers. To start a map for another region (say Wisconsin), change this file,
// REGION at the top of apps-script/Code.gs, the title and land acknowledgement in index.html, and the two URLs in
// src/data.config.ts. guide.html → "Start a map for your region" walks through it.

export const REGION = {
  /** The map's full name: page title, loading screen, top bar. */
  title: "MA Climate Organization Map",
  /** Shown only where even two lines of the full title will not fit (the narrowest phones). */
  short: "MA Climate Map",
  stateName: "Massachusetts",
  stateCode: "MA",
  /** Time zone of the map's events (calendar links). */
  timeZone: "America/New_York",
  /**
   * Bundled geography (town outlines, zips, voting districts) in public/geo/, by prefix: see src/geodata.ts.
   * A new region without its own files uses [] (the geographic map still works; it just has no outlines).
   */
  geo: ["ma"] as string[],
  /** Where the geographic map opens: [[south, west], [north, east]]. */
  bounds: [
    [41.45, -73.55],
    [42.95, -69.85],
  ] as [[number, number], [number, number]],
  /** The point the data uses for a group with no address yet (statewide, national, or unknown): the main city. */
  fallback: { lat: 42.3601, lng: -71.0589, town: "Boston" },
  /**
   * The researched Vermont, Oregon and USA maps (?map=vt / or / us). A copy for another region should set this to
   * false: then only this region's map is shown.
   */
  extraMaps: true,
};
