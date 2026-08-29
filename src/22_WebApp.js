/* global HtmlService, JOBOPS_APPLICATION_STATUSES, JOBOPS_ERROR_CODES, JOBOPS_SHEET_HEADERS */
/* global JOBOPS_SHEET_NAMES, LockService, addJobOpsBusinessDays_, assertValidJobOpsScriptProperties_ */
/* global createJobOpsError_, normalizeAndValidateJobOpsConfig_, normalizeJobOpsSingleLineText_ */
/* global runJobOpsIngestion_ */
/* global openConfiguredJobOpsSpreadsheet_, readJobOpsConfig_, readJobOpsJobsForRescore_ */
/* global readJobOpsScriptProperties_ */

const JOBOPS_WEB_VISIBLE_PRIORITIES = Object.freeze(['HIGH', 'REVIEW', 'OPTIONAL']);
const JOBOPS_WEB_ACTIVE_STATUSES = Object.freeze([
  'NEW',
  'REVIEW',
  'READY',
  'APPLIED',
  'FOLLOW_UP',
  'SCREENING',
  'TECHNICAL',
  'OFFER',
]);
const JOBOPS_WEB_ARCHIVED_STATUSES = Object.freeze(['REJECTED', 'GHOSTED', 'SKIPPED']);

/**
 * Serves the private JobOps operations center.
 *
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  return HtmlService.createHtmlOutput(JOBOPS_WEB_APP_HTML)
    .setTitle('JobOps')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Returns the complete dashboard payload. LOW-priority jobs never leave the server.
 *
 * @returns {Object}
 */
function getJobOpsWebDashboard() {
  const properties = readJobOpsScriptProperties_();
  assertValidJobOpsScriptProperties_(properties);
  const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
  const targets = readJobOpsJobsForRescore_(spreadsheet);
  return buildJobOpsWebDashboard_(
    targets.map((target) => target.record),
    new Date(),
  );
}

/**
 * Runs one normal ingestion batch from the operations center.
 *
 * @returns {Object}
 */
function runJobOpsWebIngestion() {
  return runJobOpsIngestion_(false);
}

/**
 * Updates only user-owned fields from the web UI.
 *
 * @param {{jobId: string, status: string, notes: string}} input
 * @returns {Object}
 */
function updateJobOpsWebJob(input) {
  const plan = buildJobOpsWebUpdatePlan_(input);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.INGESTION_LOCK,
      'JobOps is busy. Try the update again in a few seconds.',
    );
  }

  try {
    const properties = readJobOpsScriptProperties_();
    assertValidJobOpsScriptProperties_(properties);
    const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.JOBS);
    if (!sheet) {
      throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, 'Missing Jobs sheet.');
    }

    const headers = JOBOPS_SHEET_HEADERS.Jobs;
    const rowCount = Math.max(sheet.getLastRow() - 1, 0);
    if (rowCount === 0) {
      throw createJobOpsError_(JOBOPS_ERROR_CODES.WEB_APP, 'Job not found.');
    }

    const values = sheet.getRange(2, 1, rowCount, headers.length).getValues();
    const idIndex = headers.indexOf('JOB_ID');
    const rowOffset = values.findIndex(
      (row) => normalizeJobOpsSingleLineText_(row[idIndex]) === plan.jobId,
    );
    if (rowOffset === -1) {
      throw createJobOpsError_(JOBOPS_ERROR_CODES.WEB_APP, 'Job not found.');
    }

    const rowNumber = rowOffset + 2;
    const existingRow = values[rowOffset];
    const statusColumn = headers.indexOf('STATUS') + 1;
    const notesColumn = headers.indexOf('NOTES') + 1;
    sheet.getRange(rowNumber, statusColumn).setValue(plan.status);
    sheet.getRange(rowNumber, notesColumn).setValue(plan.notes);

    if (plan.status === 'APPLIED') {
      const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
      const appliedIndex = headers.indexOf('APPLIED_DATE');
      const followUpIndex = headers.indexOf('FOLLOW_UP_DATE');
      const existingApplied = existingRow[appliedIndex];
      const existingFollowUp = existingRow[followUpIndex];
      const appliedDate = isJobOpsWebUsableDate_(existingApplied) ? null : new Date();
      const baseDate = appliedDate || new Date(existingApplied);
      const followUpDate = isJobOpsWebUsableDate_(existingFollowUp)
        ? null
        : addJobOpsBusinessDays_(baseDate, config.FOLLOW_UP_BUSINESS_DAYS);

      if (appliedDate) {
        sheet.getRange(rowNumber, appliedIndex + 1).setValue(appliedDate);
      }
      if (followUpDate) {
        sheet.getRange(rowNumber, followUpIndex + 1).setValue(followUpDate);
      }
    }

    return {
      ok: true,
      jobId: plan.jobId,
      status: plan.status,
      notes: plan.notes,
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Builds a safe dashboard projection and summary.
 *
 * @param {Object[]} records
 * @param {Date} now
 * @returns {Object}
 */
function buildJobOpsWebDashboard_(records, now) {
  const jobs = records
    .filter((record) =>
      JOBOPS_WEB_VISIBLE_PRIORITIES.includes(
        normalizeJobOpsSingleLineText_(record.PRIORITY).toUpperCase(),
      ),
    )
    .map((record) => buildJobOpsWebJobViewModel_(record, now))
    .sort(compareJobOpsWebJobs_);

  const counts = {
    total: jobs.length,
    high: jobs.filter((job) => job.priority === 'HIGH').length,
    review: jobs.filter((job) => job.priority === 'REVIEW').length,
    optional: jobs.filter((job) => job.priority === 'OPTIONAL').length,
    applied: jobs.filter((job) =>
      ['APPLIED', 'FOLLOW_UP', 'SCREENING', 'TECHNICAL', 'OFFER'].includes(job.status),
    ).length,
    followUpsDue: jobs.filter((job) => job.followUpDue).length,
  };

  return {
    generatedAt: formatJobOpsWebDateTime_(now),
    statuses: JOBOPS_APPLICATION_STATUSES.slice(),
    jobs,
    counts,
  };
}

/**
 * Converts a Jobs record to fields used by the UI.
 *
 * @param {Object} record
 * @param {Date} now
 * @returns {Object}
 */
function buildJobOpsWebJobViewModel_(record, now) {
  const status = normalizeJobOpsSingleLineText_(record.STATUS).toUpperCase() || 'NEW';
  const followUpDate = normalizeJobOpsWebDate_(record.FOLLOW_UP_DATE);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const followUpDue =
    Boolean(followUpDate) &&
    ['APPLIED', 'FOLLOW_UP'].includes(status) &&
    followUpDate.getTime() <= today.getTime();

  return {
    jobId: normalizeJobOpsSingleLineText_(record.JOB_ID),
    company: normalizeJobOpsSingleLineText_(record.COMPANY) || 'Empresa no indicada',
    position: normalizeJobOpsSingleLineText_(record.POSITION) || 'Cargo no indicado',
    location: normalizeJobOpsSingleLineText_(record.LOCATION),
    workMode: normalizeJobOpsSingleLineText_(record.WORK_MODE),
    source: normalizeJobOpsSingleLineText_(record.SOURCE),
    roleFamily: normalizeJobOpsSingleLineText_(record.ROLE_FAMILY),
    score: Number(record.MATCH_SCORE) || 0,
    priority: normalizeJobOpsSingleLineText_(record.PRIORITY).toUpperCase(),
    salary: normalizeJobOpsSingleLineText_(record.SALARY),
    experience: normalizeJobOpsSingleLineText_(record.EXPERIENCE_REQUESTED),
    technologies: normalizeJobOpsSingleLineText_(record.REQUIRED_TECHNOLOGIES),
    strongMatches: normalizeJobOpsMultilineText_(record.STRONG_MATCHES),
    riskFlags: normalizeJobOpsMultilineText_(record.RISK_FLAGS),
    jobUrl: normalizeJobOpsWebUrl_(record.JOB_URL),
    recommendedCv: normalizeJobOpsSingleLineText_(record.RECOMMENDED_CV),
    cvLink: normalizeJobOpsWebUrl_(record.CV_LINK),
    status,
    appliedDate: formatJobOpsWebDate_(normalizeJobOpsWebDate_(record.APPLIED_DATE)),
    followUpDate: formatJobOpsWebDate_(followUpDate),
    followUpDue,
    notes: normalizeJobOpsSingleLineText_(record.NOTES).slice(0, 1000),
    discoveredAt: formatJobOpsWebDateTime_(normalizeJobOpsWebDate_(record.DISCOVERED_AT)),
    archived: JOBOPS_WEB_ARCHIVED_STATUSES.includes(status),
    active: JOBOPS_WEB_ACTIVE_STATUSES.includes(status),
  };
}

/**
 * Validates a web mutation without touching Sheets.
 *
 * @param {*} input
 * @returns {{jobId: string, status: string, notes: string}}
 */
function buildJobOpsWebUpdatePlan_(input) {
  const jobId = normalizeJobOpsSingleLineText_(input && input.jobId);
  const status = normalizeJobOpsSingleLineText_(input && input.status).toUpperCase();
  const notes = normalizeJobOpsSingleLineText_(input && input.notes).slice(0, 1000);

  if (!jobId) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.WEB_APP, 'JOB_ID is required.');
  }
  if (!JOBOPS_APPLICATION_STATUSES.includes(status)) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.WEB_APP, 'Invalid application status.');
  }

  return { jobId, status, notes };
}

/**
 * Sorts priority first, then score, then discovery time.
 *
 * @param {Object} left
 * @param {Object} right
 * @returns {number}
 */
function compareJobOpsWebJobs_(left, right) {
  const priorityRank = { HIGH: 0, REVIEW: 1, OPTIONAL: 2 };
  const leftRank = priorityRank[left.priority] ?? 99;
  const rightRank = priorityRank[right.priority] ?? 99;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  return String(right.discoveredAt).localeCompare(String(left.discoveredAt));
}

/**
 * Accepts only http/https links before exposing them to the browser.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeJobOpsWebUrl_(value) {
  const text = normalizeJobOpsSingleLineText_(value);
  return /^https?:\/\//iu.test(text) ? text : '';
}

/**
 * @param {*} value
 * @returns {Date|null}
 */
function normalizeJobOpsWebDate_(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isJobOpsWebUsableDate_(value) {
  return Boolean(normalizeJobOpsWebDate_(value));
}

/**
 * @param {Date|null} date
 * @returns {string}
 */
function formatJobOpsWebDate_(date) {
  if (!date) {
    return '';
  }
  return Utilities.formatDate(date, 'America/Bogota', 'yyyy-MM-dd');
}

/**
 * @param {Date|null} date
 * @returns {string}
 */
function formatJobOpsWebDateTime_(date) {
  if (!date) {
    return '';
  }
  return Utilities.formatDate(date, 'America/Bogota', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

const JOBOPS_WEB_APP_HTML = String.raw`<!doctype html>
<html lang="es">
<head>
  <base target="_top">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <style>
    :root {
      --bg: #0a0f1a;
      --panel: #111827;
      --panel2: #172033;
      --line: #263247;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --accent: #8b5cf6;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #fb7185;
      --info: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top right, #1d1734 0, var(--bg) 38%);
      color: var(--text);
    }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    a { color: inherit; }
    .shell { max-width: 1440px; margin: 0 auto; padding: 28px; }
    header {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      margin-bottom: 22px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
      background: linear-gradient(135deg, #8b5cf6, #2563eb); font-weight: 900;
      box-shadow: 0 12px 30px rgba(139,92,246,.28);
    }
    h1 { margin: 0; font-size: 21px; letter-spacing: -.02em; }
    .subtitle { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      border: 1px solid var(--line); background: #151d2c; color: var(--text);
      border-radius: 10px; padding: 9px 12px; font-weight: 700;
    }
    .btn:hover { border-color: #475569; }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
    .btn.link { text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .btn:disabled { opacity: .5; cursor: wait; }
    .stats {
      display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px;
    }
    .stat {
      background: rgba(17,24,39,.82); border: 1px solid var(--line); border-radius: 14px;
      padding: 14px 15px; min-height: 78px;
    }
    .stat .n { font-size: 25px; font-weight: 850; letter-spacing: -.03em; }
    .stat .l { color: var(--muted); font-size: 12px; }
    .toolbar {
      background: rgba(17,24,39,.82); border: 1px solid var(--line); border-radius: 14px;
      padding: 12px; display: grid; grid-template-columns: 1fr auto auto; gap: 10px; margin-bottom: 16px;
    }
    input, select, textarea {
      width: 100%; background: #0d1421; color: var(--text); border: 1px solid var(--line);
      border-radius: 9px; padding: 9px 10px; outline: none;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--accent); }
    .tabs { display: flex; gap: 6px; }
    .tab {
      border: 1px solid var(--line); background: transparent; color: var(--muted);
      border-radius: 9px; padding: 8px 10px; font-weight: 700;
    }
    .tab.active { background: #202a3c; color: var(--text); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
    .card {
      background: rgba(17,24,39,.94); border: 1px solid var(--line); border-radius: 16px;
      padding: 16px; min-width: 0;
    }
    .card:hover { border-color: #3a4861; }
    .card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .title { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
    .company { color: #cbd5e1; font-weight: 650; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 7px; display: flex; gap: 8px; flex-wrap: wrap; }
    .score { font-size: 22px; font-weight: 900; }
    .badge {
      display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px;
      font-size: 11px; font-weight: 800; border: 1px solid transparent;
    }
    .HIGH { color: #6ee7b7; background: rgba(16,185,129,.12); border-color: rgba(52,211,153,.3); }
    .REVIEW { color: #93c5fd; background: rgba(59,130,246,.12); border-color: rgba(96,165,250,.3); }
    .OPTIONAL { color: #fde68a; background: rgba(245,158,11,.12); border-color: rgba(251,191,36,.3); }
    .due { color: #fecdd3; background: rgba(244,63,94,.12); border-color: rgba(251,113,133,.3); }
    .details {
      margin: 13px 0; padding: 11px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; font-size: 12px;
    }
    .details b { color: #cbd5e1; }
    .details span { color: var(--muted); overflow-wrap: anywhere; }
    .signals { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 12px; }
    .signal {
      border-radius: 7px; background: #0d1421; color: #cbd5e1; padding: 5px 7px;
      font-size: 11px; border: 1px solid #202b3e;
    }
    .signal.risk { color: #fda4af; }
    .card-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 9px; }
    .edit { display: grid; grid-template-columns: 145px 1fr auto; gap: 8px; align-items: start; }
    textarea { resize: vertical; min-height: 40px; max-height: 110px; }
    .empty {
      border: 1px dashed #344158; border-radius: 16px; padding: 48px 20px; color: var(--muted);
      text-align: center; grid-column: 1 / -1;
    }
    .toast {
      position: fixed; right: 22px; bottom: 22px; background: #111827; border: 1px solid var(--line);
      border-radius: 12px; padding: 12px 14px; box-shadow: 0 18px 45px rgba(0,0,0,.35);
      opacity: 0; transform: translateY(10px); pointer-events: none; transition: .18s;
      max-width: 420px;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.error { border-color: rgba(251,113,133,.55); }
    .loading { opacity: .55; pointer-events: none; }
    @media (max-width: 1000px) {
      .stats { grid-template-columns: repeat(3, 1fr); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 680px) {
      .shell { padding: 16px; }
      header { align-items: flex-start; flex-direction: column; }
      .stats { grid-template-columns: repeat(2, 1fr); }
      .toolbar { grid-template-columns: 1fr; }
      .tabs { overflow-x: auto; }
      .edit { grid-template-columns: 1fr; }
      .card-actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand">
        <div class="logo">J</div>
        <div>
          <h1>JobOps</h1>
          <div class="subtitle">Centro de operación · solo HIGH / REVIEW / OPTIONAL</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn" id="refreshBtn">Actualizar</button>
        <button class="btn primary" id="ingestBtn">Procesar alertas</button>
      </div>
    </header>

    <section class="stats" id="stats"></section>

    <section class="toolbar">
      <input id="search" type="search" placeholder="Buscar cargo, empresa, tecnología...">
      <div class="tabs" id="tabs">
        <button class="tab active" data-view="queue">Por revisar</button>
        <button class="tab" data-view="applied">Aplicadas</button>
        <button class="tab" data-view="all">Todas</button>
        <button class="tab" data-view="archived">Archivadas</button>
      </div>
      <select id="priorityFilter">
        <option value="">Todas las prioridades</option>
        <option value="HIGH">HIGH</option>
        <option value="REVIEW">REVIEW</option>
        <option value="OPTIONAL">OPTIONAL</option>
      </select>
    </section>

    <main class="grid" id="jobs"></main>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    var state = { payload: null, view: 'queue', query: '', priority: '' };

    function callServer(name, arg) {
      return new Promise(function(resolve, reject) {
        var runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
        if (typeof arg === 'undefined') runner[name]();
        else runner[name](arg);
      });
    }

    function setBusy(value) {
      document.body.classList.toggle('loading', value);
      document.getElementById('ingestBtn').disabled = value;
      document.getElementById('refreshBtn').disabled = value;
    }

    function showToast(message, isError) {
      var toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(function(){ toast.className = 'toast'; }, 3600);
    }

    function stat(label, value) {
      var el = document.createElement('div');
      el.className = 'stat';
      var n = document.createElement('div'); n.className = 'n'; n.textContent = value;
      var l = document.createElement('div'); l.className = 'l'; l.textContent = label;
      el.appendChild(n); el.appendChild(l); return el;
    }

    function renderStats() {
      var c = state.payload.counts;
      var root = document.getElementById('stats'); root.replaceChildren();
      [['Visibles',c.total],['HIGH',c.high],['REVIEW',c.review],['OPTIONAL',c.optional],
       ['Aplicadas',c.applied],['Follow-ups vencidos',c.followUpsDue]].forEach(function(x){
        root.appendChild(stat(x[0], x[1]));
      });
    }

    function matchesView(job) {
      if (state.view === 'queue') return ['NEW','REVIEW','READY'].indexOf(job.status) >= 0;
      if (state.view === 'applied') return ['APPLIED','FOLLOW_UP','SCREENING','TECHNICAL','OFFER'].indexOf(job.status) >= 0;
      if (state.view === 'archived') return job.archived;
      return true;
    }

    function matchesSearch(job) {
      var q = state.query.toLowerCase();
      if (!q) return true;
      return [job.position,job.company,job.technologies,job.roleFamily,job.location]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    }

    function detail(label, value) {
      if (!value) return null;
      var wrap = document.createElement('div');
      var b = document.createElement('b'); b.textContent = label + ': ';
      var span = document.createElement('span'); span.textContent = value;
      wrap.appendChild(b); wrap.appendChild(span); return wrap;
    }

    function signal(text, risk) {
      var el = document.createElement('span');
      el.className = 'signal' + (risk ? ' risk' : '');
      el.textContent = text; return el;
    }

    function linkButton(text, url) {
      var a = document.createElement('a');
      a.className = 'btn link'; a.textContent = text;
      if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      else { a.removeAttribute('href'); a.style.opacity = '.45'; }
      return a;
    }

    function renderCard(job) {
      var card = document.createElement('article'); card.className = 'card';
      var top = document.createElement('div'); top.className = 'card-top';
      var left = document.createElement('div');
      var title = document.createElement('div'); title.className = 'title'; title.textContent = job.position;
      var company = document.createElement('div'); company.className = 'company'; company.textContent = job.company;
      var meta = document.createElement('div'); meta.className = 'meta';
      [job.location,job.workMode,job.source,job.roleFamily].filter(Boolean).forEach(function(x){
        var s=document.createElement('span'); s.textContent=x; meta.appendChild(s);
      });
      left.append(title, company, meta);
      var scoreWrap = document.createElement('div'); scoreWrap.style.textAlign='right';
      var score = document.createElement('div'); score.className='score'; score.textContent=job.score;
      var badge = document.createElement('span'); badge.className='badge '+job.priority; badge.textContent=job.priority;
      scoreWrap.append(score,badge);
      if(job.followUpDue){ var due=document.createElement('div'); due.className='badge due'; due.style.marginTop='6px'; due.textContent='FOLLOW-UP'; scoreWrap.appendChild(due); }
      top.append(left,scoreWrap); card.appendChild(top);

      var details=document.createElement('div'); details.className='details';
      [['Salario',job.salary],['Experiencia',job.experience],['CV',job.recommendedCv],['Seguimiento',job.followUpDate]]
        .forEach(function(x){ var d=detail(x[0],x[1]); if(d) details.appendChild(d); });
      card.appendChild(details);

      var signals=document.createElement('div'); signals.className='signals';
      String(job.strongMatches||'').split(/\n+/).filter(Boolean).slice(0,4).forEach(function(x){signals.appendChild(signal(x,false));});
      String(job.riskFlags||'').split(/\n+/).filter(Boolean).slice(0,3).forEach(function(x){signals.appendChild(signal(x,true));});
      if(job.technologies){ signals.appendChild(signal(job.technologies,false)); }
      card.appendChild(signals);

      var actions=document.createElement('div'); actions.className='card-actions';
      actions.append(linkButton('Abrir vacante',job.jobUrl),linkButton('Abrir CV recomendado',job.cvLink));
      card.appendChild(actions);

      var edit=document.createElement('div'); edit.className='edit';
      var select=document.createElement('select');
      state.payload.statuses.forEach(function(status){
        var opt=document.createElement('option'); opt.value=status; opt.textContent=status; opt.selected=status===job.status; select.appendChild(opt);
      });
      var notes=document.createElement('textarea'); notes.placeholder='Notas'; notes.value=job.notes||'';
      var save=document.createElement('button'); save.className='btn'; save.textContent='Guardar';
      save.addEventListener('click', async function(){
        save.disabled=true; save.textContent='Guardando...';
        try {
          await callServer('updateJobOpsWebJob',{jobId:job.jobId,status:select.value,notes:notes.value});
          showToast('Actualizado');
          await loadDashboard(false);
        } catch(error) {
          showToast((error && error.message) || 'No se pudo actualizar', true);
        } finally { save.disabled=false; save.textContent='Guardar'; }
      });
      edit.append(select,notes,save); card.appendChild(edit);
      return card;
    }

    function renderJobs() {
      var root=document.getElementById('jobs'); root.replaceChildren();
      var jobs=state.payload.jobs.filter(function(job){
        return matchesView(job) && matchesSearch(job) && (!state.priority || job.priority===state.priority);
      });
      if(!jobs.length){ var empty=document.createElement('div'); empty.className='empty'; empty.textContent='No hay vacantes en esta vista.'; root.appendChild(empty); return; }
      jobs.forEach(function(job){ root.appendChild(renderCard(job)); });
    }

    function render() { renderStats(); renderJobs(); }

    async function loadDashboard(showBusy) {
      if (showBusy !== false) setBusy(true);
      try { state.payload=await callServer('getJobOpsWebDashboard'); render(); }
      catch(error){ showToast((error && error.message)||'No se pudo cargar JobOps',true); }
      finally { if (showBusy !== false) setBusy(false); }
    }

    document.getElementById('refreshBtn').addEventListener('click', function(){ loadDashboard(true); });
    document.getElementById('ingestBtn').addEventListener('click', async function(){
      setBusy(true);
      try {
        var result=await callServer('runJobOpsWebIngestion');
        showToast('Ingesta: '+result.createdJobs+' nuevas, '+result.duplicates+' duplicadas, '+result.parsingErrors+' errores');
        await loadDashboard(false);
      } catch(error){ showToast((error && error.message)||'Falló la ingesta',true); }
      finally { setBusy(false); }
    });
    document.getElementById('search').addEventListener('input',function(e){state.query=e.target.value;renderJobs();});
    document.getElementById('priorityFilter').addEventListener('change',function(e){state.priority=e.target.value;renderJobs();});
    document.getElementById('tabs').addEventListener('click',function(e){
      var button=e.target.closest('[data-view]'); if(!button)return;
      state.view=button.dataset.view;
      document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x===button);});
      renderJobs();
    });

    loadDashboard(true);
  </script>
</body>
</html>`;
