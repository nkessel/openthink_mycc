# Openthink — Climate Coalition Map

A force-directed network map of Massachusetts climate coalitions and their member organizations. Coalitions are sized by member count; edges denote membership. Members in multiple coalitions naturally land between hubs.

Org list, org data, and logos come from the [MA Climate Coalition Map](https://github.com/aissatabarry/ma-climate-coalition-map). Coalition projects, events, and actions are still placeholder data.

> **Working with an LLM on this repo?** Read and follow [**LLM_GUIDELINES.md**](LLM_GUIDELINES.md) — the team's shared rules (branching on `development_branch`, PRs only, response tags, logging).

## Views

- **Map** — force-directed graph of coalitions and orgs. Edges show coalition membership and, in amber, **org-to-org connections** (thicker = they work together more often). Search box to jump to any org or coalition. Click any node for its details, connections, projects, events, and **suggested connections**.
- **Geographic** — Leaflet map of coalitions and org headquarters (remote orgs aren't pinned). Checkboxes add **event** and **project** pins (off by default). Search a place, org, coalition (zooms to its members), event or project; **What's near me?** lists everything within 15 km.
- **Organizations** — searchable, filterable list of every org, plus **Suggested connections**: pairs of similar orgs that haven't said they work together.
- **Events** / **Projects** — searchable lists across coalitions and orgs.
- **+ button** — opens the Google Forms to add or update an org, event, or project, or send feedback (pre-filled with whatever is open).

Hosted as a static site on GitHub Pages; data comes live from the Google Sheet (see [`apps-script/SETUP.md`](apps-script/SETUP.md)), with `public/data.json` as the fallback.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Build for production

```bash
npm run build
```

Output goes to `dist/`. Deploys cleanly to Vercel (Vite auto-detected — no config needed).

## Data

Data lives in `public/data.json`. Organizations (and `public/logos/`) are imported from the MA Climate Coalition Map:

```bash
node scripts/import-orgs.mjs            # fetches the latest from GitHub
```

This replaces the org list, keeps projects/events/actions for coalitions that are still on the map, and drops coalitions (and their projects/events) that aren't. `scripts/generate-data.mjs` is the original placeholder generator.

### Editing data with the forms

The live data lives in a Google Sheet (tabs: Coalitions, Organizations, Projects, Events, Actions, Feedback, Change Log) with four Google Forms attached — update your organization, add/edit an event, add/edit a project, and send feedback. Every form field is optional except "which one is this about?", so groups only fill in what's missing or changed; each submission is written into the sheet and logged in Change Log.

Setup lives in [`apps-script/SETUP.md`](apps-script/SETUP.md). To bring the sheet's latest data into the site:

```bash
OPENTHINK_DATA_URL="https://script.google.com/macros/s/…/exec" npm run pull-data
```

The schema:

- `coalitions[]` — id, name, abbrev, color, lat/lng, member_ids, projects, events, actions, focus_tags
- `organizations[]` — id, name, type, geographic_focus, lat/lng, coalition_ids, plus optional abbrev, logo, website, public_contact, topic_tags, profile (youth-serving, scores…), coalition_weights
- `edges[]` — `{ source: coalition_id, target: org_id }`

## Stack

- Vite + TypeScript
- D3 (force layout)
- Leaflet + CARTO dark tiles (geographic view)
- No backend yet — static SPA
