/**
 * Revenue Clinic Grievance Dashboard — automatic AI PDF analysis pipeline.
 *
 * Runs entirely inside this Google account (bound to the "Data Response" sheet).
 * Whenever a Petitioner Request Letter (Column AF), Enquiry Letter (Column AH) or
 * Endorsement Letter (Column AI) hyperlink is added or changed for a row, this
 * script reads that PDF with Google's Gemini API and writes a plain-language
 * summary into the "AI Analysis" tab of this same spreadsheet. Column AG is also
 * watched (its header is just "3" in the source sheet — purpose unclear, no PDF
 * has been uploaded there yet) using a generic prompt, in case it starts being
 * used; that result is stored but not yet shown in the dashboard UI.
 *
 * The dashboard's app.js reads the "AI Analysis" tab live (as CSV, same
 * mechanism it already uses for the main data) — see AI_ANALYSIS_GID in
 * config.js — so once this is running, new analysis appears on the public site
 * automatically, without anyone touching GitHub. See the README for full setup
 * steps; this file is the code half of that setup.
 *
 * ⚠️ Privacy note, read before turning this on: everything this script writes
 * to the "AI Analysis" tab is picked up by the public dashboard and shown to
 * any visitor, including petitioner names and case-specific details from
 * whatever PDF is analyzed. There is no per-case review step once this is
 * running — that trade-off was made deliberately for this project (see the
 * README's "AI-analyzed fields" section). Turn off the triggers (see
 * removeTriggers() below) if that's ever no longer the intent.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOURCE_SHEET_NAME = 'Data Response';
const AI_SHEET_NAME = 'AI Analysis';
const FIRST_DATA_ROW = 2;

// 1-indexed column numbers: A=1 … Z=26, AA=27 … AF=32, AG=33, AH=34, AI=35.
const WATCHED_COLUMNS = {
  AF: { num: 32, kind: 'petitionerRequest' },
  AG: { num: 33, kind: 'additionalDocument' },
  AH: { num: 34, kind: 'enquiryLetter' },
  AI: { num: 35, kind: 'endorsementLetter' },
};

// Gemini model + endpoint. Uses the API key stored in Script Properties (see
// setup() / setApiKey()) — never hardcode the key here, since this file may end
// up in the same repo as the public dashboard.
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Header row written to the "AI Analysis" tab. Column order doesn't matter to
// the dashboard (app.js reads by header name), but keep this in sync with the
// field names app.js's parseAiAnalysisCsv() understands.
const AI_SHEET_HEADERS = [
  'Row',
  'PetitionerRequestSummary', 'PetitionerRequestLetterUrl', 'PetitionerRequestLetterLabel',
  'FieldEnquiryReport', 'PersonsAttended', 'EnquiryLetterUrl', 'EnquiryLetterLabel',
  'TahsildarRemarks', 'EndorsementLetterUrl', 'EndorsementLetterLabel',
  'AdditionalDocumentSummary', 'AdditionalDocumentUrl', 'AdditionalDocumentLabel',
  // Internal bookkeeping — not read by the dashboard, used only so this script
  // doesn't re-analyze a PDF it already processed.
  '_AF_ProcessedUrl', '_AG_ProcessedUrl', '_AH_ProcessedUrl', '_AI_ProcessedUrl',
  '_LastUpdated', '_LastError',
];

const PROMPTS = {
  petitionerRequest:
    "This is a petitioner's original grievance request letter (\"Petitioner Request " +
    'Letter\") submitted to a Revenue Department Public Grievance Redressal System ' +
    '(PGRS) office in Andhra Pradesh, India. It may be in Telugu and/or English, and ' +
    'may include supporting enclosures (Aadhaar copy, survey/Adangal records, ' +
    'registered documents, etc.). Read it and write ONE concise paragraph (120-220 ' +
    'words) covering: the grievance number and date, the petitioner\'s name, village/' +
    'mandal, what land/survey numbers are involved, what they are requesting, and a ' +
    'brief list of the enclosures. Do NOT include the petitioner\'s Aadhaar number, ' +
    'phone number or residential address in your summary. Reply with ONLY the ' +
    'paragraph — no heading, no preamble, no markdown.',

  enquiryLetter:
    'This is a Field Enquiry Report / Enquiry Letter from a Revenue Department ' +
    'official in Andhra Pradesh, India, following up on a land grievance. It may be ' +
    'in Telugu and/or English. Read it and reply with ONLY a JSON object (no other ' +
    'text, no markdown fences) with exactly two keys: "fieldEnquiryReport" (one ' +
    'concise paragraph, 100-200 words, on when the enquiry was held, what was ' +
    'examined, and the findings/outcome) and "personsAttended" (a short comma-' +
    'separated list of the names/roles of people who attended or were involved, or ' +
    'an empty string if none are named).',

  endorsementLetter:
    'This is an Endorsement Letter issued by a Tahsildar office in Andhra Pradesh, ' +
    'India, in response to a land grievance (Public Grievance Redressal System). It ' +
    'may be in Telugu and/or English. Read it and write ONE concise paragraph ' +
    '(100-200 words) covering: who issued it and when, the grievance/RC number, the ' +
    "petitioner's name and what they requested, what the field enquiry found, and " +
    'the outcome/decision recorded on the endorsement. Do NOT include the ' +
    "petitioner's Aadhaar number, phone number or residential address in your " +
    'summary. Reply with ONLY the paragraph — no heading, no preamble, no markdown.',

  additionalDocument:
    'This is a document attached to a land grievance case file from a Revenue ' +
    'Department office in Andhra Pradesh, India (its exact purpose in the workflow ' +
    'is not labeled). It may be in Telugu and/or English. Read it and write ONE ' +
    'concise paragraph (80-150 words) describing what kind of document this is and ' +
    'its key content relevant to the grievance. Do NOT include the petitioner\'s ' +
    'Aadhaar number, phone number or residential address in your summary. Reply with ' +
    'ONLY the paragraph — no heading, no preamble, no markdown.',
};

// ---------------------------------------------------------------------------
// One-time setup — run this once from the Apps Script editor (see README)
// ---------------------------------------------------------------------------

function setup(){
  ensureAiSheet_();
  createTriggers_();
  Logger.log('Setup complete. Run scanAndAnalyzeAll() once now to backfill any ' +
    'existing PDF links, then leave the triggers running.');
}

function setApiKey(key){
  // Run this from the editor's "Run" menu with your Gemini API key pasted into
  // the call below (Run > setApiKey, or just execute this once with the key
  // filled in), OR set it via Project Settings > Script Properties in the Apps
  // Script UI instead — either way, do this before running scanAndAnalyzeAll().
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
}

function removeTriggers(){
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('All triggers removed. The pipeline will no longer run automatically.');
}

function createTriggers_(){
  removeTriggers();
  ScriptApp.newTrigger('onEditInstallable')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  // Catch-up scan: a form submission or an import/paste can add a hyperlink
  // without firing onEdit in a way this script sees, so a periodic full scan
  // is the safety net that guarantees "every update" eventually gets analyzed.
  ScriptApp.newTrigger('scanAndAnalyzeAll')
    .timeBased()
    .everyHours(6)
    .create();
}

// ---------------------------------------------------------------------------
// Real-time path: fires on every edit to the spreadsheet
// ---------------------------------------------------------------------------

function onEditInstallable(e){
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SOURCE_SHEET_NAME) return;
    const row = e.range.getRow();
    if (row < FIRST_DATA_ROW) return;

    const editedCols = new Set();
    for (let c = e.range.getColumn(); c < e.range.getColumn() + e.range.getNumColumns(); c++){
      editedCols.add(c);
    }
    Object.keys(WATCHED_COLUMNS).forEach(letter => {
      if (editedCols.has(WATCHED_COLUMNS[letter].num)){
        processCell_(sheet, row, letter);
      }
    });
  } catch (err){
    Logger.log('onEditInstallable error: ' + err);
  }
}

// ---------------------------------------------------------------------------
// Catch-up path: scans every row for links this script hasn't processed yet
// ---------------------------------------------------------------------------

function scanAndAnalyzeAll(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  if (!sheet) { Logger.log('Sheet "' + SOURCE_SHEET_NAME + '" not found.'); return; }
  const lastRow = sheet.getLastRow();

  for (let row = FIRST_DATA_ROW; row <= lastRow; row++){
    Object.keys(WATCHED_COLUMNS).forEach(letter => {
      processCell_(sheet, row, letter);
    });
  }
  Logger.log('scanAndAnalyzeAll complete through row ' + lastRow);
}

// ---------------------------------------------------------------------------
// Core: analyze one cell if its link is new/changed since last processed
// ---------------------------------------------------------------------------

function processCell_(sheet, row, colLetter){
  const colInfo = WATCHED_COLUMNS[colLetter];
  const cell = sheet.getRange(row, colInfo.num);
  const link = extractHyperlink_(cell);
  const aiSheet = ensureAiSheet_();
  const aiRow = findOrCreateAiRow_(aiSheet, row);
  const trackedCol = '_' + colLetter + '_ProcessedUrl';
  const alreadyProcessed = getAiCell_(aiSheet, aiRow, trackedCol);

  if (!link || !link.url){
    return; // nothing uploaded in this cell
  }
  if (link.url === alreadyProcessed){
    return; // no change since last run
  }

  try {
    const fileId = extractDriveFileId_(link.url);
    if (!fileId) throw new Error('Could not parse a Drive file ID from ' + link.url);
    const blob = DriveApp.getFileById(fileId).getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType() || 'application/pdf';
    const promptKey = colInfo.kind;
    const text = callGemini_(base64, mimeType, PROMPTS[promptKey]);
    writeAnalysis_(aiSheet, aiRow, colLetter, colInfo, link, text);
    setAiCell_(aiSheet, aiRow, trackedCol, link.url);
    setAiCell_(aiSheet, aiRow, '_LastUpdated', new Date().toISOString());
    setAiCell_(aiSheet, aiRow, '_LastError', '');
  } catch (err){
    Logger.log('processCell_ failed for row ' + row + ' col ' + colLetter + ': ' + err);
    setAiCell_(aiSheet, aiRow, '_LastError',
      new Date().toISOString() + ' — ' + colLetter + ': ' + err);
  }
}

function extractHyperlink_(cell){
  // Column AF/AH/AI cells use =HYPERLINK(url, label) formulas (matching how the
  // dashboard's own build script reads them), so read the formula rather than
  // the rich-text link.
  const formula = cell.getFormula();
  if (formula){
    const m = /HYPERLINK\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*\)/i.exec(formula);
    if (m) return { url: m[1], label: m[2] };
  }
  // Fall back to a plain rich-text hyperlink, in case a cell is ever pasted in
  // that way instead of as a formula.
  const rich = cell.getRichTextValue();
  const url = rich && rich.getLinkUrl();
  if (url) return { url: url, label: cell.getValue() || '' };
  return null;
}

function extractDriveFileId_(url){
  const m = /\/d\/([a-zA-Z0-9_-]+)/.exec(url) || /[?&]id=([a-zA-Z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

function callGemini_(base64Data, mimeType, prompt){
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey){
    throw new Error('No GEMINI_API_KEY set — run setApiKey("your-key") once from the editor, or set it in Project Settings > Script Properties.');
  }
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64Data } },
      ],
    }],
  };
  const res = UrlFetchApp.fetch(GEMINI_URL + '?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200){
    throw new Error('Gemini API HTTP ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  const data = JSON.parse(res.getContentText());
  const text = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini API returned no text: ' + res.getContentText().slice(0, 500));
  return text.trim();
}

function writeAnalysis_(aiSheet, aiRow, colLetter, colInfo, link, text){
  if (colInfo.kind === 'petitionerRequest'){
    setAiCell_(aiSheet, aiRow, 'PetitionerRequestSummary', text);
    setAiCell_(aiSheet, aiRow, 'PetitionerRequestLetterUrl', link.url);
    setAiCell_(aiSheet, aiRow, 'PetitionerRequestLetterLabel', link.label || '');
  } else if (colInfo.kind === 'endorsementLetter'){
    setAiCell_(aiSheet, aiRow, 'TahsildarRemarks', text);
    setAiCell_(aiSheet, aiRow, 'EndorsementLetterUrl', link.url);
    setAiCell_(aiSheet, aiRow, 'EndorsementLetterLabel', link.label || '');
  } else if (colInfo.kind === 'additionalDocument'){
    setAiCell_(aiSheet, aiRow, 'AdditionalDocumentSummary', text);
    setAiCell_(aiSheet, aiRow, 'AdditionalDocumentUrl', link.url);
    setAiCell_(aiSheet, aiRow, 'AdditionalDocumentLabel', link.label || '');
  } else if (colInfo.kind === 'enquiryLetter'){
    // Gemini was asked for JSON here — parse it, tolerating markdown code fences.
    let parsed;
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/,'').trim();
      parsed = JSON.parse(cleaned);
    } catch (e){
      parsed = { fieldEnquiryReport: text, personsAttended: '' };
    }
    setAiCell_(aiSheet, aiRow, 'FieldEnquiryReport', parsed.fieldEnquiryReport || '');
    setAiCell_(aiSheet, aiRow, 'PersonsAttended', parsed.personsAttended || '');
    setAiCell_(aiSheet, aiRow, 'EnquiryLetterUrl', link.url);
    setAiCell_(aiSheet, aiRow, 'EnquiryLetterLabel', link.label || '');
  }
}

// ---------------------------------------------------------------------------
// "AI Analysis" tab helpers
// ---------------------------------------------------------------------------

function ensureAiSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AI_SHEET_NAME);
  if (!sheet){
    sheet = ss.insertSheet(AI_SHEET_NAME);
    sheet.getRange(1, 1, 1, AI_SHEET_HEADERS.length).setValues([AI_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
    Logger.log('Created "' + AI_SHEET_NAME + '" tab. Its gid is in the URL when you ' +
      'open it (…#gid=NNNNNNN) — put that in config.js as AI_ANALYSIS_GID, and make ' +
      'sure this sheet is shared so "Anyone with the link" can at least view it, same ' +
      'as the main Data Response tab, or the dashboard won\'t be able to fetch it.');
  } else {
    // Keep headers in sync if this script's schema is ever extended.
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    if (existing.join('|') !== AI_SHEET_HEADERS.join('|')){
      sheet.getRange(1, 1, 1, AI_SHEET_HEADERS.length).setValues([AI_SHEET_HEADERS]);
    }
  }
  return sheet;
}

function headerIndex_(sheet){
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i + 1; }); // 1-indexed column number
  return idx;
}

function findOrCreateAiRow_(sheet, sourceRow){
  const idx = headerIndex_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2){
    const rowValues = sheet.getRange(2, idx['Row'], lastRow - 1, 1).getValues();
    for (let i = 0; i < rowValues.length; i++){
      if (String(rowValues[i][0]) === String(sourceRow)) return i + 2;
    }
  }
  const newRow = lastRow + 1;
  sheet.getRange(newRow, idx['Row']).setValue(sourceRow);
  return newRow;
}

function setAiCell_(sheet, row, header, value){
  const idx = headerIndex_(sheet);
  if (!idx[header]) return;
  sheet.getRange(row, idx[header]).setValue(value);
}

function getAiCell_(sheet, row, header){
  const idx = headerIndex_(sheet);
  if (!idx[header]) return '';
  return sheet.getRange(row, idx[header]).getValue();
}
