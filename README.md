# Revenue Clinic Grievance Dashboard — Collectorate Srikakulam

A Dashboard & MIS Report + Grievance Lookup tool for the Revenue Clinic "Data
Response" grievance sheet. This folder is the **public-repository build**: it
contains no grievance data of any kind. Every number, name, remark and status
you see on the page is fetched live, in each visitor's own browser, directly
from the Google Sheet at the moment the page is opened.

## Why no bulk data is included

The source sheet records every petitioner's name, Aadhaar number and mobile
number. Publishing that data as part of a public GitHub repository or GitHub
Pages site would expose it permanently (including in git history, even after
a later deletion) to anyone on the internet. So this build ships with:

- No `data.json` or embedded records — `config.js` starts with empty arrays;
  the full 1,800+ record list is only ever fetched live, never committed.
- **One exception, made deliberately:** `ai-analysis.json` (see "AI-analyzed
  fields" below) *is* committed with real, named-petitioner content for the
  two rows that currently have an Enquiry/Endorsement Letter PDF uploaded.
  That was an explicit choice to include it in the public repo, made with
  the privacy trade-off (petitioner name, address, phone, Aadhaar-linked
  context, all visible to anyone who visits the site or browses the repo)
  spelled out beforehand. Read that section before adding more rows to it.

If you need a version that *does* carry a point-in-time snapshot of the full
1,800+ records (for example, to hand to a colleague as a single file over
email or WhatsApp rather than hosting it), that's a different, private
build — not something to put in a public repo. Ask for that build separately
if you need it.

## How it works

- `index.html` — page structure only, no data.
- `styles.css` — all styling.
- `config.js` — three settings (`SHEET_ID`, `SHEET_GID`, `SHEET_LABEL`) and
  an empty `DATA` object. This is the only file you'd typically edit to
  reuse this dashboard for a different sheet.
- `app.js` — all logic: filtering, the Division/Mandal-wise report, the
  Grievance Lookup tab, and the live sync.

On page load, `app.js` fetches the sheet's "Data Response" tab as CSV from:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:csv&gid=<SHEET_GID>
```

parses it client-side, and builds the same records/report/lookup the
chat-delivered version of this dashboard uses. It repeats this automatically
every 60 seconds, and immediately when a visitor clicks **Update / Sync
Data**. Until the first fetch succeeds, the page shows a loading state; if it
fails, it shows a retry prompt rather than a misleading "0 records".

### Known limitation: this only works if the sheet allows it

For the live fetch to succeed in a visitor's browser, two things both have to
be true at the moment they open the page:

1. **The sheet must be shared so that "Anyone with the link" can at least
   view it.** At the time this build was prepared, this sheet already had
   `anyone: writer` sharing enabled (see "Outstanding security note" below)
   — which is broader than needed, but does mean it's reachable. If sharing
   is ever tightened to "Restricted", the live fetch will fail for every
   visitor who isn't individually granted access, and they'll see the retry
   state.
2. **Google's response has to be fetchable cross-origin from wherever this
   page is hosted.** This was verified to work from a server-side fetch
   (no redirect, plain CSV back), but a real browser additionally enforces
   CORS, which a server-side check cannot fully simulate. This has **not**
   been confirmed to work from an actual browser session in production. If
   visitors report "Sync failed" persistently after confirming sharing is
   correct, the likely cause is that Google isn't sending permissive enough
   CORS headers for this pattern, and the reliable fix is a small Google
   Apps Script "Web App" that re-serves the sheet as JSON with CORS headers
   you control — that's a separate, small piece of work if it turns out to
   be needed.

## Deploying to GitHub Pages

1. Create a new **public** GitHub repository and push the contents of this
   folder to it (root of the repo, or a `/docs` folder — either works).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**,
   pick the branch (e.g. `main`) and folder (`/ (root)` or `/docs`), then
   save.
4. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two. Re-pushing to the branch updates it automatically.

No build step, server, or GitHub Actions workflow is required — this is a
static site with client-side JavaScript.

## Reusing this for a different sheet

Edit the top of `config.js` only:

```js
const SHEET_ID = "...";     // the long ID in the sheet's URL
const SHEET_GID = "...";    // the gid= value for the specific tab, from its URL
const SHEET_LABEL = "...";  // display label shown in the header
```

The column-letter mapping in `app.js` (`LIVE_COLS`) assumes the same layout
as the Srikakulam "Data Response" sheet (Division in A, PGRS in B, Name in D,
Aadhaar in F, Mobile in G, Mandal in H, Village in I, Documents in N,
Tahsildar Remarks in O, Nature of Resolution in S, RDO Remarks in T, JC
Remarks in U, Subject in W, Disposal Status in R, RC Number in Y, Date in Z,
Reason for Rejection in AA, Pending Officer in AB). If a different sheet uses
different columns, update `LIVE_COLS` in `app.js` to match.

## AI-analyzed fields (currently populated for 2 rows)

Three fields — **Field Enquiry Report**, **Persons Attended (Names)**, and
(when sourced from the Endorsement Letter) **Tahsildar Remarks** — are
produced by an AI reading the PDFs linked in the sheet's Enquiry Letter
(Column AH) / Endorsement Letter (Column AI) columns. A static page like
this one cannot call an AI model at runtime, so that analysis has to be
done ahead of time and supplied as data — that's what `ai-analysis.json`
in this folder is.

**As of this build, that file contains real analysis for the only two rows
that currently have a PDF uploaded**: sheet row 2 (Tahsildar Remarks only —
no Enquiry Letter on file for this row) and row 35 (Field Enquiry Report,
Persons Attended, and Tahsildar Remarks). Both include the petitioner's
name and case-specific land details; row 2's source document also shows an
address, phone number and Aadhaar number, none of which are reproduced
verbatim in the summary text but the summary is clearly about that named
person. This was committed to the public repo on explicit instruction,
having flagged the trade-off beforehand — it is not this build's default
behavior, and every other one of the 1,800+ rows still shows "not yet
analyzed" for these fields, which remains the safer default.

To extend this to more rows as new Enquiry/Endorsement Letters are uploaded
to the sheet:

1. Produce the analysis (via Claude or otherwise) for the new rows, keyed
   by sheet row number, in the same shape as the existing entries in
   `ai-analysis.json` (see also `ai-analysis.example.json` for a
   fictional-only template).
2. Add the new entries to `ai-analysis.json` and commit — but reconsider
   the privacy trade-off each time, since this is real, named-petitioner
   content going into a public, permanent (git history) location.
3. `app.js` picks up `ai-analysis.json` automatically after each sync; if
   an entry is removed, that row simply falls back to "not yet analyzed"
   again on the next sync.

## Outstanding security note

As of this build, the source Google Sheet itself has **"Anyone with the
link" set to Editor (writer)** access, not just Viewer — meaning anyone who
has or guesses the link can both read and *modify* 1,800+ citizens' Aadhaar
numbers, mobile numbers and grievance records, independent of this
dashboard. This is a sheet-sharing setting, not something this dashboard's
code controls. It's worth tightening to "Restricted" (with named editors
only) or at least "Viewer" for anyone-with-the-link, from the sheet's own
**Share** dialog in Google Drive — noting that doing so may also affect
whether this dashboard's live sync can reach it (see "Known limitation"
above), so plan for that together.

## What's the same as the chat-delivered version

Filters (date range, Mandal, Revenue Clinic Number), the Division/Mandal-wise
report with subtotals and a clickable Subject-wise breakup, drill-down into
matching grievance rows, the Grievance Lookup tab (search by Mobile or
Aadhaar number), the full per-petitioner Grievance Summary Report layout
including the narrative **AI Summary**, and the **Update / Sync Data**
button with a 60-second auto-refresh. The only difference is where the data
comes from: embedded there, fetched live here.
