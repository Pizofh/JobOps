/**
 * Opens the private spreadsheet configured for JobOps.
 *
 * @param {string} spreadsheetId
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function openJobOpsSpreadsheet_(spreadsheetId) {
  return SpreadsheetApp.openById(spreadsheetId);
}

/**
 * Creates missing sheets and initializes their schema without replacing data.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {{createdSheets: string[], extendedHeaders: Object<string, number>, seededRows: Object<string, number>}}
 */
function setupJobOpsSpreadsheet_(spreadsheet) {
  assertValidJobOpsDefinitions_();

  const summary = {
    createdSheets: [],
    extendedHeaders: {},
    seededRows: {},
  };

  for (const definition of JOBOPS_SHEET_DEFINITIONS) {
    let sheet = spreadsheet.getSheetByName(definition.name);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(definition.name);
      summary.createdSheets.push(definition.name);
    }

    ensureJobOpsSheetSize_(sheet, 2, definition.headers.length);
    summary.extendedHeaders[definition.name] = ensureJobOpsHeaders_(sheet, definition.headers);
    summary.seededRows[definition.name] = appendMissingJobOpsSeedRows_(sheet, definition.seedRows);

    formatJobOpsSheet_(sheet, definition.headers);
    applyJobOpsDataValidations_(sheet, definition.headers);
  }

  applyJobOpsConditionalFormatting_(spreadsheet);
  return summary;
}

/**
 * Validates static sheet definitions before any external write.
 */
function assertValidJobOpsDefinitions_() {
  const errors = [];
  const sheetNames = new Set();

  for (const definition of JOBOPS_SHEET_DEFINITIONS) {
    if (sheetNames.has(definition.name)) {
      errors.push(`Duplicate sheet definition ${definition.name}.`);
    }
    sheetNames.add(definition.name);

    const headers = new Set(definition.headers);
    if (headers.size !== definition.headers.length) {
      errors.push(`Sheet ${definition.name} contains duplicate headers.`);
    }

    const seedKeys = new Set();
    for (const row of definition.seedRows) {
      if (row.length !== definition.headers.length) {
        errors.push(`Seed row ${normalizeJobOpsText_(row[0])} has the wrong column count.`);
      }

      const key = normalizeJobOpsText_(row[0]).toUpperCase();
      if (!key) {
        errors.push(`Sheet ${definition.name} contains a seed row without a key.`);
      } else if (seedKeys.has(key)) {
        errors.push(`Sheet ${definition.name} contains duplicate seed key ${key}.`);
      }
      seedKeys.add(key);
    }
  }

  if (errors.length > 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, errors.join(' '));
  }
}

/**
 * Ensures a sheet can hold the required schema and seed rows.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} minimumRows
 * @param {number} minimumColumns
 */
function ensureJobOpsSheetSize_(sheet, minimumRows, minimumColumns) {
  const missingRows = minimumRows - sheet.getMaxRows();
  if (missingRows > 0) {
    sheet.insertRowsAfter(sheet.getMaxRows(), missingRows);
  }

  const missingColumns = minimumColumns - sheet.getMaxColumns();
  if (missingColumns > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
  }
}

/**
 * Adds only missing trailing headers and rejects incompatible existing schemas.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} expectedHeaders
 * @returns {number}
 */
function ensureJobOpsHeaders_(sheet, expectedHeaders) {
  const existingColumnCount = sheet.getLastColumn();
  const existingHeaders =
    existingColumnCount > 0 ? sheet.getRange(1, 1, 1, existingColumnCount).getValues()[0] : [];
  const plan = getJobOpsHeaderWritePlan_(existingHeaders, expectedHeaders);

  if (plan.missingHeaders.length > 0) {
    sheet
      .getRange(1, plan.startColumn, 1, plan.missingHeaders.length)
      .setValues([plan.missingHeaders]);
  }

  return plan.missingHeaders.length;
}

/**
 * Calculates a non-destructive header write plan.
 *
 * @param {*[]} existingHeaders
 * @param {string[]} expectedHeaders
 * @returns {{startColumn: number, missingHeaders: string[]}}
 */
function getJobOpsHeaderWritePlan_(existingHeaders, expectedHeaders) {
  const normalized = existingHeaders.map(normalizeJobOpsText_);
  let actualLength = normalized.length;

  while (actualLength > 0 && !normalized[actualLength - 1]) {
    actualLength -= 1;
  }

  const actualHeaders = normalized.slice(0, actualLength);
  const sharedLength = Math.min(actualHeaders.length, expectedHeaders.length);

  for (let index = 0; index < sharedLength; index += 1) {
    if (actualHeaders[index] !== expectedHeaders[index]) {
      throw createJobOpsError_(
        JOBOPS_ERROR_CODES.CONFIGURATION,
        `Incompatible header at column ${index + 1}: expected ${expectedHeaders[index]}, found ${actualHeaders[index] || '(empty)'}.`,
      );
    }
  }

  if (actualHeaders.length > 0 && actualHeaders.length < expectedHeaders.length) {
    return {
      startColumn: actualHeaders.length + 1,
      missingHeaders: expectedHeaders.slice(actualHeaders.length),
    };
  }

  if (actualHeaders.length === 0) {
    return { startColumn: 1, missingHeaders: expectedHeaders.slice() };
  }

  return { startColumn: expectedHeaders.length + 1, missingHeaders: [] };
}

/**
 * Appends initial rows whose primary keys are not already present.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {*[][]} seedRows
 * @returns {number}
 */
function appendMissingJobOpsSeedRows_(sheet, seedRows) {
  if (seedRows.length === 0) {
    return 0;
  }

  const dataRowCount = Math.max(sheet.getLastRow() - 1, 0);
  const existingKeys =
    dataRowCount > 0
      ? sheet
          .getRange(2, 1, dataRowCount, 1)
          .getValues()
          .map((row) => row[0])
      : [];
  const missingRows = getMissingJobOpsSeedRows_(existingKeys, seedRows);

  if (missingRows.length === 0) {
    return 0;
  }

  const startRow = sheet.getLastRow() + 1;
  ensureJobOpsSheetSize_(sheet, startRow + missingRows.length - 1, missingRows[0].length);
  sheet.getRange(startRow, 1, missingRows.length, missingRows[0].length).setValues(missingRows);
  return missingRows.length;
}

/**
 * Selects initial rows that do not have a matching first-column key.
 *
 * @param {*[]} existingKeys
 * @param {*[][]} seedRows
 * @returns {*[][]}
 */
function getMissingJobOpsSeedRows_(existingKeys, seedRows) {
  const normalizedKeys = new Set(
    existingKeys
      .map((key) => normalizeJobOpsText_(key).toUpperCase())
      .filter((key) => Boolean(key)),
  );

  return seedRows
    .filter((row) => !normalizedKeys.has(normalizeJobOpsText_(row[0]).toUpperCase()))
    .map((row) => row.slice());
}

/**
 * Applies common formatting without changing cell values.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function formatJobOpsSheet_(sheet, headers) {
  sheet.setFrozenRows(1);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setBackground(JOBOPS_HEADER_STYLE.background)
    .setFontColor(JOBOPS_HEADER_STYLE.fontColor)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  sheet.autoResizeColumns(1, headers.length);
  setJobOpsColumnWidthIfPresent_(sheet, headers, 'NOTES', 300);
  setJobOpsColumnWidthIfPresent_(sheet, headers, 'JOB_URL', 260);
  setJobOpsColumnWidthIfPresent_(sheet, headers, 'REQUIRED_TECHNOLOGIES', 260);
  setJobOpsColumnWidthIfPresent_(sheet, headers, 'STRONG_MATCHES', 260);
  setJobOpsColumnWidthIfPresent_(sheet, headers, 'RISK_FLAGS', 260);
  setJobOpsColumnWidthIfPresent_(sheet, headers, 'ERROR_MESSAGE', 300);

  if (!sheet.getFilter()) {
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  }

  setJobOpsColumnFormatIfPresent_(sheet, headers, 'DISCOVERED_AT', 'yyyy-mm-dd hh:mm');
  setJobOpsColumnFormatIfPresent_(sheet, headers, 'LAST_UPDATED_AT', 'yyyy-mm-dd hh:mm');
  setJobOpsColumnFormatIfPresent_(sheet, headers, 'TIMESTAMP', 'yyyy-mm-dd hh:mm');
  setJobOpsColumnFormatIfPresent_(sheet, headers, 'APPLIED_DATE', 'yyyy-mm-dd');
  setJobOpsColumnFormatIfPresent_(sheet, headers, 'FOLLOW_UP_DATE', 'yyyy-mm-dd');
}

/**
 * Sets a column width when the schema contains the requested header.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 * @param {string} headerName
 * @param {number} width
 */
function setJobOpsColumnWidthIfPresent_(sheet, headers, headerName, width) {
  const index = headers.indexOf(headerName);
  if (index !== -1) {
    sheet.setColumnWidth(index + 1, width);
  }
}

/**
 * Applies a number format below the header when a column exists.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 * @param {string} headerName
 * @param {string} numberFormat
 */
function setJobOpsColumnFormatIfPresent_(sheet, headers, headerName, numberFormat) {
  const index = headers.indexOf(headerName);
  const rowCount = sheet.getMaxRows() - 1;

  if (index !== -1 && rowCount > 0) {
    sheet.getRange(2, index + 1, rowCount, 1).setNumberFormat(numberFormat);
  }
}

/**
 * Adds dropdown and checkbox validation while preserving existing validation rules.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function applyJobOpsDataValidations_(sheet, headers) {
  const listRules = {
    STATUS: JOBOPS_APPLICATION_STATUSES,
    WORK_MODE: JOBOPS_WORK_MODES,
    MATCH_TYPE: JOBOPS_MATCH_TYPES,
    CONTEXT: JOBOPS_SCORING_CONTEXTS,
  };

  for (const headerName of Object.keys(listRules)) {
    const index = headers.indexOf(headerName);
    if (index === -1) {
      continue;
    }

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(listRules[headerName], true)
      .setAllowInvalid(false)
      .setHelpText(`Allowed values: ${listRules[headerName].join(', ')}`)
      .build();
    setJobOpsValidationWhereMissing_(sheet, index + 1, rule);
  }

  for (const headerName of ['ENABLED', 'RESOLVED']) {
    const index = headers.indexOf(headerName);
    if (index === -1) {
      continue;
    }

    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    setJobOpsValidationWhereMissing_(sheet, index + 1, rule);
  }
}

/**
 * Fills only cells without an existing validation rule.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} columnNumber
 * @param {GoogleAppsScript.Spreadsheet.DataValidation} rule
 */
function setJobOpsValidationWhereMissing_(sheet, columnNumber, rule) {
  const rowCount = sheet.getMaxRows() - 1;
  if (rowCount <= 0) {
    return;
  }

  const range = sheet.getRange(2, columnNumber, rowCount, 1);
  const validations = range.getDataValidations();
  let changed = false;

  for (let rowIndex = 0; rowIndex < validations.length; rowIndex += 1) {
    if (!validations[rowIndex][0]) {
      validations[rowIndex][0] = rule;
      changed = true;
    }
  }

  if (changed) {
    range.setDataValidations(validations);
  }
}

/**
 * Adds the default Jobs conditional rules only when no rules already exist.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 */
function applyJobOpsConditionalFormatting_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.JOBS);
  if (!sheet || sheet.getConditionalFormatRules().length > 0) {
    return;
  }

  const headers = JOBOPS_SHEET_HEADERS.Jobs;
  const rowCount = sheet.getMaxRows() - 1;
  if (rowCount <= 0) {
    return;
  }

  const rules = [];
  const priorityRange = sheet.getRange(2, getJobOpsColumnNumber_(headers, 'PRIORITY'), rowCount, 1);
  const statusRange = sheet.getRange(2, getJobOpsColumnNumber_(headers, 'STATUS'), rowCount, 1);

  for (const priority of JOBOPS_PRIORITIES) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(priority)
        .setBackground(JOBOPS_CONDITIONAL_COLORS[priority])
        .setRanges([priorityRange])
        .build(),
    );
  }

  for (const status of ['APPLIED', 'REJECTED', 'GHOSTED', 'OFFER']) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(status)
        .setBackground(JOBOPS_CONDITIONAL_COLORS[status])
        .setRanges([statusRange])
        .build(),
    );
  }

  sheet.setConditionalFormatRules(rules);
}

/**
 * Returns schema errors without mutating the spreadsheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {string[]}
 */
function getJobOpsSheetSchemaErrors_(spreadsheet) {
  const errors = [];

  for (const definition of JOBOPS_SHEET_DEFINITIONS) {
    const sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) {
      errors.push(`Missing sheet ${definition.name}.`);
      continue;
    }

    const availableColumns = Math.min(sheet.getMaxColumns(), definition.headers.length);
    const existingHeaders =
      availableColumns > 0 ? sheet.getRange(1, 1, 1, availableColumns).getValues()[0] : [];

    try {
      const plan = getJobOpsHeaderWritePlan_(existingHeaders, definition.headers);
      if (plan.missingHeaders.length > 0) {
        errors.push(`Sheet ${definition.name} is missing required headers.`);
      }
    } catch (error) {
      errors.push(`Sheet ${definition.name}: ${error.message}`);
    }
  }

  return errors;
}

/**
 * Loads enabled source definitions once per ingestion run.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function readJobOpsSourceDefinitions_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.SOURCES);
  if (!sheet) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      `Missing sheet ${JOBOPS_SHEET_NAMES.SOURCES}. Run setupJobOps first.`,
    );
  }
  return parseJobOpsSourceDefinitions_(sheet.getDataRange().getValues());
}

/**
 * Loads enabled role-family definitions once per evaluation run.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function readJobOpsRoleFamilies_(spreadsheet) {
  return parseJobOpsRoleFamilies_(
    getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.ROLE_FAMILIES)
      .getDataRange()
      .getValues(),
  );
}

/**
 * Loads enabled scoring rules once per evaluation run.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function readJobOpsScoringRules_(spreadsheet) {
  return parseJobOpsScoringRules_(
    getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.SCORING_RULES)
      .getDataRange()
      .getValues(),
  );
}

/**
 * Loads enabled CV profiles once per evaluation run.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object[]}
 */
function readJobOpsCvProfiles_(spreadsheet) {
  return parseJobOpsCvProfiles_(
    getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.CV_PROFILES).getDataRange().getValues(),
  );
}

/**
 * Reads all existing Jobs as named records for a manual rescore.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {{rowNumber: number, record: Object<string, *>}[]}
 */
function readJobOpsJobsForRescore_(spreadsheet) {
  const sheet = getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.JOBS);
  const headers = JOBOPS_SHEET_HEADERS.Jobs;
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const values = rowCount > 0 ? sheet.getRange(2, 1, rowCount, headers.length).getValues() : [];

  return values.map((row, index) => ({
    rowNumber: index + 2,
    record: createJobOpsRecordFromRow_(headers, row),
  }));
}

/**
 * Reads ParsingErrors as named records for the privacy-limited daily digest.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object<string, *>[]}
 */
function readJobOpsParsingErrorsForDigest_(spreadsheet) {
  const sheet = getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.PARSING_ERRORS);
  const headers = JOBOPS_SHEET_HEADERS.ParsingErrors;
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const values = rowCount > 0 ? sheet.getRange(2, 1, rowCount, headers.length).getValues() : [];
  return values.map((row) => createJobOpsRecordFromRow_(headers, row));
}

/**
 * Writes only Phase 4 system fields in three column batches. Manual columns
 * are never read back into a write operation.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {{rowNumber: number, record: Object<string, *>}[]} targets
 * @returns {number}
 */
function updateJobOpsJobEvaluationFields_(spreadsheet, targets) {
  if (targets.length === 0) {
    return 0;
  }

  const sheet = getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.JOBS);
  const fieldGroups = [
    ['ROLE_FAMILY', 'MATCH_SCORE', 'PRIORITY'],
    ['RECOMMENDED_CV', 'CV_LINK'],
    ['STRONG_MATCHES', 'RISK_FLAGS'],
  ];

  for (const fields of fieldGroups) {
    const firstColumn = getJobOpsColumnNumber_(JOBOPS_SHEET_HEADERS.Jobs, fields[0]);
    sheet
      .getRange(2, firstColumn, targets.length, fields.length)
      .setValues(targets.map((target) => fields.map((field) => target.record[field] ?? '')));
  }

  return targets.length;
}

/**
 * Loads exact deduplication identifiers from Jobs in one read.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {{messageIds: Set<string>, keys: Set<string>, urls: Set<string>}}
 */
function readJobOpsDeduplicationIndex_(spreadsheet) {
  const sheet = getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.JOBS);
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const headers = JOBOPS_SHEET_HEADERS.Jobs;
  const rows = rowCount > 0 ? sheet.getRange(2, 1, rowCount, headers.length).getValues() : [];
  return buildJobOpsDeduplicationIndex_(headers, rows);
}

/**
 * Maps a parsed candidate to the immutable initial Jobs row.
 *
 * @param {Object} input
 * @param {Object} parsed
 * @param {Object} config
 * @returns {Object<string, *>}
 */
function buildJobOpsJobRecord_(input, parsed, config) {
  const messageId = normalizeJobOpsSingleLineText_(input.messageId);
  const discoveredAt = normalizeJobOpsDate_(input.date);
  const score = parsed.detection.isRecruiter ? config.RECRUITER_SCORE_BONUS : 0;
  const deduplicationKey = buildJobOpsDeduplicationKey_({
    source: parsed.source,
    sourceJobId: parsed.sourceJobId,
    jobUrl: parsed.jobUrl,
    messageId,
  });

  return {
    JOB_ID: buildJobOpsJobId_(messageId),
    DISCOVERED_AT: discoveredAt,
    LAST_UPDATED_AT: discoveredAt,
    SOURCE: parsed.source,
    ALL_SOURCES: parsed.source,
    SOURCE_JOB_ID: parsed.sourceJobId,
    COMPANY: parsed.company,
    POSITION: parsed.position,
    LOCATION: parsed.location,
    WORK_MODE: parsed.workMode,
    JOB_URL: parsed.jobUrl,
    ROLE_FAMILY: 'UNCLASSIFIED',
    MATCH_SCORE: score,
    PRIORITY: getJobOpsPriorityForScore_(score, config),
    RECOMMENDED_CV: 'CV_TO_CREATE',
    CV_LINK: '',
    SALARY: parsed.salary,
    EXPERIENCE_REQUESTED: parsed.experienceRequested,
    REQUIRED_TECHNOLOGIES: parsed.requiredTechnologies.join(', '),
    STRONG_MATCHES: parsed.detection.isRecruiter
      ? `Recruiter ${score >= 0 ? '+' : ''}${score}`
      : '',
    RISK_FLAGS: '',
    RECRUITER_NAME: parsed.recruiterName,
    RECRUITER_EMAIL: parsed.recruiterEmail,
    GMAIL_MESSAGE_ID: messageId,
    GMAIL_THREAD_ID: normalizeJobOpsSingleLineText_(input.threadId),
    DEDUPLICATION_KEY: deduplicationKey,
    PARSER: parsed.parserName,
    PARSER_VERSION: parsed.parserVersion,
    STATUS: 'NEW',
    APPLIED_DATE: '',
    FOLLOW_UP_DATE: '',
    NOTES: parsed.warnings.length > 0 ? `Parser: ${parsed.warnings.join(' ')}`.slice(0, 500) : '',
  };
}

/**
 * Creates a privacy-limited ParsingErrors row.
 *
 * @param {Object} input
 * @param {Object} diagnostic
 * @param {Error} error
 * @returns {Object<string, *>}
 */
function buildJobOpsParsingErrorRecord_(input, diagnostic, error) {
  return {
    TIMESTAMP: new Date(),
    GMAIL_MESSAGE_ID: normalizeJobOpsSingleLineText_(input.messageId),
    SENDER: normalizeJobOpsSingleLineText_(diagnostic.effectiveFrom || input.from).slice(0, 300),
    SUBJECT: normalizeJobOpsSingleLineText_(diagnostic.effectiveSubject || input.subject).slice(
      0,
      500,
    ),
    DETECTED_SOURCE: normalizeJobOpsSingleLineText_(diagnostic.source),
    PARSER: normalizeJobOpsSingleLineText_(diagnostic.parserName),
    ERROR_TYPE: normalizeJobOpsSingleLineText_(
      error.code || error.name || JOBOPS_ERROR_CODES.PARSER,
    ),
    ERROR_MESSAGE: normalizeJobOpsSingleLineText_(error.message).slice(0, 500),
    RETRY_COUNT: 0,
    RESOLVED: false,
    NOTES: '',
  };
}

/**
 * Appends new Jobs in a single Sheets write.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {Object<string, *>[]} records
 * @returns {number}
 */
function appendJobOpsJobRecords_(spreadsheet, records) {
  return appendJobOpsRecords_(
    spreadsheet,
    JOBOPS_SHEET_NAMES.JOBS,
    JOBOPS_SHEET_HEADERS.Jobs,
    records,
  );
}

/**
 * Updates only the existing Jobs rows that were matched by exact
 * deduplication. Each update retains manual fields already present in the
 * merged record and contiguous rows are written as a batch.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {{rowNumber: number, record: Object<string, *>}[]} targets
 * @returns {number}
 */
function updateJobOpsDuplicateJobRecords_(spreadsheet, targets) {
  if (targets.length === 0) {
    return 0;
  }

  const sheet = getRequiredJobOpsSheet_(spreadsheet, JOBOPS_SHEET_NAMES.JOBS);
  const headers = JOBOPS_SHEET_HEADERS.Jobs;
  const sortedTargets = targets.slice().sort((first, second) => first.rowNumber - second.rowNumber);
  const batches = [];

  for (const target of sortedTargets) {
    const previousBatch = batches[batches.length - 1];
    if (
      !previousBatch ||
      previousBatch.startRow + previousBatch.records.length !== target.rowNumber
    ) {
      batches.push({ startRow: target.rowNumber, records: [target.record] });
    } else {
      previousBatch.records.push(target.record);
    }
  }

  for (const batch of batches) {
    const values = batch.records.map((record) => headers.map((header) => record[header] ?? ''));
    sheet.getRange(batch.startRow, 1, values.length, headers.length).setValues(values);
  }

  return sortedTargets.length;
}

/**
 * Appends parsing diagnostics in a single Sheets write.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {Object<string, *>[]} records
 * @returns {number}
 */
function appendJobOpsParsingErrorRecords_(spreadsheet, records) {
  return appendJobOpsRecords_(
    spreadsheet,
    JOBOPS_SHEET_NAMES.PARSING_ERRORS,
    JOBOPS_SHEET_HEADERS.ParsingErrors,
    records,
  );
}

/**
 * Generic non-destructive append helper.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} sheetName
 * @param {string[]} headers
 * @param {Object<string, *>[]} records
 * @returns {number}
 */
function appendJobOpsRecords_(spreadsheet, sheetName, headers, records) {
  if (records.length === 0) {
    return 0;
  }

  const sheet = getRequiredJobOpsSheet_(spreadsheet, sheetName);
  const startRow = sheet.getLastRow() + 1;
  const rows = records.map((record) => headers.map((header) => record[header] ?? ''));
  ensureJobOpsSheetSize_(sheet, startRow + rows.length - 1, headers.length);
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}

/**
 * Returns a required sheet with a stable configuration error.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} sheetName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getRequiredJobOpsSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      `Missing sheet ${sheetName}. Run setupJobOps first.`,
    );
  }
  return sheet;
}

/**
 * Normalizes message dates without accepting an invalid timestamp.
 *
 * @param {*} value
 * @returns {Date}
 */
function normalizeJobOpsDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Applies the editable priority thresholds to the Phase 2 base score.
 *
 * @param {number} score
 * @param {Object} config
 * @returns {string}
 */
function getJobOpsPriorityForScore_(score, config) {
  if (score >= config.HIGH_PRIORITY_THRESHOLD) {
    return 'HIGH';
  }
  if (score >= config.REVIEW_THRESHOLD) {
    return 'REVIEW';
  }
  if (score >= config.OPTIONAL_THRESHOLD) {
    return 'OPTIONAL';
  }
  return 'LOW';
}
