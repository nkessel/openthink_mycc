# Map research + development backlog

Worked through by the scheduled "Climate map: next backlog item" task (and anyone else). Each run takes the
**first unchecked item**, does it (or as much as one run's ~200 web searches allow), checks it off or notes
progress, and pushes a branch for review. Humans can reorder, add or delete items at any time.

Rules for every item: follow `CLAUDE.md` + `LLM_GUIDELINES.md`; a source URL on every researched fact; never
guess; no research notes in public text fields; validate JSON; `npm run build` and `npm run test:apps-script`
before pushing; log in `nkessel_LLM.log`; never push to `main` or `development_branch`.

## Data gaps

- [ ] **RSVP links for every upcoming event.** Most events in `public/data.json` (and `public/maps/vt.json`) only
      link to a group's events page. For each upcoming event, open its own page and record the sign-up link in
      `rsvp_link` (Zoom/Eventbrite/Mobilize/Action Network/Google Form…), and replace a general events-page `link`
      with the event's own page. Only from the host's pages; never guess. Green Energy Consumers Alliance is done
      (2026-10-02). The sheet picks these up via "Fill in missing details … from GitHub" (blank cells only).
      _2026-10-04: blocked in scheduled runs. Reading the event pages needs WebFetch, and its per-URL approval
      can't be given while nobody is watching (every fetch failed "PROVENANCE_REQUIRED"); search results alone
      don't show sign-up links. Ready to run when someone is present: `research/rsvp/INSTRUCTIONS.md` +
      `input_1..3.json` (107 upcoming events without an RSVP link: 82 MA, 25 VT). The same block hits every
      research item below this run (MA types, VT dates/types, new states)._

- [x] **Remove research notes from public text.** Done 2026-10-02 (PR #39). About 30 descriptions in `public/data.json` and `public/maps/vt.json`
      contain notes meant for us, not the public ("no climate work found", "its own website blocks automated readers",
      "could not be confirmed as current", "location not verified on page", scraper errors such as "Campaign page could
      not be loaded"). The `notes` fields in `research/topics/extracted.json` list them. Rewrite each as a plain public
      description (from the group's own pages), or blank it; put the research note in a research file instead.

- [x] **Massachusetts: 34 unresearched orgs.** The `not_found` ids in `research/ma-gaps/fill3.json` were never
      researched (search cap ran out). Use `research/ma-gaps/INSTRUCTIONS.md`; write `research/ma-gaps/fill4.json`;
      merge into `public/data.json` blank fields only (same as the merge in the 2026-10-01 log entry).
      _2026-10-02: 31/34 filled (`fill4.json`). Not found: `sunrise_ipswich`, `sunrise_western_mass` (no such hub
      found), `mit_sea` (only the MIT Sustainable Energy Alliance, mitsea.org, turned up; a human should decide)._
- [ ] **Massachusetts: types + websites.** 87 orgs still have `type` "unknown" and 43 no website. Same method.
      _2026-10-02 (partial, `fill5_types.json`): now 43 unknown types, 12 without website. The rest mostly have no stated
      tax status on readable pages (chapters of national orgs, 501(c)(6) groups). Pre-existing odd types worth a
      human look: `university` on two high-school groups, `school_club` on UU Mass Action, `youth_org` (not in the
      type list)._
      _2026-10-03 (`fill6.json`): +7 types (CRWA, GreenRoots, GB PSR, JALSA, Arise, Community Action Works 501c3;
      Coalition for Social Justice 501c4) → 36 unknown, 12 without website. The rest state no tax status, are
      programs/committees/fiscally sponsored, or have no own page (school clubs, Hands Across the River, Upper Cape
      Women's Coalition, Concerned Citizens of Franklin County). Further gains need MYCC/org input; suggest closing._
- [ ] **Massachusetts: Cross Campus Climate Coalition (`cccc`)** has no description or members; find its own pages
      or MYCC's mentions of it.
      _2026-10-02: still not found on the public web (searches surface only a Colleges of the Fenway "Cross-Campus
      Climate Mixer" event). The only source is MYCC's own check-in email; needs input from MYCC._
- [ ] **Vermont: activity dates + types.** 29 orgs in `public/maps/vt.json` have blank `last_activity`; 23 Energy
      Action Network members have type "unknown". Edit `research/state-pilot/vt.json`, then copy it (compact) to
      `public/maps/vt.json`.
      _2026-10-02 (partial, `vtfill_2026-10-02.json`): +31 types, +12 dates, VIPPA marked inactive (site expired).
      Left: 17 blank dates (mostly 350Vermont nodes, whose pages carry no dates) and 29 unknown types (chapters of
      national orgs, 501(c)(6) trade groups, sites behind Cloudflare)._

## New states (one per run; New England first)

For each: follow `research/state-pilot/INSTRUCTIONS.md`, write `research/state-pilot/<st>.json`, validate
(ids unique, edges/member lists consistent, sources everywhere, no past events), spot-check 3+ facts against live
pages, copy to `public/maps/<st>.json`, then register it in `src/maps.ts` (MapId, MAPS entry with
`editable: false`, `maGeo: false`; add to the `us` map's `combine`; add a place-search box in `src/search.ts`
PLACE_BOX) and add it to the switcher list in `src/topbar.ts`. Check it loads with Playwright (`?map=<st>`).

- [x] New Hampshire (NH)
      _2026-10-03: 7 coalitions, 123 orgs, 108 edges, 25 upcoming events (`research/state-pilot/nh.json`, `?map=nh`).
      Gaps: CPCNH capped at 40 of ~51 listed members; NHACC + Local Energy Solutions have no public member list;
      no Sunrise hub list; Conservation NH / Mothers Out Front NH not found; many orgs' types unknown._
- [x] Maine (ME)
      _2026-10-03: 11 coalitions, 117 orgs, 135 edges, 14 upcoming events (`research/state-pilot/me.json`, `?map=me`).
      Gaps: EPC lists 35 of ~42 members, MAINECAN 28 of 100+, Wabanaki Alliance 17 climate-relevant of 23 shown;
      no public member list for Maine Climate & Health Alliance, ClimateWork Maine, Maine Clean Communities, Divest
      Maine; many big orgs' sites blocked automated reading, so 71 orgs have type unknown and few have dates._
- [ ] Rhode Island (RI)
- [ ] Connecticut (CT)
- [ ] New York (NY) — large: statewide + biggest regional coalitions first; may take two runs
- [ ] New Jersey (NJ)
- [ ] Pennsylvania (PA)

- [ ] **Sharper logos.** About 110 logos are under 256px (most are the 160px images from the original MA import), so
      they look soft when zoomed in past ~4×. For each, look for a larger version of the same logo on the group's own
      pages (about/press/brand pages, PDFs, social profile images), check it's identical, and replace it at 512–640px.
      `scripts/upgrade-logos.py` already tried each homepage (see `research/logos/up/report.json`).

## Site development

- [ ] Switcher: once there are 5+ states, turn the switcher list into a searchable list grouped by region.
- [ ] USA map: a national-coalitions-only view (coalitions with members in 2+ states) as the default USA layout,
      so it stays readable as states are added.
      _2026-10-04: not done. No coalition has members in 2+ states yet: every coalition is state-level and state
      ids don't overlap, so this view would be empty. What does cross states is national networks' chapters
      (Sierra Club, 350, Sunrise, Citizens' Climate Lobby, CLF and Interfaith Power & Light in all 4 states;
      Third Act, XR, Audubon in 3). Needs a decision: add a `network` field (with a source) linking chapters,
      then show networks as the USA view's top level._
- [ ] Voting-district outlines (state house / senate) for Massachusetts, from an official open-data source.
