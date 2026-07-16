/* exported setupJobOps, installJobOpsTriggers, ingestJobs, sendDailyDigest, handleStatusEdit, rescoreJobs, dryRunIngestion, validateJobOpsConfiguration */

/**
 * Initializes the Phase 1 Sheets environment and Gmail labels.
 *
 * @returns {Object}
 */
function setupJobOps() {
  return runJobOpsSetup_();
}

/** Reserved for the trigger phase. */
function installJobOpsTriggers() {}

/**
 * Ingests recent job messages, respecting Config.DRY_RUN.
 *
 * @returns {Object}
 */
function ingestJobs() {
  return runJobOpsIngestion_(false);
}

/** Reserved for the digest phase. */
function sendDailyDigest() {}

/**
 * Reserved for the status workflow phase.
 *
 * @param {Object} event Future installable onEdit event.
 */
function handleStatusEdit(event) {
  void event;
}

/** Reserved for the scoring phase. */
function rescoreJobs() {}

/**
 * Executes the complete ingestion path without mutating Gmail or Sheets.
 *
 * @returns {Object}
 */
function dryRunIngestion() {
  return runJobOpsIngestion_(true);
}

/**
 * Validates Script Properties, required sheets and editable configuration.
 *
 * @returns {Object}
 */
function validateJobOpsConfiguration() {
  return runJobOpsConfigurationValidation_();
}

/**
 * Coordinates one bounded ingestion under a script-wide lock.
 *
 * @param {boolean} forceDryRun
 * @returns {Object}
 */
function runJobOpsIngestion_(forceDryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.INGESTION_LOCK,
      'Another JobOps ingestion is already running.',
    );
  }

  try {
    const properties = readJobOpsScriptProperties_();
    assertValidJobOpsScriptProperties_(properties);
    const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
    const schemaErrors = getJobOpsSheetSchemaErrors_(spreadsheet);
    if (schemaErrors.length > 0) {
      throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, schemaErrors.join(' '));
    }

    const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
    const dryRun = Boolean(forceDryRun || config.DRY_RUN);
    const sourceDefinitions = readJobOpsSourceDefinitions_(spreadsheet);
    const deduplicationIndex = readJobOpsDeduplicationIndex_(spreadsheet);
    const inbox = readJobOpsGmailCandidates_(config, sourceDefinitions);

    if (!dryRun) {
      markJobOpsThreadsProcessing_(inbox.candidates.map((candidate) => candidate.thread));
    }

    const jobRecords = [];
    const duplicateUpdateTargets = new Map();
    const errorRecords = [];
    const processedThreads = [];
    const failedThreads = [];
    const recruiterThreads = [];
    let duplicateCount = 0;
    let recruiterCount = 0;

    for (const envelope of inbox.candidates) {
      try {
        const parsed = parseJobOpsMessage_(envelope.input, sourceDefinitions);
        const record = buildJobOpsJobRecord_(envelope.input, parsed, config);
        const candidate = {
          messageId: envelope.input.messageId,
          jobUrl: parsed.jobUrl,
          deduplicationKey: record.DEDUPLICATION_KEY,
          source: parsed.source,
          sourceJobId: parsed.sourceJobId,
        };
        const duplicateMatch = findJobOpsDuplicateMatch_(candidate, deduplicationIndex);

        if (duplicateMatch) {
          duplicateCount += 1;
          if (duplicateMatch.target) {
            Object.assign(
              duplicateMatch.target.record,
              mergeJobOpsDuplicateRecord_(duplicateMatch.target.record, record),
            );
            registerJobOpsCandidate_(candidate, deduplicationIndex, duplicateMatch.target);

            if (duplicateMatch.target.kind === 'existing') {
              duplicateMatch.target.dirty = true;
              duplicateUpdateTargets.set(duplicateMatch.target.rowNumber, duplicateMatch.target);
            }
          }
        } else {
          const target = { kind: 'pending', record };
          registerJobOpsCandidate_(candidate, deduplicationIndex, target);
          jobRecords.push(record);
        }

        processedThreads.push(envelope.thread);
        if (parsed.detection.isRecruiter) {
          recruiterCount += 1;
          recruiterThreads.push(envelope.thread);
        }
      } catch (error) {
        const detection = envelope.detection || {
          source: '',
          parserName: '',
          effective: { from: envelope.input.from, subject: envelope.input.subject },
        };
        errorRecords.push(
          buildJobOpsParsingErrorRecord_(
            envelope.input,
            {
              source: detection.source,
              parserName: detection.parserName,
              effectiveFrom: detection.effective && detection.effective.from,
              effectiveSubject: detection.effective && detection.effective.subject,
            },
            normalizeJobOpsParserError_(error),
          ),
        );
        failedThreads.push(envelope.thread);
      }
    }

    if (!dryRun) {
      try {
        writeJobOpsIngestionBatch_(
          spreadsheet,
          Array.from(duplicateUpdateTargets.values()),
          jobRecords,
          errorRecords,
        );
      } catch (error) {
        try {
          finalizeJobOpsThreadLabels_(
            [],
            inbox.candidates.map((candidate) => candidate.thread),
            [],
          );
        } catch (labelError) {
          Logger.log(
            `JobOps cleanup failed after a Sheets error: ${labelError.code || JOBOPS_ERROR_CODES.GMAIL_LABEL}`,
          );
        }
        throw error;
      }
      finalizeJobOpsThreadLabels_(processedThreads, failedThreads, recruiterThreads);
    }

    const summary = {
      ok: true,
      phase: 3,
      dryRun,
      scannedMessages: inbox.scannedMessages,
      candidateMessages: inbox.candidates.length,
      ignoredMessages: inbox.ignoredMessages,
      createdJobs: dryRun ? 0 : jobRecords.length,
      wouldCreateJobs: dryRun ? jobRecords.length : 0,
      parsingErrors: errorRecords.length,
      duplicates: duplicateCount,
      recruiterMessages: recruiterCount,
    };
    logJobOpsIngestionSummary_(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Converts unexpected parser exceptions to a stable diagnostic category.
 *
 * @param {*} error
 * @returns {Error}
 */
function normalizeJobOpsParserError_(error) {
  if (error && error.name === 'JobOpsError' && error.code) {
    return error;
  }
  return createJobOpsError_(
    JOBOPS_ERROR_CODES.PARSER,
    `Unexpected parser failure: ${error && error.message ? error.message : 'Unknown error'}`,
  );
}

/**
 * Writes exact-duplicate enrichments, new jobs and parsing failures in batches.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {{rowNumber: number, record: Object<string, *>}[]} duplicateUpdateTargets
 * @param {Object[]} jobRecords
 * @param {Object[]} errorRecords
 */
function writeJobOpsIngestionBatch_(spreadsheet, duplicateUpdateTargets, jobRecords, errorRecords) {
  try {
    updateJobOpsDuplicateJobRecords_(spreadsheet, duplicateUpdateTargets);
    appendJobOpsJobRecords_(spreadsheet, jobRecords);
    appendJobOpsParsingErrorRecords_(spreadsheet, errorRecords);
  } catch (error) {
    if (error && error.name === 'JobOpsError' && error.code) {
      throw error;
    }
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.SHEETS_WRITE,
      `Unable to write the ingestion batch: ${error.message}`,
    );
  }
}

/**
 * Logs counts only; message bodies, addresses and identifiers are excluded.
 *
 * @param {Object} summary
 */
function logJobOpsIngestionSummary_(summary) {
  Logger.log(
    `JobOps Phase 3: dryRun=${summary.dryRun}, scanned=${summary.scannedMessages}, candidates=${summary.candidateMessages}, created=${summary.createdJobs}, wouldCreate=${summary.wouldCreateJobs}, errors=${summary.parsingErrors}, duplicates=${summary.duplicates}`,
  );
}
