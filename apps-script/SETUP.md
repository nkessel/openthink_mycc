# Setup: sheet, forms, and website (about 20 minutes, once)

**How it fits together**
- **Google Sheet ("Openthink data")** — the source of truth for the map. Only the core team can open it.
- **Four Google Forms** — how point-people update their own org and add events/projects. They sign in with Google; the script checks their email against the **Editors** tab before changing anything.
- **Website (GitHub Pages)** — a static site that reads the sheet's public data live, with a nightly backup copy in the repo.

| Form | Who can use it | What it changes |
|---|---|---|
| Update your organization | Point-people for that org, admins. Anyone can *propose* a new org (reviewed). | Name, abbreviation, type, description, town, HQ address or "remote", coalitions, topics, youth-serving, membership size, website, logo link, public contact, **which orgs you work with and how often**, or remove |
| Add or edit an event | Point-people for the host org or coalition, admins | Org and/or coalition, name, description, date, time, location, online?, topics, link, public contact, or remove |
| Add or edit a project | Same as events | Org and/or coalition, name, description, status, skills needed, location, online?, topics, link, public contact, or remove |
| Send feedback | Anyone, no sign-in | Goes to the Feedback tab |

Every question is optional except "which one is this about?". Blank answers never overwrite anything.

## Access, review, and the Change Log

- **Admins** (edit everything, approve reviews, get alerts): `nathandkessel@gmail.com`, `ab130@wellesley.edu`, `turibius@bu.edu` — set in `ADMIN_EMAILS` at the top of `Code.gs` and listed on the **Editors** tab.
- **Point-people**: add a row on the **Editors** tab — their email, and the `org_ids` and/or `coalition_ids` they manage (comma-separated ids from the Organizations/Coalitions tabs). One person can manage several.
- **Anything not allowed** (unknown email, someone else's org, a new org) goes to **Needs Review** instead of the map, is flagged in **Change Log** (highlighted yellow for unauthorized attempts), and emails the admins. Tick **approve** to apply it. When a new org is approved, the person who proposed it becomes its point-person automatically.
- **Change Log** has one row per submission: time, email, form, status (added / updated / removed / needs review / approved…), flag, and every field's old → new value — enough to undo anything by hand.

## 1. Add the script to the sheet

1. Open the **Openthink data** Google Sheet (shared with the core team).
2. **Extensions → Apps Script**. Delete what's in `Code.gs`, paste in all of [`Code.gs`](Code.gs), click **Save**.
3. Close that tab and reload the sheet. An **Openthink** menu appears.

## 2. Build everything

1. **Openthink → Set up sheet + forms (run once)**.
2. Approve the permission prompt (it creates forms, edits this sheet, sends review alerts, and looks up addresses for map pins). If Google says the app is unverified: **Advanced → Go to project** — it's your own script.
3. When it finishes: the tabs are filled from `development_branch`, the four forms exist and are shared with the core team, and their links are on **Start Here**.

Running it again is safe: it skips forms that already exist and never overwrites filled tabs.

## 3. Publish the live data link

1. In Apps Script: **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the URL.
2. It only serves public data — never Editors, Needs Review, Feedback, or Change Log.

## 4. Connect the website (one small PR)

In `development_branch`, open a PR that:
- pastes the web app URL into `LIVE_DATA_URL` in [`src/data.config.ts`](../src/data.config.ts), and
- pastes the JSON from the Start Here row "For the site: paste into src/forms.config.ts" over `FORMS` in [`src/forms.config.ts`](../src/forms.config.ts).

After that, approved edits show up on the site within a minute of a page reload, and the **+** button opens the forms pre-filled with whatever org or coalition is open.

## 5. Turn on GitHub Pages (repo owner, once)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Environments → github-pages → Deployment branches**: add `development_branch` (by default only `main` may deploy).
3. **Settings → Secrets and variables → Actions → Variables**: add `OPENTHINK_DATA_URL` = the web app URL. This turns on the nightly backup (a PR with the latest `data.json`, only when something changed).
4. Re-run **Actions → Deploy to GitHub Pages**. The site is at `https://nkessel.github.io/openthink_mycc/`.

## Who owns an event or project

Pick an **Organization**, a **Coalition**, or both:
- Organization only → that org's own event/project.
- Coalition (with or without an org) → the coalition's, hosted by that org if one is picked.
- Neither → saved but kept off the map; Change Log flags it with ⚠.

To move an item from a coalition to an org only, clear its `coalition_id` cell in the sheet.

## Day to day

- Review **Needs Review** when the alert email arrives; tick **approve** or leave it (set `status` to `rejected` for your own records).
- Add point-people on **Editors**. Then run **Openthink → Refresh form dropdowns** if you edited orgs/events/projects by hand.
- The 1–4 scores (`ej_focus`, `grassroots`, `policy_expertise`, `in_building`) and `coalition_weights` are core-team columns; no form changes them.

## Limits worth knowing

- Point-people need a Google account to sign in (they can make one for any email address).
- The access check stops mistakes and casual misuse; it is not bank-grade security. Anyone with edit access to the sheet can change anything, so keep the sheet shared only with the core team.
- Logos are submitted as links (Forms can't take uploads without extra setup). Google Drive share links are converted automatically.
- "Suggested connections" are only as good as the descriptions and topics groups fill in.
