// Line icons (24×24, drawn with strokes) for the Command room: one for each main topic's problem and one for
// its solution. Sub-topics reuse their main topic's icons.

/** Small helpers for shapes used in several icons. */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const house = "M3 11 12 4l9 7M5 9.5V20h14V9.5";

export const PROBLEM_ICONS: Record<string, string[]> = {
  // dirty, unaffordable power: a power line pylon under smoke
  energy: ["M8 21l4-14 4 14M9.5 15h5M7 9h10M12 7V5", "M5 5.5a2 2 0 0 1 3-2.5 2.2 2.2 0 0 1 4 .5", "M17 5a1.6 1.6 0 0 1 3 .8"],
  // leaky, fossil-heated buildings: a house with a gas flame and heat escaping
  buildings: [house, "M12 18c-1.7 0-2.7-1.2-2.7-2.6 0-1.7 2.7-3.3 2.7-5 0 1.7 2.7 3.3 2.7 5 0 1.4-1 2.6-2.7 2.6z", "M19.5 4.5c1 1 1 2 0 3M22 3c1.5 1.8 1.5 3.5 0 5.2"],
  // fossil fuel expansion: a smokestack factory
  fossil: ["M2 21V12l5 3v-3l5 3v-3l5 3V5h4v16z", "M17 3a2 2 0 0 1 3-1.2", "M6 18h1M10 18h1M14 18h1"],
  // car dependence: a car with exhaust
  transport: ["M5 16v-4l2-5h9l2 5v4z", "M5 12h13", circle(8, 16.5, 1.6), circle(15, 16.5, 1.6), circle(2.5, 17, 1.2), "M2.5 13.5a1 1 0 1 1 1-1"],
  // throwaway culture: an overflowing bin
  waste: ["M5 8h14M9 8V5h6v3M6.5 8l1 13h9l1-13", "M10 11v7M14 11v7", "M15 3.5l3-1.5 1 2"],
  // toxic pollution: a hazard triangle with a drip
  health: ["M12 3 22 20H2z", "M12 9v5", "M12 17v.4"],
  // polluted waters: a water drop with an oily slick
  water: ["M12 3C8.5 8.5 6 11.5 6 15a6 6 0 0 0 12 0c0-3.5-2.5-6.5-6-12z", "M8.5 15.5c1.2-.9 2.3-.9 3.5 0s2.3.9 3.5 0"],
  // habitat loss: a tree stump with an axe
  nature: ["M7 21v-7h10v7M4 21h16", "M7 14c1.3-1.3 8.7-1.3 10 0", "M10 17.5h4", "M18 3l-5 5M15 3.5l3 3"],
  // fragile food systems: a cracked, empty bowl
  food: ["M3 11h18a9 9 0 0 1-18 0z", "M11 11l1.5 3-1.5 2 1 2.5", "M8 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5"],
  // heat, floods & storms: a hot thermometer above rising water
  resilience: ["M10 13V5a2 2 0 0 1 4 0v8a4 4 0 1 1-4 0z", "M12 9v6", "M2 21c2-1.5 3-1.5 5 0s3 1.5 5 0 3-1.5 5 0 3 1.5 5 0"],
  // community fragmentation: three people drifting apart, links broken
  local: [circle(5, 7, 2), circle(19, 7, 2), circle(12, 17, 2), "M7.5 8.5l1.5 1M16.5 8.5l-1.5 1", "M7 11l1.5 2.5M17 11l-1.5 2.5"],
  // lack of climate education: a closed book with a question mark
  education: ["M5 4h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3z", "M5 18a3 3 0 0 1 3-3h11", "M10 8.3a2 2 0 1 1 2.6 1.9c-.6.2-.6.6-.6 1.2"],
  // fossil-fuel-backed legislation: a gavel and an oil drop
  policy: ["M14 3l6 6M10.5 6.5l6 6M12.2 8.2 4 16.5", "M3 21h9", "M19 14c-1.6 2.2-2.4 3.4-2.4 4.5a2.4 2.4 0 0 0 4.8 0c0-1.1-.8-2.3-2.4-4.5z"],
  // environmental injustice: a scale tipped to one side
  justice: ["M12 3v18M7 21h10", "M4 9 20 5", "M4 9l-2.5 5.5h5z", "M20 5l-2.5 5.5h5z"],
  // an extractive economy: coins draining away
  economy: ["M7 5.5a5 2 0 1 0 10 0 5 2 0 1 0-10 0", "M7 5.5v4a5 2 0 0 0 10 0v-4", "M12 14v7M9 18l3 3 3-3"],
  // corporate capture of democracy: a ballot box with a dollar sign
  democracy: ["M4 12h16v9H4z", "M8 12V8M16 12V8M7 8h10", "M14 14.2c-.6-.6-3.6-.8-3.6.6s3.6 1 3.6 2.4-3 1.3-3.8.5M12 13.2v6"],
  // war, exclusion & unmet needs: a broken heart
  movements: ["M12 20 4.5 12.5a4.6 4.6 0 0 1 7.5-5 4.6 4.6 0 0 1 7.5 5z", "M12 7.5 10.5 12l3 2-1.5 4"],
  // the climate crisis: a warming globe
  broad: [circle(11, 13, 8), "M3 13h16M11 5c-2.7 2.5-2.7 13.5 0 16M11 5c2.7 2.5 2.7 13.5 0 16", "M19 2v5M17 4l2-2 2 2"],
};

export const SOLUTION_ICONS: Record<string, string[]> = {
  // clean, fair power: sun and a wind turbine
  energy: [circle(7, 7, 3), "M7 1.5v1.2M1.5 7h1.2M3.1 3.1l.9.9M10.9 3.1l-.9.9M3.1 10.9l.9-.9", "M17 22V11", "M17 11l-4.5-3M17 11l4.5-2.5M17 11v5", "M14 22h6"],
  // healthy, efficient homes: a house with a leaf
  buildings: [house, "M9 17c0-3.5 2.6-5.5 6-5.5 0 3.5-2.6 5.5-6 5.5z", "M9 17l3-3"],
  // a fossil-free future: sunrise
  fossil: ["M2 18h20", "M6 18a6 6 0 0 1 12 0", "M12 6v3M4.8 10.2l2 1.6M19.2 10.2l-2 1.6", "M5 21h14"],
  // clean ways to get around: a bicycle
  transport: [circle(6, 16, 3.5), circle(18, 16, 3.5), "M6 16l4-7h5l3 7", "M10 9 9 6H7M15 9l-3 7"],
  // a reuse economy: circular arrows
  waste: ["M20 12a8 8 0 1 1-2.4-5.7", "M20 4v4h-4", "M9 12.5l2 2 4-4"],
  // clean air & healthy communities: breezes
  health: ["M3 8h10a3 3 0 1 0-3-3", "M3 12h15a3 3 0 1 1-3 3", "M3 16h7"],
  // living rivers & coasts: a fish over a wave
  water: ["M3 11c4-5 10-5 14 0-4 5-10 5-14 0z", "M17 11l4-3v6z", "M7.5 10v.2", "M2 20c2-1.5 3-1.5 5 0s3 1.5 5 0 3-1.5 5 0 3 1.5 5 0"],
  // thriving forests: a tree
  nature: ["M12 22v-6", "M12 16l-3-3M12 15l3-2", "M12 2a6 6 0 0 0-6 6 5 5 0 0 0 2 9h8a5 5 0 0 0 2-9 6 6 0 0 0-6-6z"],
  // local, nourishing food: a sprout
  food: ["M12 21v-9", "M12 12C12 8 9 6 5 6c0 4 3 6 7 6z", "M12 10c0-3 2-5 6-5 0 3-2 5-6 5z", "M7 21h10"],
  // communities ready for what's coming: an umbrella
  resilience: ["M2 12a10 10 0 0 1 20 0z", "M12 12v7a2 2 0 0 0 4 0", "M12 2v1"],
  // connected, acting communities: people holding hands
  local: [circle(6, 6, 2), circle(18, 6, 2), circle(12, 8, 2), "M2.5 20v-5a3.5 3.5 0 0 1 7 0v5M14.5 20v-5a3.5 3.5 0 0 1 7 0v5", "M8.5 16h7"],
  // a climate-literate public: an open book with a light
  education: ["M2 6c3-1 7-1 10 1 3-2 7-2 10-1v13c-3-1-7-1-10 1-3-2-7-2-10-1z", "M12 7v13", "M17 1.5v2M14.5 2.5l1 1M19.5 2.5l-1 1"],
  // strong climate laws: a document with a check
  policy: ["M6 3h9l4 4v14H6z", "M15 3v4h4", "M9 14l2 2 4-4"],
  // justice for frontline communities: a level scale
  justice: ["M12 3v18M7 21h10", "M4 7h16", "M4 7l-2.5 5.5h5z", "M20 7l-2.5 5.5h5z"],
  // good green jobs: a hard hat with a leaf
  economy: ["M3 18h18v2H3z", "M5 18a7 7 0 0 1 14 0", "M10 11V8h4v3", "M12 6c0-2 1.3-3 3.5-3 0 2-1.3 3-3.5 3z"],
  // people-powered democracy: a ballot box with a check
  democracy: ["M4 12h16v9H4z", "M8 12 9 4h6l1 8", "M10 8l1.5 1.5 3-3"],
  // care, peace & belonging: a whole heart
  movements: ["M12 20 4.5 12.5a4.6 4.6 0 0 1 7.5-5 4.6 4.6 0 0 1 7.5 5z", "M9 11.5c.8-1.2 2-1 3 0 1-1 2.2-1.2 3 0"],
  // a livable planet: a globe with a leaf
  broad: [circle(11, 13, 8), "M3 13h16M11 5c-2.7 2.5-2.7 13.5 0 16M11 5c2.7 2.5 2.7 13.5 0 16", "M18 7c0-3 2-5 5-5 0 3-2 5-5 5z"],
};
