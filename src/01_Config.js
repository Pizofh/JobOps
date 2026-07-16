/**
 * Reads private JobOps identifiers from Script Properties.
 *
 * @returns {{SPREADSHEET_ID: string, USER_EMAIL: string}}
 */
function readJobOpsScriptProperties_() {
  const properties = PropertiesService.getScriptProperties().getProperties();

  return {
    SPREADSHEET_ID: normalizeJobOpsText_(properties[JOBOPS_SCRIPT_PROPERTY_KEYS.SPREADSHEET_ID]),
    USER_EMAIL: normalizeJobOpsText_(properties[JOBOPS_SCRIPT_PROPERTY_KEYS.USER_EMAIL]),
  };
}

/**
 * Validates private JobOps identifiers without returning their values.
 *
 * @param {{SPREADSHEET_ID: string, USER_EMAIL: string}} properties
 * @returns {string[]}
 */
function getJobOpsScriptPropertyErrors_(properties) {
  const errors = [];
  const spreadsheetId = normalizeJobOpsText_(properties.SPREADSHEET_ID);
  const userEmail = normalizeJobOpsText_(properties.USER_EMAIL);

  if (!/^[A-Za-z0-9_-]{20,}$/u.test(spreadsheetId)) {
    errors.push('Script Property SPREADSHEET_ID is missing or invalid.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(userEmail)) {
    errors.push('Script Property USER_EMAIL is missing or invalid.');
  }

  return errors;
}

/**
 * Throws when required Script Properties are unavailable.
 *
 * @param {{SPREADSHEET_ID: string, USER_EMAIL: string}} properties
 */
function assertValidJobOpsScriptProperties_(properties) {
  const errors = getJobOpsScriptPropertyErrors_(properties);

  if (errors.length > 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, errors.join(' '));
  }
}

/**
 * Reads editable configuration from the Config sheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object<string, *>}
 */
function readJobOpsConfig_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.CONFIG);

  if (!sheet) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      `Missing sheet ${JOBOPS_SHEET_NAMES.CONFIG}. Run setupJobOps first.`,
    );
  }

  return readJobOpsConfigFromValues_(sheet.getDataRange().getValues());
}

/**
 * Converts Config sheet values into a key-value object.
 *
 * @param {*[][]} values
 * @returns {Object<string, *>}
 */
function readJobOpsConfigFromValues_(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, 'Config sheet is empty.');
  }

  const headers = values[0].map(normalizeJobOpsText_);
  const keyIndex = headers.indexOf('KEY');
  const valueIndex = headers.indexOf('VALUE');

  if (keyIndex === -1 || valueIndex === -1) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      'Config sheet must contain KEY and VALUE columns.',
    );
  }

  const config = {};

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const key = normalizeJobOpsText_(row[keyIndex]).toUpperCase();

    if (!key) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(config, key)) {
      throw createJobOpsError_(
        JOBOPS_ERROR_CODES.CONFIGURATION,
        `Config contains duplicate key ${key}.`,
      );
    }

    config[key] = row[valueIndex];
  }

  return config;
}

/**
 * Returns the default editable configuration as a plain object.
 *
 * @returns {Object<string, *>}
 */
function buildDefaultJobOpsConfigMap_() {
  return JOBOPS_DEFAULT_CONFIG_ROWS.reduce((config, row) => {
    config[row[0]] = row[1];
    return config;
  }, {});
}

/**
 * Parses and validates the editable JobOps configuration.
 *
 * @param {Object<string, *>} rawConfig
 * @returns {Object<string, *>}
 */
function normalizeAndValidateJobOpsConfig_(rawConfig) {
  const errors = [];
  const config = {};

  for (const key of JOBOPS_REQUIRED_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(rawConfig, key)) {
      errors.push(`Missing Config key ${key}.`);
    }
  }

  config.TIMEZONE = normalizeJobOpsText_(rawConfig.TIMEZONE);
  if (config.TIMEZONE !== 'America/Bogota') {
    errors.push('TIMEZONE must be America/Bogota.');
  }

  for (const key of ['DIGEST_ENABLED', 'DRY_RUN']) {
    const parsed = parseJobOpsBoolean_(rawConfig[key]);
    if (!parsed.valid) {
      errors.push(`${key} must be true or false.`);
    } else {
      config[key] = parsed.value;
    }
  }

  const integerConstraints = {
    DIGEST_HOUR: [0, 23],
    FOLLOW_UP_BUSINESS_DAYS: [1, 30],
    MAX_MESSAGES_PER_RUN: [1, 500],
    MAX_DIGEST_JOBS: [1, 100],
    HIGH_PRIORITY_THRESHOLD: [-1000, 1000],
    REVIEW_THRESHOLD: [-1000, 1000],
    OPTIONAL_THRESHOLD: [-1000, 1000],
    LOOKBACK_DAYS: [1, 90],
  };

  for (const key of Object.keys(integerConstraints)) {
    const rawValue = rawConfig[key];
    const numberValue = Number(rawValue);
    const [minimum, maximum] = integerConstraints[key];

    if (
      normalizeJobOpsText_(rawValue) === '' ||
      !Number.isInteger(numberValue) ||
      numberValue < minimum ||
      numberValue > maximum
    ) {
      errors.push(`${key} must be an integer between ${minimum} and ${maximum}.`);
    } else {
      config[key] = numberValue;
    }
  }

  const rawRecruiterBonus = rawConfig.RECRUITER_SCORE_BONUS;
  const recruiterBonus = Number(rawRecruiterBonus);
  if (
    normalizeJobOpsText_(rawRecruiterBonus) === '' ||
    !Number.isFinite(recruiterBonus) ||
    recruiterBonus < -1000 ||
    recruiterBonus > 1000
  ) {
    errors.push('RECRUITER_SCORE_BONUS must be a number between -1000 and 1000.');
  } else {
    config.RECRUITER_SCORE_BONUS = recruiterBonus;
  }

  if (
    Number.isFinite(config.HIGH_PRIORITY_THRESHOLD) &&
    Number.isFinite(config.REVIEW_THRESHOLD) &&
    Number.isFinite(config.OPTIONAL_THRESHOLD) &&
    !(
      config.HIGH_PRIORITY_THRESHOLD > config.REVIEW_THRESHOLD &&
      config.REVIEW_THRESHOLD > config.OPTIONAL_THRESHOLD
    )
  ) {
    errors.push(
      'Priority thresholds must satisfy HIGH_PRIORITY_THRESHOLD > REVIEW_THRESHOLD > OPTIONAL_THRESHOLD.',
    );
  }

  if (errors.length > 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, errors.join(' '));
  }

  return config;
}

/**
 * Parses a spreadsheet boolean without accepting ambiguous values.
 *
 * @param {*} value
 * @returns {{valid: boolean, value: boolean}}
 */
function parseJobOpsBoolean_(value) {
  if (value === true || value === false) {
    return { valid: true, value };
  }

  const text = normalizeJobOpsText_(value).toLowerCase();
  if (text === 'true') {
    return { valid: true, value: true };
  }
  if (text === 'false') {
    return { valid: true, value: false };
  }

  return { valid: false, value: false };
}

/**
 * Checks whether a status can be stored in Jobs.STATUS.
 *
 * @param {*} status
 * @returns {boolean}
 */
function isValidJobOpsStatus_(status) {
  return JOBOPS_APPLICATION_STATUSES.includes(normalizeJobOpsText_(status).toUpperCase());
}

/**
 * Rejects invalid application statuses.
 *
 * @param {*} status
 */
function assertValidJobOpsStatus_(status) {
  if (!isValidJobOpsStatus_(status)) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      `Invalid application status: ${normalizeJobOpsText_(status) || '(empty)'}.`,
    );
  }
}
