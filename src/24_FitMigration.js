/* global GmailApp, JOBOPS_FIT_VERSION, JOBOPS_SHEET_HEADERS, JOBOPS_SHEET_NAMES */
/* global JOBOPS_WEB_VISIBLE_PRIORITIES, createJobOpsGmailEnvelope_, createJobOpsEvaluationContext_ */
/* global normalizeAndValidateJobOpsConfig_, openConfiguredJobOpsSpreadsheet_ */
/* global parseJobOpsMessageBatch_, readJobOpsConfig_, readJobOpsJobsForRescore_ */
/* global readJobOpsRoleFamilies_, readJobOpsScriptProperties_, readJobOpsSourceDefinitions_ */
/* global updateJobOpsJobEvaluationFields_, ensureJobOpsSheetSize_, ensureJobOpsHeaders_ */

const JOBOPS_FIT_MIGRATION_MESSAGES_PER_RUN = 2;

/**
 * Adds only the new trailing Jobs columns. Safe to call repeatedly and much
 * cheaper than rebuilding the spreadsheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {number}
 */
function ensureJobOpsFitSchema_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.JOBS);
  if (!sheet) {
    return 0;
  }
  ensureJobOpsSheetSize_(sheet, 2, JOBOPS_SHEET_HEADERS.Jobs.length);
  return ensureJobOpsHeaders_(sheet, JOBOPS_SHEET_HEADERS.Jobs);
}

/**
 * Re-assesses existing visible jobs by re-reading their original Gmail message.
 * It never creates Jobs rows or changes Gmail labels/manual application fields.
 *
 * @returns {Object}
 */
function runJobOpsFitMigration_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.INGESTION_LOCK,
      'Another JobOps process is already running.',
    );
  }

  try {
    const properties = readJobOpsScriptProperties_();
    assertValidJobOpsScriptProperties_(properties);
    const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
    ensureJobOpsFitSchema_(spreadsheet);

    const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
    const evaluationContext = createJobOpsEvaluationContext_(spreadsheet, config);
    const sourceDefinitions = readJobOpsSourceDefinitions_(spreadsheet);
    const targets = readJobOpsJobsForRescore_(spreadsheet);
    const pending = targets.filter((target) => isJobOpsFitMigrationCandidate_(target.record));

    const groups = groupJobOpsFitTargetsByMessage_(pending).slice(
      0,
      JOBOPS_FIT_MIGRATION_MESSAGES_PER_RUN,
    );
    const updates = [];
    let assessedJobs = 0;
    let failedMessages = 0;

    for (const group of groups) {
      try {
        const message = GmailApp.getMessageById(group.messageId);
        if (!message) {
          throw new Error('Original Gmail message is unavailable.');
        }
        const thread = message.getThread();
        const envelope = createJobOpsGmailEnvelope_(message, thread);
        const parsedJobs = parseJobOpsMessageBatch_(
          envelope.input,
          sourceDefinitions,
          evaluationContext.roleFamilies,
        );

        for (const target of group.targets) {
          const parsed = findJobOpsFitParsedMatch_(target.record, parsedJobs);
          if (!parsed) {
            Object.assign(target.record, buildJobOpsUnavailableFitRecord_(target.record, config));
          } else {
            const evaluation = evaluateJobOpsJob_(
              { ...parsed, isRecruiter: parsed.detection && parsed.detection.isRecruiter },
              evaluationContext,
            );
            Object.assign(target.record, evaluation);
          }
          updates.push(target);
          assessedJobs += 1;
        }
      } catch {
        failedMessages += 1;
        for (const target of group.targets) {
          Object.assign(target.record, buildJobOpsUnavailableFitRecord_(target.record, config));
          updates.push(target);
          assessedJobs += 1;
        }
      }
    }

    updateJobOpsJobEvaluationFields_(spreadsheet, updates);
    const remaining = Math.max(0, pending.length - assessedJobs);
    return {
      ok: true,
      assessedJobs,
      processedMessages: groups.length,
      failedMessages,
      remainingJobs: remaining,
      done: remaining === 0,
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Chooses only jobs worth presenting in the operations center and skips rows
 * already assessed with the current deterministic version.
 *
 * @param {Object<string, *>} record
 * @returns {boolean}
 */
function isJobOpsFitMigrationCandidate_(record) {
  const priority = normalizeJobOpsSingleLineText_(record.PRIORITY).toUpperCase();
  const status = normalizeJobOpsSingleLineText_(record.STATUS).toUpperCase();
  const version = normalizeJobOpsSingleLineText_(record.FIT_VERSION);
  return (
    ['HIGH', 'REVIEW', 'OPTIONAL'].includes(priority) &&
    !['REJECTED', 'GHOSTED', 'SKIPPED'].includes(status) &&
    version !== JOBOPS_FIT_VERSION
  );
}

/**
 * Groups rows from one alert so a multi-job email costs only one AI request.
 *
 * @param {{rowNumber: number, record: Object<string, *>}[]} targets
 * @returns {{messageId: string, targets: Object[]}[]}
 */
function groupJobOpsFitTargetsByMessage_(targets) {
  const groups = new Map();
  const withoutMessage = [];

  for (const target of targets) {
    const messageId = normalizeJobOpsSingleLineText_(target.record.GMAIL_MESSAGE_ID);
    if (!messageId) {
      withoutMessage.push({
        messageId: `MISSING_${target.rowNumber}`,
        targets: [target],
      });
      continue;
    }
    if (!groups.has(messageId)) {
      groups.set(messageId, { messageId, targets: [] });
    }
    groups.get(messageId).targets.push(target);
  }

  return Array.from(groups.values()).concat(withoutMessage);
}

/**
 * Matches one stored row to a vacancy freshly extracted from the same email.
 *
 * @param {Object<string, *>} record
 * @param {Object[]} parsedJobs
 * @returns {Object|null}
 */
function findJobOpsFitParsedMatch_(record, parsedJobs) {
  const sourceJobId = normalizeJobOpsSingleLineText_(record.SOURCE_JOB_ID);
  if (sourceJobId) {
    const byId = parsedJobs.find(
      (job) => normalizeJobOpsSingleLineText_(job.sourceJobId) === sourceJobId,
    );
    if (byId) {
      return byId;
    }
  }

  const storedUrl = canonicalizeJobOpsUrl_(record.JOB_URL);
  if (storedUrl) {
    const byUrl = parsedJobs.find((job) => canonicalizeJobOpsUrl_(job.jobUrl) === storedUrl);
    if (byUrl) {
      return byUrl;
    }
  }

  const company = foldJobOpsText_(record.COMPANY);
  const position = foldJobOpsText_(record.POSITION);
  return (
    parsedJobs.find(
      (job) => foldJobOpsText_(job.company) === company && foldJobOpsText_(job.position) === position,
    ) || null
  );
}

/**
 * Marks an attempted migration as UNKNOWN without changing the base score.
 * This prevents one inaccessible historical email from blocking the batch.
 *
 * @param {Object<string, *>} record
 * @param {Object} config
 * @returns {Object<string, *>}
 */
function buildJobOpsUnavailableFitRecord_(record, config) {
  const score = Number(record.MATCH_SCORE) || 0;
  return {
    FIT_LEVEL: 'UNKNOWN',
    FIT_ADJUSTMENT: 0,
    FINAL_SCORE: score,
    FIT_REASONS: 'No fue posible obtener requisitos adicionales del correo histórico.',
    FIT_PROVIDER: 'UNAVAILABLE',
    FIT_VERSION: JOBOPS_FIT_VERSION,
    FIT_ASSESSED_AT: new Date(),
    PRIORITY: normalizeJobOpsSingleLineText_(record.PRIORITY) || getJobOpsPriorityForScore_(score, config),
  };
}
