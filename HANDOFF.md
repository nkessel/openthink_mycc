# Handoff: working notes for the next session

Read this first, then `CLAUDE.md` and `LLM_GUIDELINES.md`. **Update this file at the end of every session** (newest
first under "Recent"), so the next person or account can pick up without a separate handoff doc.
This repo is public: no emails, phone numbers, passwords or private sheet contents here.

## Direction
- Moving from Google Forms to point people adding and editing their group's information directly on the map. First step: the confirmation screen (`apps-script/Confirm.gs`, one private link per group). Forms keep working during the switch.
- Research items for Nathan: dynamic hosting (Vercel free plan is personal/non-commercial only; Cloudflare Workers free = 100k requests/day; Turibius's Raspberry Pi), Google sign-in on the map (a free OAuth client ID; the script verifies the token).

## Where things are
- Live site: https://ma.climateorgmap.earth (GitHub Pages, deployed from `development_branch` by `.github/workflows/pages.yml`). `/version.json` shows the live commit.
- Data: the Google Sheet "MA Climate Organization Map data" (core team only). The site reads it through the sheet's Apps Script web app (`LIVE_DATA_URL` in `src/data.config.ts`), falling back to `public/data.json` (nightly snapshot PRs).
- Sheet script: `apps-script/Code.gs` + `apps-script/Confirm.gs`, pasted into the sheet's Apps Script project (Extensions → Apps Script). After pasting: Deploy → Manage deployments → ✏️ → New version → Deploy (same URL). Setup notes: `apps-script/SETUP.md`.
- Team notes, meeting notes and change log: the Google Doc "Running: Climate Network Map" (tab "Map V1 Change request log").
- New-region guide: `public/guide.html`; region settings: `src/region.config.ts` and `REGION` in `Code.gs`.

## How we work
- Branch off `development_branch`, PR into it, CI must pass (`check`: typecheck, build, Apps Script tests), then merge. A release PR `development_branch` → `main` keeps `main` in step.
- Log what you did in `<github-username>_LLM.log`.
- `npm run test:apps-script` tests the sheet script in Node (no Google needed).

## Waiting on a person
1. **Confirmation links: deployed, ready to send** (Nov 4). PR #114 merged, script deployed as Version 8 (same web-app URL), "Update confirmation link addresses" run (0 changed; link cells are now plain text). 158 links (150 groups + 8 coalitions). Tested: one org link loads and "Save for later" saves (test row reset to its earlier status). Not yet tested: a browser with 2 Google accounts signed in, a coalition link, Finalize and Submit. To test a link without losing its tracking, set its status to `test sent` first (opening keeps that status), then reset status and clear `opened_at`/`saved_at`/`draft` after. Sending them (Wave 1) is the team's call. Optional: script property `ADMIN_EMAILS`.
2. **Default branch** on GitHub (`development_branch` vs `main`): Nathan's call.
3. **Event descriptions**: 25 upcoming/recurring events rewritten from their own pages on Oct 29 (Change Log row). Broken link: passive_house_massachusetts_e3 (Green Building Showcase page is 404).

## Recent (newest first)
- 2026-11-04: Merged PR #114, deployed the sheet script as Version 8, ran the link-address update, tested one org link (loads, saves). Next: 2-account test, then Wave 1.
- 2026-11-03: Confirmation page moved from script.google.com to the map site (`confirm.html` + `src/confirm.ts`), because Google pages fail when 2+ Google accounts are signed in. It calls the web app with fetch and no cookies (`?api=confirm`, `doPost`). One editor per link: others see who is editing and can Take over; the editor's work autosaves every 15 s; the first Finalize and Submit wins. Coalitions have links. Two optional extra point people (pending + email, cap 3). Best way to reach is off until a phone is given. Email confirmation links go to `confirm.html?verify=` (old `?verify=` still works).
- 2026-10-29: "Sizes in this view" panel on the map while a group is open (this group, its events/projects/actions, its coalitions, partner groups; open by default, highlighted). Moons now grow with the planet; coalitions around an opened org ~45% of it (was 80%). Satellite names appear only when zoomed further in. Menu hints. Draggable "Note: this map…" banner. Confirmation screen collects phone + best way to reach (private Editors tab only). WebP logos (3.7 MB → 1.1 MB). Region setting, empty start, version.json, admin emails out of the code, guide.html. One-way (dotted, arrow) vs mutual (solid) org links. Team explainer: Claude Doc "How the Climate Org Map works now".
