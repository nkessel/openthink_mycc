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

- [x] **Remove research notes from public text.** Done 2026-10-02 (PR #39). About 30 descriptions in `public/data.json` and `public/maps/vt.json`
      contain notes meant for us, not the public ("no climate work found", "its own website blocks automated readers",
      "could not be confirmed as current", "location not verified on page", scraper errors such as "Campaign page could
      not be loaded"). The `notes` fields in `research/topics/extracted.json` list them. Rewrite each as a plain public
      description (from the group's own pages), or blank it; put the research note in a research file instead.

- [ ] **Massachusetts: 34 unresearched orgs.** The `not_found` ids in `research/ma-gaps/fill3.json` were never
      researched (search cap ran out). Use `research/ma-gaps/INSTRUCTIONS.md`; write `research/ma-gaps/fill4.json`;
      merge into `public/data.json` blank fields only (same as the merge in the 2026-10-01 log entry).
- [ ] **Massachusetts: types + websites.** 87 orgs still have `type` "unknown" and 43 no website. Same method.
- [ ] **Massachusetts: Cross Campus Climate Coalition (`cccc`)** has no description or members; find its own pages
      or MYCC's mentions of it.
- [ ] **Vermont: activity dates + types.** 29 orgs in `public/maps/vt.json` have blank `last_activity`; 23 Energy
      Action Network members have type "unknown". Edit `research/state-pilot/vt.json`, then copy it (compact) to
      `public/maps/vt.json`.

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
