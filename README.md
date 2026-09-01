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
- `config.js` — four settings (`SHEET_ID`, `SHEET_GID`, `SHEET_LABEL`,
  `AI_ANALYSIS_GID`) and an empty `DATA` object. This is the only file
  you'd typically edit to reuse this dashboard for a different sheet.
- `app.js` — all logic: filtering, the Division/Mandal-wise report, the
  Grievance Lookup tab, and the live sync (both the main data and the AI
  analysis — see "AI-analyzed fields" below).
- `google-apps-script/Code.gs` — runs inside your Google account (not on
  GitHub Pages) and does the actual PDF-reading; see "AI-analyzed fields".

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
const SHEET_ID = "...";        // the long ID in the sheet's URL
const SHEET_GID = "...";       // the gid= value for the "Data Response" tab, from its URL
const SHEET_LABEL = "...";     // display label shown in the header
const AI_ANALYSIS_GID = "...";  // the gid of the "AI Analysis" tab, once it exists (see below) — leave "" to skip
```

The column-letter mapping in `app.js` (`LIVE_COLS`) assumes the same layout
as the Srikakulam "Data Response" sheet (Division in A, PGRS in B, Name in D,
Aadhaar in F, Mobile in G, Mandal in H, Village in I, Documents in N,
Tahsildar Remarks in O, Nature of Resolution in S, RDO Remarks in T, JC
Remarks in U, Subject in W, Disposal Status in R, RC Number in Y, Date in Z,
Reason for Rejection in AA, Pending Officer in AB). If a different sheet uses
different columns, update `LIVE_COLS` in `app.js` to match.

## AI-analyzed fields

Four fields in the Grievance Summary Report are produced by an AI reading a
PDF, rather than typed directly into the sheet: **Petitioner's Original
Request** (Column AF), **Field Enquiry Report** and **Persons Attended
(Names)** (Column AH), and (when sourced from the Endorsement Letter)
**Tahsildar Remarks** (Column AI). A static page like this one cannot call
an AI model at runtime on its own, so that analysis has to happen elsewhere
and be supplied as data. Two ways to supply it, tried in that order:

1. **Live, automatically — the "AI Analysis" Google Sheet tab.** A Google
   Apps Script (`google-apps-script/Code.gs`, bound to your own Google
   account) watches Columns AF/AG/AH/AI on the "Data Response" sheet, and
   whenever a new or changed PDF link appears in one of them, reads that
   PDF with Google's Gemini API and writes a summary into an "AI Analysis"
   tab in the same spreadsheet. `app.js` fetches that tab live (same CSV
   mechanism as the main data) whenever `AI_ANALYSIS_GID` is set in
   `config.js`. This is the path that makes analysis happen "for every
   update" without anyone touching GitHub — see "Setting up the automatic
   pipeline" below.
2. **Static fallback — `ai-analysis.json`.** Used only when
   `AI_ANALYSIS_GID` is blank or the live tab can't be reached. **As of
   this build, this file contains real analysis for the two rows that had
   a PDF uploaded before the automatic pipeline existed**: row 2
   (Petitioner's Original Request and Tahsildar Remarks) and row 35
   (Petitioner's Original Request, Field Enquiry Report, Persons Attended,
   and Tahsildar Remarks). These include the petitioner's name and
   case-specific land details — committed to the public repo on explicit
   instruction, with the trade-off (petitioner-identifying content visible
   to any visitor, with no per-case review) flagged beforehand.

### Setting up the automatic pipeline

1. Open the spreadsheet, then **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste in the contents of
   `google-apps-script/Code.gs` from this repo.
3. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
   (a Google account is all that's needed; there's a free tier, though
   heavy PDF traffic can incur cost — check current pricing before relying
   on this at volume).
4. In the Apps Script editor, run `setApiKey` once: change its call in the
   editor to `setApiKey("your-key-here")`, select it from the function
   dropdown, and click **Run** (you'll be asked to authorize the script the
   first time — this is expected, since it needs permission to read Drive
   files and edit the spreadsheet). Alternatively set `GEMINI_API_KEY`
   directly under **Project Settings → Script Properties**.
5. Run `setup` once (same dropdown-and-Run process). This creates the "AI
   Analysis" tab if it doesn't exist, and installs the triggers that make
   the pipeline run automatically from now on (one that reacts to edits,
   and one that re-scans everything every 6 hours as a catch-up, in case a
   bulk paste or form submission doesn't fire an edit event the same way).
6. Run `scanAndAnalyzeAll` once to backfill analysis for any PDF links
   already in the sheet.
7. Open the new "AI Analysis" tab and copy the `gid=` number from its URL
   into `config.js` as `AI_ANALYSIS_GID`, then make sure that tab is shared
   the same way as "Data Response" ("Anyone with the link" can at least
   view) — otherwise the dashboard can't fetch it either. Redeploy
   `config.js` to GitHub Pages.

From then on, uploading a new PDF into Column AF, AH or AI for any row gets
read and summarized automatically (usually within moments via the edit
trigger, and certainly within 6 hours via the catch-up scan), and shows up
on the public dashboard on its next 60-second sync — no rebuild, no GitHub
commit. **Read the privacy note at the top of `Code.gs` before turning this
on** — there is no review step between a PDF being uploaded and its
AI-generated summary (which will name the petitioner) appearing on the
public site. To stop it, run `removeTriggers` from the Apps Script editor.

Column AG is also watched (its header is just "3" in the source sheet —
purpose unclear, nothing has ever been uploaded there) using a generic
prompt; its result is stored in the "AI Analysis" tab as
`AdditionalDocumentSummary` but isn't yet shown anywhere in the dashboard
UI — that's a small follow-up if AG ever starts being used for something
specific.

### Updating the static fallback by hand

If you'd rather not run the Apps Script pipeline, or want a fallback for
when the live tab is unreachable, edit `ai-analysis.json` directly: produce
the analysis (via Claude or otherwise) for the rows you want, keyed by
sheet row number, in the same shape as the existing entries (see also
`ai-analysis.example.json` for a fictional-only template). Reconsider the
privacy trade-off each time before committing — this is real, named-
petitioner content going into a public, permanent (git history) location.

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
matching grievance rows, the Grievance Lookup tab (search by Mobile Number,
Column G, or Aadhaar Number, Column F — either works, both have always been
wired into the search), the full per-petitioner Grievance Summary Report
layout — Petitioner's Original Request, Field Enquiry Report, Persons
Attended, Tahsildar Remarks, RDO/JC Remarks, and the narrative **AI
Summary** — and the **Update / Sync Data** button with a 60-second
auto-refresh. The only difference is where the data comes from: embedded
there, fetched live here.
