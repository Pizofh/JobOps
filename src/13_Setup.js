/**
 * Creates the editable JobOps environment without replacing existing values.
 *
 * @returns {Object}
 */
function runJobOpsSetup_() {
  const properties = readJobOpsScriptProperties_();
  assertValidJobOpsScriptProperties_(properties);

  const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);

  let spreadsheetSummary;
  try {
    spreadsheetSummary = setupJobOpsSpreadsheet_(spreadsheet);
  } catch (error) {
    if (error.name === 'JobOpsError' && error.code) {
      throw error;
    }

    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.SHEETS_WRITE,
      `Unable to initialize Sheets: ${error.message}`,
    );
  }

  const gmailLabels = ensureJobOpsGmailLabels_();
  const validation = validateJobOpsConfigurationState_(spreadsheet, properties);

  return {
    ok: true,
    phase: 1,
    spreadsheet: spreadsheetSummary,
    gmailLabels,
    validation,
  };
}

/**
 * Opens the configured spreadsheet without leaking its private ID in errors.
 *
 * @param {string} spreadsheetId
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function openConfiguredJobOpsSpreadsheet_(spreadsheetId) {
  try {
    return openJobOpsSpreadsheet_(spreadsheetId);
  } catch {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      'Unable to open SPREADSHEET_ID. Check the Script Property and account access.',
    );
  }
}

/**
 * Creates only missing Gmail labels.
 *
 * @returns {{created: string[], existing: string[]}}
 */
function ensureJobOpsGmailLabels_() {
  const summary = { created: [], existing: [] };

  for (const labelName of JOBOPS_GMAIL_LABEL_NAMES) {
    try {
      const existingLabel = GmailApp.getUserLabelByName(labelName);
      if (existingLabel) {
        summary.existing.push(labelName);
      } else {
        GmailApp.createLabel(labelName);
        summary.created.push(labelName);
      }
    } catch (error) {
      throw createJobOpsError_(
        JOBOPS_ERROR_CODES.GMAIL_LABEL,
        `Unable to create or read Gmail label ${labelName}: ${error.message}`,
      );
    }
  }

  return summary;
}

/**
 * Validates Script Properties, sheet schemas and editable Config values.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {{SPREADSHEET_ID: string, USER_EMAIL: string}} properties
 * @returns {Object}
 */
function validateJobOpsConfigurationState_(spreadsheet, properties) {
  const propertyErrors = getJobOpsScriptPropertyErrors_(properties);
  const schemaErrors = getJobOpsSheetSchemaErrors_(spreadsheet);
  const errors = propertyErrors.concat(schemaErrors);

  if (errors.length > 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, errors.join(' '));
  }

  const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));

  return {
    valid: true,
    sheets: JOBOPS_SHEET_DEFINITIONS.map((definition) => definition.name),
    timezone: config.TIMEZONE,
    digestEnabled: config.DIGEST_ENABLED,
    dryRun: config.DRY_RUN,
    spreadsheetId: redactJobOpsValue_(properties.SPREADSHEET_ID),
    userEmailConfigured: Boolean(properties.USER_EMAIL),
  };
}

/**
 * Reads current services and validates the complete Phase 1 configuration.
 *
 * @returns {Object}
 */
function runJobOpsConfigurationValidation_() {
  const properties = readJobOpsScriptProperties_();
  assertValidJobOpsScriptProperties_(properties);
  const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
  return validateJobOpsConfigurationState_(spreadsheet, properties);
}
