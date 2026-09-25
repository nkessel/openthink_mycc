# Forms + spreadsheet setup (about 10 minutes, once)

The Google Sheet is the editable copy of the map data. Four Google Forms write into it:

| Form | What groups can do |
|---|---|
| Update your organization | Add a new org, or fill in / fix name, abbreviation, type, town, description, coalitions, topic tags, youth-serving, membership size, website, logo link, public contact, or remove it |
| Add or edit an event | Organization, coalition, name, description, date, start time, location, topic tags, link, public contact, or remove |
| Add or edit a project | Organization, coalition, name, description, status, skills needed, topic tags, link, public contact, or remove |
| Send feedback | Type, which part of the map, message, name/email, OK to follow up |

Every question is optional except "which one is this about?", so groups only fill in what's missing or changed. Blank answers never overwrite anything. Every change is recorded in the **Change Log** tab (old → new, and who sent it), so any edit can be undone.

## 1. Add the script to the sheet

1. Open the **Openthink data** Google Sheet (or any new, empty Google Sheet).
2. **Extensions → Apps Script**.
3. Delete what's in `Code.gs`, paste in all of [`Code.gs`](Code.gs), and click **Save**.
4. Close the Apps Script tab and reload the sheet. An **Openthink** menu appears.

## 2. Build everything

1. **Openthink → Set up sheet + forms (run once)**.
2. Google asks for permission the first time (the script creates forms, edits this sheet, and looks up town locations). Click through **Advanced → Go to project** if it warns that the app is unverified — it's your own script.
3. When it finishes, the tabs are filled with the current map data from `development_branch`, and the four form links are on the **Start Here** tab.

Running it again is safe: it skips forms that already exist and never overwrites filled tabs.

## 3. Connect the site's + button

Copy the JSON on the **Start Here** row "For the site: paste into src/forms.config.ts" and paste it over `FORMS` in [`src/forms.config.ts`](../src/forms.config.ts). Open a PR into `development_branch`. The + button and the "Update this organization's info" links then open the forms, pre-filled with whatever org or coalition is open.

## 4. (Optional) Let the site pull the sheet's data

1. In Apps Script: **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the URL.
2. From the repo: `OPENTHINK_DATA_URL="<that URL>" npm run pull-data`, then open a PR with the updated `public/data.json`.

The web app only serves the public tabs — never Feedback or Change Log.

## Day to day

- New submissions show up in the tabs immediately; review them in **Change Log**.
- To undo a change, copy the old value from Change Log back into the cell.
- To hide something without deleting it, set `hidden` to `TRUE`.
- For an email per submission, set `NOTIFY_EMAIL` at the top of `Code.gs`.
- Dropdowns of orgs/events/projects refresh after each submission, or via **Openthink → Refresh form dropdowns** after hand edits.

## Who owns an event or project

Pick an **Organization**, a **Coalition**, or both:

- Organization only → it's that org's own event/project (shows on the org).
- Coalition (with or without an org) → it's the coalition's, hosted by that org if one is picked (shows on both).
- Neither → it's saved but stays off the map; Change Log flags it with ⚠.

To move an existing item from a coalition to an org only, clear its `coalition_id` cell in the sheet (blank form answers never erase anything).

## Limits worth knowing

- Anyone with a form link can submit, and edits go live in the sheet right away (not on the site until data is pulled and merged). Change Log is the safety net; if spam becomes a problem, turn on "Restrict to users in…" or "Collect email addresses" in each form's settings.
- Google Forms can't take file uploads without sign-in, so logos are submitted as a link. Google Drive share links are converted to a displayable image URL automatically.
