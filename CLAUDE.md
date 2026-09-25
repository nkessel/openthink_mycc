# MA Climate Coalition Map — notes for Claude Code

Follow the team's shared rules in [LLM_GUIDELINES.md](LLM_GUIDELINES.md). In short: brief answers, label responses (`1.01`), use detail tags `[0]`–`[4]` (default `[2]`), state your uncertainty, `git pull` + check open PRs before coding, branch off `development_branch` and open a PR into it (never push to `main` or `development_branch` directly), and log what you did and why in `<github-username>_LLM.log`.

## Project

- Vite + TypeScript + D3 single-page app; data is a static `public/data.json` (schema in `src/types.ts`).
- Org list, org data, and logos come from the MA Climate Coalition Map (github.com/aissatabarry/ma-climate-coalition-map) via `node scripts/import-orgs.mjs`. Logos live in `public/logos/`.
- The Google Sheet is the source of truth after launch. Point-people edit through Google Forms (sign-in required); `apps-script/Code.gs` checks their email against the sheet's Editors tab, queues anything else in Needs Review, and logs every submission. See `apps-script/SETUP.md`.
- The site is static (GitHub Pages, `.github/workflows/pages.yml`) and reads the sheet's public JSON via `LIVE_DATA_URL` in `src/data.config.ts`, falling back to `public/data.json` (nightly snapshot PRs from `.github/workflows/sync-data.yml`).
- `npm run test:apps-script` and `npm run check:apps-script` test the Apps Script in Node; CI runs them on every PR.
- The `+` button (`src/fab.ts`) links to those forms; form URLs live in `src/forms.config.ts`.

## Commands

- `npm run dev` — local dev server
- `npm run build` — typecheck + production build (run before opening a PR)
