/* exported setupJobOps, installJobOpsTriggers, ingestJobs, sendDailyDigest, handleStatusEdit, rescoreJobs, dryRunIngestion, validateJobOpsConfiguration */

/**
 * Initializes the Phase 1 Sheets environment and Gmail labels.
 *
 * @returns {Object}
 */
function setupJobOps() {
  return runJobOpsSetup_();
}

/**
 * Installs the bounded ingestion, digest and edit triggers once.
 *
 * @returns {Object}
 */
function installJobOpsTriggers() {
  const properties = readJobOpsScriptProperties_();
  assertValidJobOpsScriptProperties_(properties);
  const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
  const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
  const handlers = new Set(
    ScriptApp.getProjectTriggers().map((trigger) => trigger.getHandlerFunction()),
  );
  const created = [];

  if (!handlers.has('ingestJobs')) {
    ScriptApp.newTrigger('ingestJobs').timeBased().everyHours(1).create();
    created.push('ingestJobs');
  }
  if (!handlers.has('sendDailyDigest')) {
    ScriptApp.newTrigger('sendDailyDigest')
      .timeBased()
      .atHour(config.DIGEST_HOUR)
      .everyDays(1)
      .create();
    created.push('sendDailyDigest');
  }
  if (!handlers.has('handleStatusEdit')) {
    ScriptApp.newTrigger('handleStatusEdit').forSpreadsheet(spreadsheet).onEdit().create();
    created.push('handleStatusEdit');
  }

  return { ok: true, created, existing: Array.from(handlers) };
}

/**
 * Ingests recent job messages, respecting Config.DRY_RUN.
 *
 * @returns {Object}
 */
function ingestJobs() {
  return runJobOpsIngestion_(false);
}

/**
 * Sends at most one non-empty daily digest in the configured timezone.
 *
 * @returns {Object}
 */
function sendDailyDigest() {
  return runJobOpsDailyDigest_();
}

/** @param {Object} event @returns {Object|undefined} */
function handleStatusEdit(event) {
  return runJobOpsStatusEdit_(event);
}

/**
 * Re-evaluates existing Jobs from editable role, scoring and CV settings.
 *
 * @returns {Object}
 */
function rescoreJobs() {
  return runJobOpsRescore_();
}

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
    const evaluationContext = createJobOpsEvaluationContext_(spreadsheet, config);
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
        Object.assign(
          record,
          evaluateJobOpsJob_(
            { ...parsed, isRecruiter: parsed.detection.isRecruiter },
            evaluationContext,
          ),
        );
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
            Object.assign(
              duplicateMatch.target.record,
              evaluateJobOpsJob_(
                {
                  position: duplicateMatch.target.record.POSITION,
                  descriptionText: parsed.descriptionText,
                  requiredTechnologies: normalizeJobOpsSingleLineText_(
                    duplicateMatch.target.record.REQUIRED_TECHNOLOGIES,
                  )
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                  isRecruiter:
                    duplicateMatch.target.record.SOURCE === 'Recruiter' ||
                    Boolean(duplicateMatch.target.record.RECRUITER_EMAIL),
                },
                evaluationContext,
              ),
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
      phase: 4,
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
 * Loads all editable settings required for one job evaluation.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {Object} config
 * @returns {{roleFamilies: Object[], scoringRules: Object[], cvProfiles: Object[], config: Object}}
 */
function createJobOpsEvaluationContext_(spreadsheet, config) {
  return {
    roleFamilies: readJobOpsRoleFamilies_(spreadsheet),
    scoringRules: readJobOpsScoringRules_(spreadsheet),
    cvProfiles: readJobOpsCvProfiles_(spreadsheet),
    config,
  };
}

/**
 * Reads the current jobs and errors, then sends a digest when it has content.
 *
 * @returns {Object}
 */
function runJobOpsDailyDigest_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.DIGEST,
      'Another JobOps process is already running.',
    );
  }

  try {
    const properties = readJobOpsScriptProperties_();
    assertValidJobOpsScriptProperties_(properties);
    const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
    const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
    if (!config.DIGEST_ENABLED) {
      return { ok: true, sent: false, reason: 'DIGEST_DISABLED' };
    }

    const scriptProperties = PropertiesService.getScriptProperties();
    const dateKey = getJobOpsDateKey_(new Date(), config.TIMEZONE);
    if (scriptProperties.getProperty('LAST_DIGEST_DATE') === dateKey) {
      return { ok: true, sent: false, reason: 'ALREADY_SENT' };
    }

    const sections = selectJobOpsDigestSections_(
      readJobOpsJobsForRescore_(spreadsheet).map((target) => target.record),
      readJobOpsParsingErrorsForDigest_(spreadsheet),
      config,
      new Date(),
    );
    const digest = buildJobOpsDigest_(sections, new Date(), config.TIMEZONE);
    if (!digest.hasContent) {
      return { ok: true, sent: false, reason: 'NO_CONTENT' };
    }

    MailApp.sendEmail({
      to: properties.USER_EMAIL,
      subject: `JobOps — resumen diario ${dateKey}`,
      htmlBody: digest.htmlBody,
      body: digest.plainBody,
    });
    scriptProperties.setProperty('LAST_DIGEST_DATE', dateKey);
    Logger.log(
      `JobOps Phase 5: digest sent jobs=${sections.jobs.length}, recruiters=${sections.recruiters.length}, followUps=${sections.followUps.length}, errors=${sections.errors.length}`,
    );
    return {
      ok: true,
      sent: true,
      sections: Object.fromEntries(
        Object.entries(sections).map(([key, value]) => [key, value.length]),
      ),
    };
  } catch (error) {
    if (error && error.name === 'JobOpsError' && error.code) {
      throw error;
    }
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.DIGEST,
      `Unable to send the daily digest: ${error.message}`,
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Recalculates system-managed evaluation fields without changing manual data.
 *
 * @returns {Object}
 */
function runJobOpsRescore_() {
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
    const schemaErrors = getJobOpsSheetSchemaErrors_(spreadsheet);
    if (schemaErrors.length > 0) {
      throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, schemaErrors.join(' '));
    }

    const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
    const evaluationContext = createJobOpsEvaluationContext_(spreadsheet, config);
    const targets = readJobOpsJobsForRescore_(spreadsheet);

    for (const target of targets) {
      const record = target.record;
      Object.assign(
        record,
        evaluateJobOpsJob_(
          {
            position: record.POSITION,
            descriptionText: '',
            requiredTechnologies: normalizeJobOpsSingleLineText_(record.REQUIRED_TECHNOLOGIES)
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
            isRecruiter: record.SOURCE === 'Recruiter' || Boolean(record.RECRUITER_EMAIL),
          },
          evaluationContext,
        ),
      );
    }

    updateJobOpsJobEvaluationFields_(spreadsheet, targets);
    const summary = { ok: true, phase: 4, rescoredJobs: targets.length };
    Logger.log(`JobOps Phase 4: rescored=${summary.rescoredJobs}`);
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
    `JobOps Phase 4: dryRun=${summary.dryRun}, scanned=${summary.scannedMessages}, candidates=${summary.candidateMessages}, created=${summary.createdJobs}, wouldCreate=${summary.wouldCreateJobs}, errors=${summary.parsingErrors}, duplicates=${summary.duplicates}`,
  );
}
