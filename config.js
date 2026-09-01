/* Revenue Clinic Grievance Dashboard — configuration.
   Fork this repo for a different sheet? Change these three values and nothing else. */

const SHEET_ID = "1d3iLaWzxpqg0vHcWUlufBgDpWXnIBIG4vpcK_p9artc";
const SHEET_GID = "1964727344"; // the "Data Response" tab's gid
const SHEET_LABEL = "Data Response sheet, Revenue Clinic Srikakulam";

/* This deployment ships with NO grievance data baked in — deliberately.
   The sheet holds every petitioner's Aadhaar number and mobile number, and
   this file lives in a public repo, so nothing from the sheet is committed
   here. Everything you see on the page is fetched live, in your browser,
   directly from Google Sheets when the page loads (see app.js). If the
   sheet isn't reachable (private, or no network access to Google from
   wherever this page is opened), the page will show an empty/error state
   instead of data — that's expected, not a bug. */
const DATA = {
  records: [],
  mandals: [],
  divisions: [],
  rcNumbers: [],
  meta: { syncedAt: null },
};
