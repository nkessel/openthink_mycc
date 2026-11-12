# Item check: instructions for the checking agents

Used by Agents 1 and 2 (each works alone) and Agent 3 (compares them). Run the scripts first:

```
cd data-review/scripts
python3 1_load_items.py      # map items for the trial groups (live sheet JSON; hidden rows already left out)
python3 2_fetch_pages.py     # homepage + up to 9 linked pages + every item link, saved to work/cache
python3 3_extract.py         # projects / events / roles found on the pages; page text -> work/text/
python3 4_script_checks.py   # no-AI checks: broken/moved links, past events, name and date on page
```

## Agents 1 and 2 (independent)

**Inputs (read only, all in `data-review/work/`):** `items.json` (the map's items), `checks.json` (script
results per item and group), `extracted.json` (what the scripts found on each site, per page: title, headings,
dates, text_file), `pages.json` (what was fetched), `text/*.txt` (the trimmed text of every fetched page; the
first line is its URL). Use `grep` on `text/` rather than reading whole files. Do not fetch anything from the
web: every verdict must rest on the saved pages so the other agent and the team can check it. Do not open the
other agent's output file.

**Write:** `data-review/work/agent<N>.json`, a JSON list of rows with these keys:
`group_id, group_name, item_type, item_id, current_name, verdict, proposed_name, proposed_description,
proposed_link, proposed_date, evidence_url, evidence_quote, notes`.

- One row per map item in `items.json`, one row per group (`item_type: "group"`, `item_id` = the group id,
  `current_name` = the group's name), plus `add` rows (`item_id` blank).
- `item_type`: group, project, event, action (an Actions row with kind = task) or role (kind = role).
- `verdict`: ok, fix, move, remove, add or couldn't check.
- Leave `proposed_*` blank unless the verdict is fix, move or add. Fill only the fields that should change
  (for add, fill name, link, and date for events; a one-sentence description taken from the page).
- `notes`: short. Always note `needs_info` and `verified` when the item has them, e.g. "needs_info=TRUE".

**What counts (rules from the team):**
- Project: only if the group's website directly names it as a working group, campaign or project, on a page
  we can link to. A page that only describes the group, its priorities or its issues is not a project.
- Event, action or volunteer role: only if there is a page directly about that event or opportunity, on the
  group's site or on another site their website links to (Action Network, Mobilize, Eventbrite, Zoom...).
  A general "contact us to join" page is not a page about a specific opportunity.
- Events: if the event's date (and end) is before today (see `today` in items.json), verdict remove with
  notes "past event". For recurring events (recurrence filled in), check the schedule on the site rather than
  one date: if the site still lists the series, judge the schedule (ok or fix the recurrence text); if it no
  longer does, remove.
- Group: name, website and description should match the website. If an item's text is really the group's
  description, verdict **move** on that item (proposed_description = the text for the group's description field)
  and, on the group row, propose that description.
- Wrong type (an "event" that is really an ongoing project, etc.): verdict fix, and say "wrong type: should be
  <type>" in notes.
- Add: campaigns, working groups, upcoming events, actions or roles the site names that are missing from the
  map. At most 5 add rows per group: pick the most clearly climate-related, most current ones. The team's
  project rule decides: the group's site must directly name it as a working group, campaign or project. That
  includes a campaign run with a coalition that the group's site names and asks people to join or support;
  it excludes things only mentioned in news, resource lists or partner links. Skip past events.
  (Corrected after the first pass: an earlier version said "only things the group itself runs or co-hosts",
  which is stricter than the team's rule.)
- Couldn't check: the page is blocked, needs a login, came back (nearly) empty because it loads with
  JavaScript, or is a scanned PDF. Only Facebook/Instagram: couldn't check, notes "social only". Don't guess.

**Evidence (hard rule):** every row cites `evidence_url` (a page that is in `text/`) and `evidence_quote`:
words copied exactly from that page's text file, under 15 words. Never make up a link, a date or a name.
Before you finish, run `python3 data-review/scripts/5_check_quotes.py data-review/work/agent<N>.json` and
fix every problem it reports until it prints OK.

`checks.json` has a `script_verdict` for clear-cut cases. Treat it as a hint and check it; you may disagree.

## Agent 3 (compare)

Read `work/agent1.json` and `work/agent2.json`. Match rows by (group_id, item_id), and add rows by the item
they describe (same link, or clearly the same thing). For each matched row:
- Same verdict: `agents_agree` yes. Keep one set of proposed fields and evidence (the clearer one, or merge
  if they complement each other); note real differences in proposed text briefly.
- Different verdict, or an add row only one agent made: `agents_agree` no, `verdict` blank, and notes
  `A1: <verdict> - <reason> / A2: <verdict> - <reason>`, keeping the evidence of one of them.
Write `work/final.json` (same keys plus `agents_agree`), then run `5_check_quotes.py` on it.

## Update pass (Nov 12): the team's answers

The team answered the trial's questions (doc subtab "1 LLM Response"). These rules now apply, on top of the
ones above, and win where they differ:
- Q1. A recurring event whose stored date is past is **ok** if the site still lists the series (the map moves
  the date forward itself). If the site no longer shows the series, remove.
- Q2. At most 10 pages per group, everything counted: homepage, then item links, then other pages. Only those
  pages are in `work/text/` now. An item whose page wasn't fetched is "couldn't check" with "page cap" in notes.
- Q3. National campaigns on a chapter: ok, "national campaign" in notes.
- Q4. A named series of several events is a project. A single event that repeats yearly is a recurring event,
  not a project. "Join us" or membership items are not actions or volunteer roles: if the group's site gives
  a meeting schedule, verdict fix (change it to a recurring event, schedule quoted); if not, remove. A role
  that appears only on a general volunteer page is ok.
- Q5. Link an event to a list page only when that page shows its name and date (quote both, joined with
  " … ", and write "list page" in notes). A coalition campaign with its own website plus its own meetings or
  events is an org: item_type group, verdict add, "collaborates with <group_id>" in notes.
- Q6. Past one-off events are left out entirely (the scripts skip them).
- Additional input: if an event or action belongs to a campaign, write "part of: <project name>" in notes.

Update-pass task (agents 1 and 2, separately, from the saved pages only):
1. Re-judge every row in `work/recheck_rows.json` (its evidence page fell outside the 10-page cap). Use only
   pages now in `work/text/`; write full rows as before. Ignore the old verdict and notes in that file except
   for needs_info / verified.
2. For every event, action and role row in `work/final_v2_base.json` and `work/recheck_rows.json`, decide
   whether a saved page ties it to a named project or campaign of the same group. Write an entry only when a
   page shows it: `{"group_id", "item_key" (item_id, or proposed_name for add rows), "project", "evidence_url",
   "evidence_quote"}`.
Write `work/agent<N>_v2.json` as `{"rows": [...], "part_of": [...]}`. Check both lists' quotes with
`python3 5_check_quotes.py` (save each list to a temporary JSON file first; part_of entries need
`"verdict": "ok"` added for the check).
