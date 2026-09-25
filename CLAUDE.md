# Openthink — notes for Claude Code

Follow the team's shared rules in [LLM_GUIDELINES.md](LLM_GUIDELINES.md). In short: brief answers, label responses (`1.01`), use detail tags `[0]`–`[4]` (default `[2]`), state your uncertainty, `git pull` + check open PRs before coding, branch off `development_branch` and open a PR into it (never push to `main` or `development_branch` directly), and log what you did and why in `<github-username>_LLM.log`.

## Project

- Vite + TypeScript + D3 single-page app; data is a static `public/data.json` (schema in `src/types.ts`).
- Org list, org data, and logos come from the MA Climate Coalition Map (github.com/aissatabarry/ma-climate-coalition-map) via `node scripts/import-orgs.mjs`. Logos live in `public/logos/`.
- Groups propose edits through Google Forms linked to a Google Sheet (`apps-script/`, see `apps-script/SETUP.md`). `npm run pull-data` pulls the sheet into `public/data.json`.
- The `+` button (`src/fab.ts`) links to those forms; form URLs live in `src/forms.config.ts`.

## Commands

- `npm run dev` — local dev server
- `npm run build` — typecheck + production build (run before opening a PR)
