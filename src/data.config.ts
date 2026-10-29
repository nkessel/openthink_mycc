// Where the site loads its data from.
//
// LIVE_DATA_URL: the Google Apps Script web app URL (see apps-script/SETUP.md, step 4).
// When set, the site shows the sheet's current data, so approved form edits appear
// without anyone touching code. If it's empty or unreachable, the site falls back to
// the snapshot in public/data.json (refreshed nightly by .github/workflows/sync-data.yml).
export const LIVE_DATA_URL =
  "https://script.google.com/macros/s/AKfycbwj2109KXf2Ndv-0ZCHp0a6MH3aVSejxkqofBOfOFHRSvMi61DXjkeIe25OlsHNbs5S/exec";

export const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data.json`;
