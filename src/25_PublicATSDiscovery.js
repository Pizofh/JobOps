/* global LockService, PropertiesService, SpreadsheetApp, UrlFetchApp */
/* global JOBOPS_ERROR_CODES, JOBOPS_FIT_VERSION, JOBOPS_PARSER_VERSION */
/* global JOBOPS_SHEET_NAMES, appendJobOpsJobRecords_, assertValidJobOpsScriptProperties_ */
/* global buildJobOpsJobRecord_, canonicalizeJobOpsUrl_, createJobOpsError_ */
/* global createJobOpsEvaluationContext_, detectJobOpsWorkMode_, ensureJobOpsFitSchema_ */
/* global ensureJobOpsHeaders_, ensureJobOpsSheetSize_, evaluateJobOpsJob_ */
/* global extractJobOpsExperience_, extractJobOpsSalary_, extractJobOpsTechnologies_ */
/* global findJobOpsDuplicateMatch_, getJobOpsRequiredHeaderIndexes_ */
/* global jobOpsHtmlToText_, normalizeAndValidateJobOpsConfig_ */
/* global normalizeJobOpsSingleLineText_, openConfiguredJobOpsSpreadsheet_ */
/* global readJobOpsConfig_, readJobOpsDeduplicationIndex_, readJobOpsScriptProperties_ */
/* global registerJobOpsCandidate_ */
/* exported setupPublicAtsBoards, dryRunPublicAtsDiscovery, ingestPublicAtsJobs, dryRunJobDiscovery, ingestDiscoveredJobs */

const JOBOPS_PUBLIC_ATS_SHEET = 'PublicBoards';
const JOBOPS_PUBLIC_ATS_HEADERS = Object.freeze(['ATS', 'BOARD', 'COMPANY', 'ENABLED']);
const JOBOPS_PUBLIC_ATS_MAX_BOARDS = 10;
const JOBOPS_PUBLIC_ATS_MAX_POSTINGS_PER_BOARD = 250;
const JOBOPS_HIMALAYAS_QUERIES = Object.freeze([
  // Roles objetivo: arquitectura, automatización e infraestructura cloud.
  'devops',
  'platform engineer',
  'cloud engineer',
  'site reliability',
  'infrastructure engineer',
  // Roles puente que aprovechan Linux, troubleshooting, soporte L2/L3 y CI/CD.
  'cloud support engineer',
  'linux engineer',
  'release engineer',
  'ci/cd engineer',
  'application support',
  'production support',
  'systems engineer',
  'automation engineer',
  'backend engineer',
]);
const JOBOPS_PUBLIC_ATS_TITLE_PATTERN =
  /\b(?:devops|devsecops|platform|sre|site reliability|cloud|infrastructure|infraestructura|linux|sysadmin|systems engineer|system administrator|automation engineer|release engineer|build engineer|deployment engineer|ci\/cd engineer|technical operations|production support|application support|backend engineer|backend developer)\b/iu;

/**
 * Creates a separate, editable list of public ATS boards. No providers are
 * enabled automatically, and existing sheet contents are preserved.
 */
function setupPublicAtsBoards() {
  const properties = readJobOpsScriptProperties_();
  assertValidJobOpsScriptProperties_(properties);
  const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
  const existing = spreadsheet.getSheetByName(JOBOPS_PUBLIC_ATS_SHEET);
  const sheet = existing || spreadsheet.insertSheet(JOBOPS_PUBLIC_ATS_SHEET);
  ensureJobOpsSheetSize_(sheet, 2, JOBOPS_PUBLIC_ATS_HEADERS.length);
  ensureJobOpsHeaders_(sheet, JOBOPS_PUBLIC_ATS_HEADERS);
  return { ok: true, created: !existing, sheet: JOBOPS_PUBLIC_ATS_SHEET };
}

/** Runs discovery without writing to Sheets, Gmail or external platforms. */
function dryRunPublicAtsDiscovery() {
  return runJobOpsPublicAtsDiscovery_(true);
}

/** Imports public company ATS postings without applying to any vacancy. */
function ingestPublicAtsJobs() {
  return runJobOpsPublicAtsDiscovery_(false);
}

/** Default: discovers jobs from multiple employers with no manual company list. */
function dryRunJobDiscovery() {
  const result = runJobOpsPublicAtsDiscovery_(true);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Imports discovered jobs; keeps the separate ATS company list optional. */
function ingestDiscoveredJobs() {
  return runJobOpsPublicAtsDiscovery_(false);
}

/**
 * Uses only provider-documented public GET APIs, with a hard cap of ten boards
 * and no retries on rate limits. Production deployment remains manual.
 */
function runJobOpsPublicAtsDiscovery_(forceDryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.INGESTION_LOCK, 'JobOps is already running.');
  }

  try {
    const properties = readJobOpsScriptProperties_();
    assertValidJobOpsScriptProperties_(properties);
    const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
    ensureJobOpsFitSchema_(spreadsheet);
    const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
    const dryRun = Boolean(forceDryRun || config.DRY_RUN);
    // PublicBoards is optional. Himalayas discovers companies automatically.
    const boardSheet = spreadsheet.getSheetByName(JOBOPS_PUBLIC_ATS_SHEET);
    const boards = boardSheet
      ? parseJobOpsPublicAtsBoards_(boardSheet.getDataRange().getValues())
      : [];
    const context = createJobOpsEvaluationContext_(spreadsheet, config);
    const index = readJobOpsDeduplicationIndex_(spreadsheet);
    const newRecords = [];
    const errors = [];
    let fetchedJobs = 0;
    let relevantJobs = 0;
    let duplicates = 0;
    let checkedBoards = 0;

    // Search directly across employers. Country=CO also includes worldwide
    // remote listings according to the public Himalayas API.
    const batches = [];
    let checkedQueries = 0;
    let stoppedOnRateLimit = false;
    for (const query of JOBOPS_HIMALAYAS_QUERIES) {
      try {
        const jobs = fetchJobOpsHimalayasJobs_(query);
        checkedQueries += 1;
        batches.push({ kind: 'HIMALAYAS', postings: jobs });
      } catch (error) {
        errors.push({
          board: 'Himalayas: ' + query,
          ats: 'HIMALAYAS',
          error: String(error.message).slice(0, 140),
        });
        if (error.rateLimited) {
          stoppedOnRateLimit = true;
          break;
        }
      }
    }

    // Optional ATS company-specific queries enhance, but never gate discovery.
    if (!stoppedOnRateLimit) {
      for (const board of boards) {
        try {
          const jobs = fetchJobOpsPublicAtsPostings_(board);
          checkedBoards += 1;
          batches.push({ kind: 'ATS', board, postings: jobs });
        } catch (error) {
          errors.push({
            board: board.company,
            ats: board.ats,
            error: String(error.message).slice(0, 140),
          });
          if (error.rateLimited) {
            stoppedOnRateLimit = true;
            break;
          }
        }
      }
    }

    for (const batch of batches) {
      for (const raw of batch.postings.slice(0, JOBOPS_PUBLIC_ATS_MAX_POSTINGS_PER_BOARD)) {
        fetchedJobs += 1;
        const parsed =
          batch.kind === 'HIMALAYAS'
            ? normalizeJobOpsHimalayasPosting_(raw)
            : normalizeJobOpsPublicAtsPosting_(batch.board, raw);
        if (!parsed || !JOBOPS_PUBLIC_ATS_TITLE_PATTERN.test(parsed.position)) {
          continue;
        }
        relevantJobs += 1;
        const input = {
          messageId:
            'PUBLIC_DISCOVERY:' + parsed.source + ':' + (parsed.sourceJobId || parsed.jobUrl),
          threadId: '',
          date: new Date(),
        };
        const record = buildJobOpsJobRecord_(input, parsed, config);
        Object.assign(record, evaluateJobOpsJob_(parsed, context));
        record.GMAIL_MESSAGE_ID = '';
        record.GMAIL_THREAD_ID = '';
        record.NOTES =
          batch.kind === 'HIMALAYAS'
            ? 'Fuente: Himalayas. Verificar zona horaria, salario y requisitos antes de aplicar.'
            : 'ATS público: comprobar elegibilidad para trabajar desde Colombia.';
        record.FIT_LEVEL = 'UNKNOWN';
        record.FIT_ADJUSTMENT = 0;
        record.FINAL_SCORE = record.MATCH_SCORE;
        record.FIT_REASONS = 'Requisitos específicos pendientes de revisión manual.';
        record.FIT_PROVIDER = 'PUBLIC_DISCOVERY';
        record.FIT_VERSION = JOBOPS_FIT_VERSION;
        record.FIT_ASSESSED_AT = new Date();

        const candidate = {
          source: parsed.source,
          sourceJobId: parsed.sourceJobId,
          jobUrl: parsed.jobUrl,
          deduplicationKey: record.DEDUPLICATION_KEY,
          messageId: '',
        };
        if (findJobOpsDuplicateMatch_(candidate, index)) {
          duplicates += 1;
          continue;
        }
        registerJobOpsCandidate_(candidate, index, { kind: 'pending', record });
        newRecords.push(record);
      }
    }

    if (!dryRun && newRecords.length > 0) {
      appendJobOpsJobRecords_(spreadsheet, newRecords);
    }
    return {
      ok: errors.length === 0,
      dryRun,
      configuredBoards: boards.length,
      checkedBoards,
      checkedQueries,
      stoppedOnRateLimit,
      fetchedJobs,
      relevantJobs,
      duplicates,
      createdJobs: dryRun ? 0 : newRecords.length,
      wouldCreateJobs: dryRun ? newRecords.length : 0,
      errors,
    };
  } finally {
    lock.releaseLock();
  }
}

/** Free public remote-jobs search: multi-employer discovery without login or scraping. */
function buildJobOpsHimalayasSearchUrl_(query) {
  if (!JOBOPS_HIMALAYAS_QUERIES.includes(query)) {
    throw new Error('Unsupported discovery query.');
  }
  return (
    'https://himalayas.app/jobs/api/search?q=' +
    encodeURIComponent(query) +
    '&country=CO&sort=recent&page=1'
  );
}

/** One request per fixed query, no pagination loops or retries on 429. */
function fetchJobOpsHimalayasJobs_(query, fetcher) {
  const fetch = fetcher || ((url, options) => UrlFetchApp.fetch(url, options));
  const response = fetch(buildJobOpsHimalayasSearchUrl_(query), {
    method: 'get',
    headers: { Accept: 'application/json' },
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const status = response.getResponseCode();
  if (status === 429) {
    const error = new Error('Himalayas HTTP 429. Discovery stopped.');
    error.rateLimited = true;
    throw error;
  }
  if (status !== 200) {
    throw new Error('Himalayas returned HTTP ' + status);
  }
  const payload = JSON.parse(response.getContentText());
  if (!payload || !Array.isArray(payload.jobs)) {
    throw new Error('Unexpected Himalayas response format.');
  }
  return payload.jobs;
}

/** Keeps Himalayas attribution and its original applicationLink intact. */
function normalizeJobOpsHimalayasPosting_(posting) {
  if (!posting || !posting.guid) {
    return null;
  }
  const position = normalizeJobOpsSingleLineText_(posting.title);
  const company = normalizeJobOpsSingleLineText_(posting.companyName);
  const url = canonicalizeJobOpsUrl_(posting.applicationLink);
  if (!position || !company || !/^https:\/\//iu.test(url)) {
    return null;
  }

  if (posting.expiryDate && Number(posting.expiryDate) <= Date.now() / 1000) {
    return null;
  }
  const restrictions = Array.isArray(posting.locationRestrictions)
    ? posting.locationRestrictions.map(normalizeJobOpsSingleLineText_).filter(Boolean)
    : [];
  const description = jobOpsHtmlToText_(posting.description || posting.excerpt || '').slice(
    0,
    20000,
  );
  const currency = normalizeJobOpsSingleLineText_(posting.currency);
  const salaryPeriod = normalizeJobOpsSingleLineText_(posting.salaryPeriod || 'annual');
  const minimum = Number(posting.minSalary);
  const maximum = Number(posting.maxSalary);
  const salaryParts = [];
  if (currency && Number.isFinite(minimum) && minimum > 0) {
    salaryParts.push(minimum);
  }
  if (currency && Number.isFinite(maximum) && maximum > 0 && maximum !== minimum) {
    salaryParts.push(maximum);
  }

  return {
    detection: { isRecruiter: false },
    source: 'Himalayas',
    sourceJobId: normalizeJobOpsSingleLineText_(posting.guid),
    company,
    position,
    location: restrictions.length ? 'Remote: ' + restrictions.join(', ') : 'Remote: Worldwide',
    workMode: 'REMOTE',
    jobUrl: url,
    salary: salaryParts.length
      ? currency + ' ' + salaryParts.join(' - ') + ' / ' + salaryPeriod
      : '',
    experienceRequested:
      normalizeJobOpsSingleLineText_(posting.seniority) || extractJobOpsExperience_(description),
    requiredTechnologies: extractJobOpsTechnologies_(position + '\n' + description),
    descriptionText: description,
    recruiterName: '',
    recruiterEmail: '',
    parserName: 'parseHimalayas',
    parserVersion: JOBOPS_PARSER_VERSION,
    warnings: [],
  };
}

/** Validates user-editable boards; never accepts arbitrary URLs or hostnames. */
function parseJobOpsPublicAtsBoards_(values) {
  const indexes = getJobOpsRequiredHeaderIndexes_(values, JOBOPS_PUBLIC_ATS_HEADERS);
  const enabled = [];
  for (const row of values.slice(1)) {
    if (row[indexes.ENABLED] !== true && String(row[indexes.ENABLED]).toLowerCase() !== 'true') {
      continue;
    }
    const ats = normalizeJobOpsSingleLineText_(row[indexes.ATS]).toUpperCase();
    const board = normalizeJobOpsSingleLineText_(row[indexes.BOARD]);
    const company = normalizeJobOpsSingleLineText_(row[indexes.COMPANY]);
    if (
      !['GREENHOUSE', 'LEVER', 'LEVER_EU', 'ASHBY'].includes(ats) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(board) ||
      !company
    ) {
      throw createJobOpsError_(
        JOBOPS_ERROR_CODES.CONFIGURATION,
        'PublicBoards has an enabled row with an invalid ATS, board slug or company.',
      );
    }
    enabled.push({ ats, board, company });
  }
  if (enabled.length > JOBOPS_PUBLIC_ATS_MAX_BOARDS) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      'Enable at most ' + JOBOPS_PUBLIC_ATS_MAX_BOARDS + ' public boards per run.',
    );
  }
  return enabled;
}

function buildJobOpsPublicAtsUrl_(board) {
  const slug = encodeURIComponent(board.board);
  switch (board.ats) {
    case 'GREENHOUSE':
      return 'https://boards-api.greenhouse.io/v1/boards/' + slug + '/jobs?content=true';
    case 'LEVER':
      return 'https://api.lever.co/v0/postings/' + slug + '?mode=json&limit=250';
    case 'LEVER_EU':
      return 'https://api.eu.lever.co/v0/postings/' + slug + '?mode=json&limit=250';
    case 'ASHBY':
      return 'https://api.ashbyhq.com/posting-api/job-board/' + slug + '?includeCompensation=true';
    default:
      throw new Error('Unsupported public ATS.');
  }
}

/** Fetch once per board, with no login, browser simulation or 429 retries. */
function fetchJobOpsPublicAtsPostings_(board, fetcher) {
  const fetch = fetcher || ((url, options) => UrlFetchApp.fetch(url, options));
  const response = fetch(buildJobOpsPublicAtsUrl_(board), {
    method: 'get',
    headers: { Accept: 'application/json' },
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const status = response.getResponseCode();
  if (status === 429) {
    const error = new Error('HTTP 429. Requests stopped; retry manually on another day.');
    error.rateLimited = true;
    throw error;
  }
  if (status !== 200) {
    throw new Error('ATS returned HTTP ' + status);
  }
  const data = JSON.parse(response.getContentText());
  const jobs = board.ats === 'LEVER' || board.ats === 'LEVER_EU' ? data : data.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error('Unexpected ATS response format.');
  }
  return jobs;
}

function normalizeJobOpsPublicAtsPosting_(board, posting) {
  if (!posting || (board.ats === 'ASHBY' && posting.isListed === false)) {
    return null;
  }
  const greenhouse = board.ats === 'GREENHOUSE';
  const lever = board.ats === 'LEVER' || board.ats === 'LEVER_EU';
  const title = normalizeJobOpsSingleLineText_(lever ? posting.text : posting.title);
  const url = canonicalizeJobOpsUrl_(
    greenhouse ? posting.absolute_url : lever ? posting.hostedUrl : posting.jobUrl,
  );
  if (!title || !/^https:\/\//iu.test(url)) {
    return null;
  }
  const sourceId = normalizeJobOpsSingleLineText_(posting.id || url.split('/').pop());
  const description = (
    greenhouse
      ? jobOpsHtmlToText_(posting.content || '')
      : lever
        ? posting.descriptionPlain || jobOpsHtmlToText_(posting.description || '')
        : posting.descriptionPlain || jobOpsHtmlToText_(posting.descriptionHtml || '')
  ).slice(0, 20000);
  const location = normalizeJobOpsSingleLineText_(
    greenhouse
      ? posting.location && posting.location.name
      : lever
        ? posting.categories && posting.categories.location
        : posting.location,
  );
  const workplace = normalizeJobOpsSingleLineText_(
    lever || !greenhouse ? posting.workplaceType : '',
  );
  let workMode = detectJobOpsWorkMode_([workplace, location, title, description].join('\n'));
  if (!greenhouse && posting.isRemote === true) {
    workMode = 'REMOTE';
  }
  const salaryRange = lever ? posting.salaryRange : null;
  const rangeText =
    salaryRange &&
    salaryRange.min !== null &&
    salaryRange.min !== undefined &&
    salaryRange.max !== null &&
    salaryRange.max !== undefined
      ? [salaryRange.currency, salaryRange.min, '-', salaryRange.max, salaryRange.interval].join(
          ' ',
        )
      : '';
  const compensation = posting.compensation || {};
  const salary = normalizeJobOpsSingleLineText_(
    greenhouse
      ? extractJobOpsSalary_(description)
      : lever
        ? rangeText || extractJobOpsSalary_(description)
        : compensation.scrapeableCompensationSalarySummary ||
          compensation.compensationTierSummary ||
          extractJobOpsSalary_(description),
  );
  return {
    detection: { isRecruiter: false },
    source: board.ats + ':' + board.board,
    sourceJobId: board.board + ':' + sourceId,
    company: board.company,
    position: title,
    location,
    workMode,
    jobUrl: url,
    salary,
    experienceRequested: extractJobOpsExperience_(description),
    requiredTechnologies: extractJobOpsTechnologies_(title + '\n' + description),
    descriptionText: description,
    recruiterName: '',
    recruiterEmail: '',
    parserName: 'parsePublicAts',
    parserVersion: JOBOPS_PARSER_VERSION,
    warnings: [],
  };
}
