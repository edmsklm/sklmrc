/* Revenue Clinic Grievance Dashboard — client-side app.
   Public-repo build: NO grievance data is embedded in this file or in config.js.
   Everything shown on the page is fetched live, in the visitor's own browser,
   directly from the public Google Sheet CSV export — see attemptSync() below.
   Until the first sync succeeds, the UI shows a loading state instead of data. */

let expandedMandals = new Set();
let currentFilters = { from: '', to: '', mandal: '', rc: '' };
let currentDetailRecord = null;

let dataReady = false;        // true once at least one sync has succeeded
let lastSyncErrorMsg = '';    // human-readable reason the last sync failed

/* ---------------- Init ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  updateSyncedLabel();
  renderDashboard();   // shows the loading state — dataReady is still false here

  // Sync immediately on load (this build has no fallback data), then every
  // 60 seconds, plus whenever the "Update / Sync Data" button is clicked.
  attemptSync(false);
  setInterval(() => attemptSync(false), 60000);
  setInterval(updateSyncedLabel, 60000);
});

function updateSyncedLabel(){
  const el = document.getElementById('metaAsOf');
  if (!DATA.meta || !DATA.meta.syncedAt){ el.textContent = '—'; return; }
  const synced = new Date(DATA.meta.syncedAt);
  const mins = Math.max(0, Math.round((Date.now() - synced.getTime()) / 60000));
  const when = synced.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const ago = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : (mins < 60 ? `${mins} min ago` : `${Math.round(mins/60)} hr ago`);
  el.textContent = `${when} (${ago})`;
}

function titleCase(s){
  return (s||'').toLowerCase().replace(/(^|\s|\.)([a-z])/g, (m,a,b)=>a+b.toUpperCase());
}

function switchTab(tab){
  document.getElementById('tabDashboard').style.display = tab==='dashboard' ? '' : 'none';
  document.getElementById('tabLookup').style.display = tab==='lookup' ? '' : 'none';
  document.getElementById('tabBtnDashboard').classList.toggle('active', tab==='dashboard');
  document.getElementById('tabBtnLookup').classList.toggle('active', tab==='lookup');
}

/* ---------------- Cold-start / loading / error states ----------------
   This build starts with zero records (see config.js), so both tabs need to
   show something sensible before the first sync completes, and something
   actionable if that sync fails outright. */
function loadStateHtml(opts){
  opts = opts || {};
  if (opts.error){
    return `<div class="load-state error">
      <div>Could not load grievance data from the Google Sheet.</div>
      <div style="margin-top:4px; font-size:12px;">${escapeHtml(opts.error)}</div>
      <div style="margin-top:4px; font-size:12px;">This page ships with no data of its own — everything comes from a live fetch, so this usually means the sheet isn't reachable from here (see the README for details).</div>
      <button class="btn secondary retry-btn" onclick="attemptSync(true)">Retry now</button>
    </div>`;
  }
  return `<div class="load-state">
    <div class="spinner"></div>
    <div>Loading grievance data from the Google Sheet…</div>
  </div>`;
}

/* ---------------- Filtering ---------------- */
function applyFilters(){
  currentFilters = {
    from: document.getElementById('fFrom').value,
    to: document.getElementById('fTo').value,
    mandal: document.getElementById('fMandal').value,
    rc: document.getElementById('fRC').value,
  };
  renderDashboard();
}
function resetFilters(){
  document.getElementById('fFrom').value = '';
  document.getElementById('fTo').value = '';
  document.getElementById('fMandal').value = '';
  document.getElementById('fRC').value = '';
  currentFilters = { from:'', to:'', mandal:'', rc:'' };
  renderDashboard();
}

function passesTopFilters(r){
  if (currentFilters.from){ if(!r.dateISO || r.dateISO < currentFilters.from) return false; }
  if (currentFilters.to){ if(!r.dateISO || r.dateISO > currentFilters.to) return false; }
  if (currentFilters.mandal){ if(r.mandal !== currentFilters.mandal) return false; }
  if (currentFilters.rc){ if(r.rcNumber !== currentFilters.rc) return false; }
  return true;
}
function filteredRecords(){
  return DATA.records.filter(passesTopFilters);
}

/* ---------------- Aggregation ---------------- */
function emptyCounts(){ return { total:0, Accepted:0, Rejected:0, 'Under Process':0 }; }
function addCount(bucket, status){
  bucket.total++; bucket[status] = (bucket[status]||0) + 1;
}

function buildAggregation(records){
  const divisions = {}; // divName -> { counts, mandals: { mandalName -> { counts, subjects: { subj -> counts } } } }
  const grand = emptyCounts();
  records.forEach(r => {
    const divKey = r.division || '(Division Not Specified)';
    const mKey = r.mandal || '(Mandal Not Specified)';
    const sKey = r.subject || '(Subject Not Specified)';
    if (!divisions[divKey]) divisions[divKey] = { counts: emptyCounts(), mandals: {} };
    const div = divisions[divKey];
    addCount(div.counts, r.status);

    if (!div.mandals[mKey]) div.mandals[mKey] = { counts: emptyCounts(), subjects: {} };
    const man = div.mandals[mKey];
    addCount(man.counts, r.status);

    if (!man.subjects[sKey]) man.subjects[sKey] = emptyCounts();
    addCount(man.subjects[sKey], r.status);

    addCount(grand, r.status);
  });
  return { divisions, grand };
}

/* ---------------- Rendering: Dashboard ---------------- */
function statCardHtml(cls, label, val){
  return `<div class="stat-card ${cls}"><div class="num">${val.toLocaleString('en-IN')}</div><div class="lbl">${label}</div></div>`;
}

function renderDashboard(){
  const body = document.getElementById('reportBody');

  if (!dataReady){
    document.getElementById('statRow').innerHTML = '';
    body.innerHTML = `<tr><td colspan="5">${loadStateHtml(lastSyncErrorMsg ? { error: lastSyncErrorMsg } : {})}</td></tr>`;
    return;
  }

  const records = filteredRecords();
  const { divisions, grand } = buildAggregation(records);

  document.getElementById('statRow').innerHTML =
    statCardHtml('total', 'Total Grievances (filtered)', grand.total) +
    statCardHtml('accepted', 'Accepted', grand.Accepted) +
    statCardHtml('rejected', 'Rejected', grand.Rejected) +
    statCardHtml('process', 'Under Process (Balance)', grand['Under Process']);

  let html = '';

  const divNames = Object.keys(divisions).sort();
  divNames.forEach(divName => {
    const div = divisions[divName];
    html += rowHtml('row-division', escapeHtml(divName), div.counts, {division:divName});

    const mandalNames = Object.keys(div.mandals).sort();
    mandalNames.forEach(mandalName => {
      const man = div.mandals[mandalName];
      const key = divName + '||' + mandalName;
      const isOpen = expandedMandals.has(key);
      html += `<tr class="row-mandal" data-key="${escapeAttr(key)}" onclick="toggleMandal('${escapeAttr(key)}')">
        <td><span class="caret ${isOpen?'open':''}">&#9656;</span>${escapeHtml(titleCase(mandalName))}</td>
        ${countCellsHtml(man.counts, {division:divName, mandal:mandalName})}
      </tr>`;

      if (isOpen){
        const subjNames = Object.keys(man.subjects).sort((a,b)=> man.subjects[b].total - man.subjects[a].total);
        subjNames.forEach(subjName => {
          const sc = man.subjects[subjName];
          html += `<tr class="row-subject">
            <td>${escapeHtml(subjName)}</td>
            ${countCellsHtml(sc, {division:divName, mandal:mandalName, subject:subjName})}
          </tr>`;
        });
      }
    });
  });

  html += `<tr class="row-grandtotal"><td>Grand Total</td>${countCellsHtml(grand, {})}</tr>`;

  body.innerHTML = html || `<tr><td colspan="5" class="empty-msg">No records match the selected filters.</td></tr>`;
}

function rowHtml(cls, label, counts, filterSpec){
  return `<tr class="${cls}"><td>${label}</td>${countCellsHtml(counts, filterSpec)}</tr>`;
}

function countCellsHtml(counts, filterSpec){
  const mk = (val, statusKey, cls) => {
    if (!val) return `<button class="num-link ${cls}" disabled>0</button>`;
    const spec = Object.assign({}, filterSpec, statusKey ? {status:statusKey} : {});
    return `<button class="num-link ${cls}" onclick='event.stopPropagation(); openDetail(${JSON.stringify(spec)})'>${val.toLocaleString('en-IN')}</button>`;
  };
  return `<td class="col-counts">${mk(counts.total, null, 'totalnum')}</td>
          <td class="col-counts">${mk(counts.Accepted, 'Accepted', 'accepted')}</td>
          <td class="col-counts">${mk(counts.Rejected, 'Rejected', 'rejected')}</td>
          <td class="col-counts">${mk(counts['Under Process'], 'Under Process', 'process')}</td>`;
}

function toggleMandal(key){
  if (expandedMandals.has(key)) expandedMandals.delete(key); else expandedMandals.add(key);
  renderDashboard();
}

/* ---------------- Detail Modal ---------------- */
function openDetail(spec){
  let rows = filteredRecords();
  if (spec.division) rows = rows.filter(r => (r.division || '(Division Not Specified)') === spec.division);
  if (spec.mandal) rows = rows.filter(r => (r.mandal || '(Mandal Not Specified)') === spec.mandal);
  if (spec.subject) rows = rows.filter(r => (r.subject || '(Subject Not Specified)') === spec.subject);
  if (spec.status) rows = rows.filter(r => r.status === spec.status);

  const titleParts = [];
  if (spec.status) titleParts.push(spec.status);
  if (spec.subject) titleParts.push('— ' + spec.subject);
  if (spec.mandal) titleParts.push('in ' + titleCase(spec.mandal));
  if (spec.division) titleParts.push('(' + titleCase(spec.division) + ' Division)');
  document.getElementById('modalTitle').textContent =
    (titleParts.length ? titleParts.join(' ') : 'All Grievances') + ` — ${rows.length} record(s)`;

  let html = `<table><thead><tr>
      <th>#</th><th>PGRS / File No.</th><th>Petitioner</th><th>Mandal</th><th>Village</th>
      <th>Subject Brief</th><th>RC No.</th><th>Date</th><th>Status</th>
    </tr></thead><tbody>`;
  rows.slice(0, 500).forEach((r, i) => {
    html += `<tr>
      <td>${i+1}</td>
      <td>${escapeHtml(r.pgrs || '—')}</td>
      <td>${escapeHtml(r.name || '—')}</td>
      <td>${escapeHtml(titleCase(r.mandal))}</td>
      <td>${escapeHtml(r.village || '—')}</td>
      <td>${escapeHtml(r.subject || '—')}</td>
      <td>${escapeHtml(r.rcNumber || '—')}</td>
      <td>${escapeHtml(r.dateRaw || '—')}</td>
      <td><span class="badge ${statusClass(r.status)}">${r.status}</span></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  if (rows.length > 500){
    html += `<div class="empty-msg">Showing first 500 of ${rows.length} matching records.</div>`;
  }
  if (rows.length === 0){
    html = `<div class="empty-msg">No matching grievance records.</div>`;
  }
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal(){
  document.getElementById('modalBackdrop').classList.remove('open');
}
function sheetRowUrl(rowNum){
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}&range=A${rowNum}`;
}
function statusClass(s){
  if (s==='Accepted') return 'accepted';
  if (s==='Rejected') return 'rejected';
  return 'process';
}

/* ---------------- Grievance Lookup ---------------- */
function normDigits(s){ return (s||'').replace(/\D/g, ''); }

function doLookup(){
  const qRaw = document.getElementById('lookupInput').value.trim();
  const resultsEl = document.getElementById('lookupResults');
  document.getElementById('detailPanel').style.display = 'none';

  if (!dataReady){
    resultsEl.innerHTML = loadStateHtml(lastSyncErrorMsg ? { error: lastSyncErrorMsg } : {});
    return;
  }

  if (!qRaw){ resultsEl.innerHTML = `<div class="empty-msg">Enter a Mobile Number or Aadhaar Number to search.</div>`; return; }

  const q = normDigits(qRaw);
  if (q.length < 4){ resultsEl.innerHTML = `<div class="empty-msg">Enter at least 4 digits to search.</div>`; return; }

  const matches = DATA.records.filter(r => {
    const mob = normDigits(r.mobile);
    const aad = normDigits(r.aadhaar);
    return (mob && mob.includes(q)) || (aad && aad.includes(q));
  });

  if (matches.length === 0){
    resultsEl.innerHTML = `<div class="empty-msg">No grievance found for "${escapeHtml(qRaw)}".</div>`;
    return;
  }

  resultsEl.innerHTML = matches.slice(0, 50).map(r => `
    <div class="lookup-result-item" onclick="showDetail(${r.id})">
      <div>
        <div class="lr-name">${escapeHtml(r.name || 'Unnamed Petitioner')}</div>
        <div class="lr-sub">${escapeHtml(r.subject || 'No subject recorded')} · ${escapeHtml(titleCase(r.mandal))}${r.village ? ', ' + escapeHtml(r.village) : ''} · ${escapeHtml(r.dateRaw || 'No date')}</div>
      </div>
      <span class="badge ${statusClass(r.status)}">${r.status}</span>
    </div>
  `).join('');
  if (matches.length > 50){
    resultsEl.innerHTML += `<div class="empty-msg">Showing first 50 of ${matches.length} matches. Refine your search for a specific record.</div>`;
  }
}

function showDetail(id){
  const r = DATA.records.find(x => x.id === id);
  if (!r) return;
  currentDetailRecord = r;
  const panel = document.getElementById('detailPanel');
  panel.style.display = '';

  const ai = generateAISuggestion(r);

  panel.innerHTML = `
    <span class="back-link" onclick="document.getElementById('detailPanel').style.display='none';">&larr; Back to search results</span>
    <div class="detail-head">
      <div>
        <h2 style="margin:0;">${escapeHtml(r.name || 'Unnamed Petitioner')}</h2>
        <div class="pgrs-tag">PGRS/File No: ${escapeHtml(r.pgrs || '—')} &nbsp;·&nbsp; Sheet row ${r.row}</div>
      </div>
      <span class="badge ${statusClass(r.status)} status-badge">${r.status}${r.statusRaw ? ' (' + escapeHtml(r.statusRaw) + ')' : ''}</span>
    </div>

    <div class="summary-grid">
      <div class="summary-block full">
        <h4><span class="roman">I.</span>Brief Issue</h4>
        <div class="val">${escapeHtml(r.subject) || '<span class="placeholder">Not recorded</span>'}</div>
      </div>

      <div class="summary-block">
        <h4><span class="roman">II.</span>Date</h4>
        <div class="val">${escapeHtml(r.dateRaw) || '<span class="placeholder">Not recorded</span>'}</div>
      </div>
      <div class="summary-block">
        <h4><span class="roman">III.</span>Mandal</h4>
        <div class="val">${escapeHtml(titleCase(r.mandal)) || '<span class="placeholder">Not recorded</span>'}</div>
      </div>
      <div class="summary-block full" style="grid-column:1;">
        <h4><span class="roman">IV.</span>Village</h4>
        <div class="val">${escapeHtml(r.village) || '<span class="placeholder">Not recorded</span>'}</div>
      </div>

      <div class="summary-block">
        <h4>Documents Submitted by Petitioner</h4>
        <div class="val">${escapeHtml(r.docsPetitioner) || '<span class="placeholder">None recorded</span>'}</div>
      </div>
      <div class="summary-block">
        <h4>Documents Verified by Department</h4>
        <div class="val placeholder">Not yet captured in source sheet — pending manual entry.</div>
      </div>

      <div class="summary-block full">
        <h4>Petitioner's Original Request</h4>
        <div class="val">${
          r.petitionerRequestSummary
            ? escapeHtml(r.petitionerRequestSummary) + (r.petitionerRequestLetterUrl ? `<br><a class="sheet-link" target="_blank" rel="noopener" href="${escapeAttr(r.petitionerRequestLetterUrl)}">View Petitioner Request Letter (PDF) ↗</a>` : '')
            : (r.petitionerRequestLetterUrl
                ? `<span class="placeholder">Request Letter uploaded but not yet analyzed.</span><br><a class="sheet-link" target="_blank" rel="noopener" href="${escapeAttr(r.petitionerRequestLetterUrl)}">View Petitioner Request Letter (PDF) ↗</a>`
                : '<span class="placeholder">No Petitioner Request Letter uploaded yet in Column AF.</span>')
        }</div>
      </div>

      <div class="summary-block full">
        <h4>Field Enquiry Report</h4>
        <div class="val">${
          r.fieldEnquiryReport
            ? escapeHtml(r.fieldEnquiryReport) + (r.enquiryLetterUrl ? `<br><a class="sheet-link" target="_blank" rel="noopener" href="${escapeAttr(r.enquiryLetterUrl)}">View Enquiry Letter (PDF) ↗</a>` : '')
            : (r.enquiryLetterUrl
                ? `<span class="placeholder">Enquiry Letter uploaded but not yet analyzed.</span><br><a class="sheet-link" target="_blank" rel="noopener" href="${escapeAttr(r.enquiryLetterUrl)}">View Enquiry Letter (PDF) ↗</a>`
                : '<span class="placeholder">No Enquiry Letter uploaded yet in Column AH.</span>')
        }</div>
      </div>
      <div class="summary-block full">
        <h4>Persons Attended (Names)</h4>
        <div class="val">${escapeHtml(r.personsAttended) || '<span class="placeholder">Not available — no Enquiry Letter analyzed yet.</span>'}</div>
      </div>

      <div class="summary-block full">
        <h4>Tahsildar Remarks${r.remarksTahsildarSource === 'ai' ? ' <span style="font-weight:400; text-transform:none; color:var(--text-faint); font-size:11px;">(AI-analyzed from Endorsement Letter)</span>' : ''}</h4>
        <div class="val">${escapeHtml(r.remarksTahsildar) || '<span class="placeholder">No remarks recorded</span>'}${r.endorsementLetterUrl ? `<br><a class="sheet-link" target="_blank" rel="noopener" href="${escapeAttr(r.endorsementLetterUrl)}">View Endorsement Letter (PDF) ↗</a>` : ''}</div>
      </div>
      <div class="summary-block">
        <h4>RDO Remarks</h4>
        <div class="val">${escapeHtml(r.remarksRDO) || '<span class="placeholder">No remarks recorded</span>'}</div>
      </div>
      <div class="summary-block">
        <h4>JC Remarks</h4>
        <div class="val">${escapeHtml(r.remarksJC) || '<span class="placeholder">No remarks recorded</span>'}</div>
      </div>
    </div>

    <div class="ai-block">
      <h4>AI Summary</h4>
      <div class="disclaimer">System-generated (rule-based) summary composed from this grievance's own recorded fields — subject, documents, remarks and status. For the officer's quick reference only — please verify against the source row before acting.</div>
      ${ai.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
    </div>
  `;
}

function generateAISuggestion(r){
  const paras = [];
  const petitioner = r.name || 'The petitioner';
  const place = [titleCase(r.mandal), r.village].filter(Boolean).join(', ');

  /* Paragraph 1: what the case is about, drawn from Subject Brief, Mandal/Village, Date, RC number */
  let p1 = `${petitioner} raised a grievance` +
    (r.subject ? ` regarding "${r.subject}"` : ' with no subject/brief issue recorded') +
    (place ? ` at ${place}` : '') +
    (r.dateRaw ? ` on ${r.dateRaw}` : '') +
    (r.rcNumber ? ` (Revenue Clinic #${r.rcNumber})` : '') + '.';
  paras.push(p1);

  /* Paragraph 2: documents on file, straight from the Documents column */
  if (r.docsPetitioner){
    paras.push(`Documents on record from the petitioner: ${r.docsPetitioner}.`);
  } else {
    paras.push('No documents from the petitioner are recorded on file.');
  }

  /* Paragraph 3: remarks recorded at each level, straight from O / S / T / U */
  const remarkBits = [];
  if (r.remarksTahsildar) remarkBits.push(`Tahsildar — ${r.remarksTahsildar}`);
  if (r.natureOfResolution) remarkBits.push(`Nature of Resolution — ${r.natureOfResolution}`);
  if (r.remarksRDO) remarkBits.push(`RDO — ${r.remarksRDO}`);
  if (r.remarksJC) remarkBits.push(`Joint Collector — ${r.remarksJC}`);
  if (remarkBits.length){
    paras.push(`Departmental remarks recorded so far: ${remarkBits.join(' | ')}.`);
  } else {
    paras.push('No departmental remarks have been recorded yet at the Tahsildar, RDO or Joint Collector level.');
  }

  /* Paragraph 4: status + reason/pending officer, and a brief recommended next step woven in */
  if (r.status === 'Accepted'){
    paras.push(`Current status: Accepted${r.statusRaw ? ` ("${r.statusRaw}")` : ''}. Recommended next step: issue the final order / certificate as applicable, update Webland / 1-B records, and close the file after confirming the update.`);
  } else if (r.status === 'Rejected'){
    let reasonSentence = r.reasonRejection ? ` Recorded reason: "${r.reasonRejection}".` : ' No specific reason for rejection has been recorded.';
    paras.push(`Current status: Rejected${r.statusRaw ? ` ("${r.statusRaw}")` : ''}.${reasonSentence} Recommended next step: ensure the petitioner has been informed in writing, and advise them of the option to represent the matter to the RDO / Joint Collector if aggrieved.`);
  } else {
    let pendingSentence = r.pendingOfficer ? ` It is currently pending at: ${r.pendingOfficer}.` : ' No officer is currently recorded as responsible for further action.';
    paras.push(`Current status: Under Process${r.statusRaw ? ` ("${r.statusRaw}")` : ''}.${pendingSentence} Recommended next step: follow up for a status update and record it against this grievance, with a target date for closure.`);
  }

  return paras;
}

/* ---------------- Live Sync (every 60s + on button click + on load) ----------------
   Fetches the sheet's CSV export directly from the visitor's browser and builds
   every record from it. There is no baked-in fallback data in this build, so
   until the first fetch succeeds the UI shows a loading state, and if it fails
   outright it shows a retry prompt instead of misleadingly showing zero records.

   The Petitioner's Original Request / Field Enquiry Report / Persons Attended /
   AI-sourced Tahsildar Remarks fields come from a second source, tried in order:
     1. A live "AI Analysis" tab in the same Google Sheet, if AI_ANALYSIS_GID is
        set in config.js — this is what the Google Apps Script + Gemini pipeline
        (see google-apps-script/Code.gs and the README) keeps updated automatically
        whenever a new PDF link appears in columns AF/AH/AI. This is the "live"
        path and needs no rebuild or redeploy of this site to pick up new analysis.
     2. The static ai-analysis.json bundled with this deployment, as a fallback if
        AI_ANALYSIS_GID isn't set or the live tab can't be reached — see
        ai-analysis.example.json and the README for its format. Without either
        source, those fields simply show as "not yet analyzed". */

let syncInProgress = false;
let lastSyncOk = null; // null = never tried/unknown, true/false = last attempt result
let aiAnalysis = null;  // last-loaded AI analysis data; re-fetched on every sync (see attemptSync) so newly-analyzed PDFs from the live pipeline show up without a page reload

function csvExportUrl(){
  // The plain /export?format=csv link 302-redirects to a separate googleusercontent.com
  // host, and that hop isn't reliably fetchable cross-origin from a browser. The
  // /gviz/tq endpoint is Google's public Visualization Query API — built to be
  // embedded/fetched from other sites — and returns CSV directly from
  // docs.google.com with no redirect. Note: this still depends on the sheet being
  // reachable without signing in, and on Google sending CORS headers permissive
  // enough for a fetch() from wherever this page is hosted — see the README for
  // the known limitation here.
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
}

function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQuotes){
      if (c === '"'){
        if (text[i+1] === '"'){ field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ','){ row.push(field); field = ''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r'){ /* skip, \n handles the break */ }
      else field += c;
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

const MANDAL_FIX = { 'MELIAPTUTTI': 'MELIAPUTTI', 'VAJRQAPUKOTTURU': 'VAJRAPUKOTTURU' };
function liveNormMandal(v){ v = (v||'').trim().toUpperCase().replace(/\s+/g,' '); return MANDAL_FIX[v] || v; }
function liveParseDate(v){
  v = (v||'').trim();
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
  if (!m) return { iso: null, raw: v };
  const [, d, mo, y] = m;
  return { iso: `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`, raw: v };
}
function liveClassifyStatus(raw){
  const r = (raw||'').trim().toLowerCase();
  if (r.includes('accept')) return 'Accepted';
  if (r.includes('reject')) return 'Rejected';
  return 'Under Process';
}
function colIdx(letter){ let n=0; for (const c of letter) n = n*26 + (c.charCodeAt(0)-64); return n-1; }
const LIVE_COLS = {
  division:'A', pgrs:'B', name:'D', aadhaar:'F', mobile:'G', mandal:'H', village:'I',
  docsPetitioner:'N', remarksTahsildar:'O', natureOfResolution:'S', remarksRDO:'T', remarksJC:'U',
  subject:'W', statusRaw:'R', rcNumber:'Y', dateRaw:'Z', reasonRejection:'AA', pendingOfficer:'AB',
};
function liveGet(row, key){ const i = colIdx(LIVE_COLS[key]); return (i < row.length ? (row[i]||'').trim() : ''); }

function aiAnalysisSheetCsvUrl(){
  // AI_ANALYSIS_GID is set in config.js once the "AI Analysis" tab exists (created
  // by google-apps-script/Code.gs's setup() function). Empty/unset means this
  // deployment hasn't been wired to the live pipeline yet — falls back to the
  // static file below.
  if (typeof AI_ANALYSIS_GID === 'undefined' || !AI_ANALYSIS_GID) return null;
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${AI_ANALYSIS_GID}`;
}

// The "AI Analysis" tab is a file this app fully controls the shape of (unlike the
// main "Data Response" sheet), so it's parsed by header name rather than by fixed
// column letter — see google-apps-script/Code.gs's HEADER_ROW for the exact columns.
function parseAiAnalysisCsv(text){
  const rows = parseCSV(text);
  if (!rows.length) return {};
  const header = rows[0].map(h => (h || '').trim());
  const colIndex = {};
  header.forEach((h, i) => { colIndex[h] = i; });
  if (colIndex['Row'] === undefined) return {};

  const field = (row, name) => {
    const i = colIndex[name];
    return (i !== undefined && row[i]) ? row[i].trim() : '';
  };

  const out = {};
  for (let i = 1; i < rows.length; i++){
    const row = rows[i];
    const rowNum = field(row, 'Row');
    if (!rowNum) continue;
    const entry = {};
    const copyIf = (col, key) => { const v = field(row, col); if (v) entry[key] = v; };
    copyIf('PetitionerRequestSummary', 'petitionerRequestSummary');
    copyIf('PetitionerRequestLetterUrl', 'petitionerRequestLetterUrl');
    copyIf('PetitionerRequestLetterLabel', 'petitionerRequestLetterLabel');
    copyIf('FieldEnquiryReport', 'fieldEnquiryReport');
    copyIf('PersonsAttended', 'personsAttended');
    copyIf('EnquiryLetterUrl', 'enquiryLetterUrl');
    copyIf('EnquiryLetterLabel', 'enquiryLetterLabel');
    copyIf('EndorsementLetterUrl', 'endorsementLetterUrl');
    copyIf('EndorsementLetterLabel', 'endorsementLetterLabel');
    const remarks = field(row, 'TahsildarRemarks');
    if (remarks){
      entry.remarksTahsildar = remarks;
      entry.remarksTahsildarSource = 'ai';
    }
    if (Object.keys(entry).length) out[rowNum] = entry;
  }
  return out;
}

async function loadAiAnalysis(){
  // Re-fetched on every sync (not cached indefinitely) so that new analysis the
  // Apps Script pipeline writes to the live "AI Analysis" tab shows up here on
  // the next 60-second sync, same as new grievance rows do.
  const liveUrl = aiAnalysisSheetCsvUrl();
  if (liveUrl){
    try {
      const res = await fetch(liveUrl, { cache: 'no-store' });
      if (res.ok){
        const parsed = parseAiAnalysisCsv(await res.text());
        if (Object.keys(parsed).length){
          aiAnalysis = parsed;
          return aiAnalysis;
        }
      }
    } catch (e) {
      // fall through to the static file below
    }
  }

  try {
    const res = await fetch('ai-analysis.json', { cache: 'no-store' });
    aiAnalysis = res.ok ? await res.json() : {};
  } catch (e) {
    aiAnalysis = {};
  }
  return aiAnalysis;
}

function buildRecordsFromCsv(csvText){
  const allRows = parseCSV(csvText);
  const dataRows = allRows.slice(1); // drop header
  const existingByRow = {};
  DATA.records.forEach(r => { existingByRow[r.row] = r; });

  const out = [];
  dataRows.forEach((row, idx) => {
    const sheetRow = idx + 2;
    const { iso: dateISO, raw: dateRaw } = liveParseDate(liveGet(row, 'dateRaw'));
    const statusRaw = liveGet(row, 'statusRaw');
    const rec = {
      id: idx,
      row: sheetRow,
      division: liveGet(row,'division').toUpperCase(),
      mandal: liveNormMandal(liveGet(row,'mandal')),
      village: liveGet(row,'village'),
      pgrs: liveGet(row,'pgrs'),
      name: liveGet(row,'name'),
      aadhaar: liveGet(row,'aadhaar'),
      mobile: liveGet(row,'mobile'),
      subject: liveGet(row,'subject'),
      docsPetitioner: liveGet(row,'docsPetitioner'),
      remarksTahsildar: liveGet(row,'remarksTahsildar'),
      natureOfResolution: liveGet(row,'natureOfResolution'),
      remarksRDO: liveGet(row,'remarksRDO'),
      remarksJC: liveGet(row,'remarksJC'),
      rcNumber: liveGet(row,'rcNumber'),
      dateRaw, dateISO,
      statusRaw, status: liveClassifyStatus(statusRaw),
      reasonRejection: liveGet(row,'reasonRejection'),
      pendingOfficer: liveGet(row,'pendingOfficer'),
      petitionerRequestLetterUrl: '', petitionerRequestLetterLabel: '', petitionerRequestSummary: '',
      enquiryLetterUrl: '', enquiryLetterLabel: '',
      endorsementLetterUrl: '', endorsementLetterLabel: '',
      fieldEnquiryReport: '', personsAttended: '', remarksTahsildarSource: 'columnO',
    };
    if (!(rec.division || rec.mandal || rec.name || rec.pgrs || rec.subject)) return;

    // Carry forward AI-analyzed fields from the previous in-memory state (which
    // came from applyAiAnalysis — the live "AI Analysis" sheet tab if configured,
    // otherwise the bundled ai-analysis.json — see loadAiAnalysis).
    const prev = existingByRow[sheetRow];
    if (prev){
      rec.petitionerRequestLetterUrl = prev.petitionerRequestLetterUrl || '';
      rec.petitionerRequestLetterLabel = prev.petitionerRequestLetterLabel || '';
      rec.petitionerRequestSummary = prev.petitionerRequestSummary || '';
      rec.enquiryLetterUrl = prev.enquiryLetterUrl || '';
      rec.enquiryLetterLabel = prev.enquiryLetterLabel || '';
      rec.endorsementLetterUrl = prev.endorsementLetterUrl || '';
      rec.endorsementLetterLabel = prev.endorsementLetterLabel || '';
      rec.fieldEnquiryReport = prev.fieldEnquiryReport || '';
      rec.personsAttended = prev.personsAttended || '';
      if (prev.remarksTahsildarSource === 'ai'){
        rec.remarksTahsildar = prev.remarksTahsildar;
        rec.remarksTahsildarSource = 'ai';
      }
    }
    out.push(rec);
  });
  return out;
}

function applyAiAnalysis(records, analysis){
  if (!analysis) return records;
  records.forEach(r => {
    const extra = analysis[String(r.row)];
    if (!extra) return;
    Object.assign(r, extra);
  });
  return records;
}

async function attemptSync(manual){
  if (syncInProgress) return;
  syncInProgress = true;
  setSyncButtonState('checking');
  showSyncStatus(manual ? 'Checking…' : (dataReady ? '' : 'Loading…'), '');
  try {
    const res = await fetch(csvExportUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching the sheet');
    const text = await res.text();
    let records = buildRecordsFromCsv(text);
    if (!records.length) throw new Error('The sheet returned no usable rows');

    const analysis = await loadAiAnalysis();
    records = applyAiAnalysis(records, analysis);

    DATA.records = records;
    DATA.mandals = Array.from(new Set(records.map(r => r.mandal).filter(Boolean))).sort();
    DATA.divisions = Array.from(new Set(records.map(r => r.division).filter(Boolean))).sort();
    DATA.rcNumbers = Array.from(new Set(records.map(r => r.rcNumber).filter(Boolean))).sort((a,b)=> (a.length-b.length) || a.localeCompare(b));
    DATA.meta = DATA.meta || {};
    DATA.meta.syncedAt = new Date().toISOString();

    const firstLoad = !dataReady;
    dataReady = true;
    lastSyncErrorMsg = '';

    rebuildFilterOptions();
    renderDashboard();
    if (firstLoad) doLookup(); // refresh the lookup panel out of its loading state too
    updateSyncedLabel();
    lastSyncOk = true;
    setSyncButtonState('idle');
    showSyncStatus('Synced ✓', 'ok');
    setTimeout(() => showSyncStatus('', ''), 4000);
  } catch (err) {
    lastSyncOk = false;
    lastSyncErrorMsg = (err && err.message) ? err.message : 'Unknown error';
    setSyncButtonState('idle');
    showSyncStatus(manual ? 'Sync failed — will retry automatically' : 'Sync failed', 'err');
    if (!dataReady){
      // Still no data at all — re-render so the loading spinner turns into the
      // retry state instead of spinning forever.
      renderDashboard();
      doLookup();
    }
  } finally {
    syncInProgress = false;
  }
}

function showSyncStatus(text, cls){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'sync-status' + (cls ? ' ' + cls : '');
}

function rebuildFilterOptions(){
  const mSel = document.getElementById('fMandal');
  const prevMandal = mSel.value;
  mSel.innerHTML = '<option value="">All Mandals</option>';
  DATA.mandals.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = titleCase(m); mSel.appendChild(o); });
  if (DATA.mandals.includes(prevMandal)) mSel.value = prevMandal;

  const rcSel = document.getElementById('fRC');
  const prevRc = rcSel.value;
  rcSel.innerHTML = '<option value="">All Revenue Clinics</option>';
  DATA.rcNumbers.forEach(rc => { const o = document.createElement('option'); o.value = rc; o.textContent = 'Revenue Clinic #' + rc; rcSel.appendChild(o); });
  if (DATA.rcNumbers.includes(prevRc)) rcSel.value = prevRc;
}

function setSyncButtonState(state){
  const btn = document.getElementById('syncBtn');
  if (!btn) return;
  const spinning = state === 'checking';
  btn.disabled = spinning;
  btn.innerHTML = `<span class="ic${spinning ? ' spin' : ''}">&#8635;</span> Update / Sync Data`;
}

/* ---------------- Utilities ---------------- */
function escapeHtml(s){
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s){ return escapeHtml(s).replace(/'/g, '&#39;'); }
