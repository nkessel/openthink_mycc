// "Sign in with Google" on the map (src/auth.ts, apps-script/SignIn.gs).
//
// GOOGLE_CLIENT_ID: the OAuth client ID of a Google Cloud project (APIs & Services → Credentials → OAuth client
// ID → Web application, with https://ma.climateorgmap.earth as an authorized JavaScript origin). It is public,
// not a secret. Put the same value in the sheet script's property GOOGLE_CLIENT_ID. Until it's set, the Google
// button stays hidden and people sign in with "Confirm with email" instead. Setup: apps-script/SETUP.md.
export const GOOGLE_CLIENT_ID = "";
