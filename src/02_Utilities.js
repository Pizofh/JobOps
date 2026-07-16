/**
 * Creates an error with a stable JobOps code.
 *
 * @param {string} code
 * @param {string} message
 * @param {Object=} details
 * @returns {Error}
 */
function createJobOpsError_(code, message, details) {
  const error = new Error(`[${code}] ${message}`);
  error.name = 'JobOpsError';
  error.code = code;

  if (details) {
    error.details = details;
  }

  return error;
}

/**
 * Converts a value to trimmed text without treating zero or false as empty.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeJobOpsText_(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

/**
 * Returns the one-based position of a required header.
 *
 * @param {string[]} headers
 * @param {string} headerName
 * @returns {number}
 */
function getJobOpsColumnNumber_(headers, headerName) {
  const index = headers.indexOf(headerName);

  if (index === -1) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      `Missing required column ${headerName}.`,
    );
  }

  return index + 1;
}

/**
 * Redacts a value while leaving enough characters for diagnostics.
 *
 * @param {*} value
 * @returns {string}
 */
function redactJobOpsValue_(value) {
  const text = normalizeJobOpsText_(value);

  if (text.length <= 8) {
    return '********';
  }

  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}
