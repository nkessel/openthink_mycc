# Map research + development backlog

Worked through by the scheduled "Climate map: next backlog item" task (and anyone else). Each run takes the
**first unchecked item**, does it (or as much as one run's ~200 web searches allow), checks it off or notes
progress, and pushes a branch for review. Humans can reorder, add or delete items at any time.

Rules for every item: follow `CLAUDE.md` + `LLM_GUIDELINES.md`; a source URL on every researched fact; never
guess; no research notes in public text fields; validate JSON; `npm run build` and `npm run test:apps-script`
before pushing; log in `nkessel_LLM.log`; never push to `main` or `development_branch`.

## Data gaps

- [x] **Massachusetts: 34 unresearched orgs.** The `not_found` ids in `research/ma-gaps/fill3.json` were never
      researched (search cap ran out). Use `research/ma-gaps/INSTRUCTIONS.md`; write `research/ma-gaps/fill4.json`;
      merge into `public/data.json` blank fields only (same as the merge in the 2026-10-01 log entry).
      _2026-10-02: 31/34 filled (`fill4.json`). Not found: `sunrise_ipswich`, `sunrise_western_mass` (no such hub
      found), `mit_sea` (only the MIT Sustainable Energy Alliance, mitsea.org, turned up; a human should decide)._
- [ ] **Massachusetts: types + websites.** 87 orgs still have `type` "unknown" and 43 no website. Same method.
      _2026-10-02 (partial, `fill5.json`): now 43 unknown types, 12 without website. The rest mostly have no stated
      tax status on readable pages (chapters of national orgs, 501(c)(6) groups). Pre-existing odd types worth a
      human look: `university` on two high-school groups, `school_club` on UU Mass Action, `youth_org` (not in the
      type list)._
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

- [ ] New Hampshire (NH)
- [ ] Maine (ME)
- [ ] Rhode Island (RI)
- [ ] Connecticut (CT)
- [ ] New York (NY) — large: statewide + biggest regional coalitions first; may take two runs
- [ ] New Jersey (NJ)
- [ ] Pennsylvania (PA)

## Site development

- [ ] Switcher: once there are 5+ states, turn the switcher list into a searchable list grouped by region.
- [ ] USA map: a national-coalitions-only view (coalitions with members in 2+ states) as the default USA layout,
      so it stays readable as states are added.
- [ ] Voting-district outlines (state house / senate) for Massachusetts, from an official open-data source.
