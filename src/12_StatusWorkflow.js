/**
 * Adds business days without changing the input date.
 *
 * @param {Date} startDate
 * @param {number} businessDays
 * @returns {Date}
 */
function addJobOpsBusinessDays_(startDate, businessDays) {
  const result = new Date(startDate.getTime());
  let remaining = Math.max(0, Number(businessDays) || 0);

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return result;
}

/**
 * Calculates only missing dates for a transition to APPLIED.
 *
 * @param {string[]} headers
 * @param {*[]} row
 * @param {*} newStatus
 * @param {Date} now
 * @param {number} followUpBusinessDays
 * @returns {{appliedDate: Date|null, followUpDate: Date|null}}
 */
function getJobOpsAppliedDateUpdates_(headers, row, newStatus, now, followUpBusinessDays) {
  if (normalizeJobOpsSingleLineText_(newStatus).toUpperCase() !== 'APPLIED') {
    return { appliedDate: null, followUpDate: null };
  }

  const appliedIndex = headers.indexOf('APPLIED_DATE');
  const followUpIndex = headers.indexOf('FOLLOW_UP_DATE');
  const appliedDate = appliedIndex === -1 ? '' : row[appliedIndex];
  const followUpDate = followUpIndex === -1 ? '' : row[followUpIndex];
  const initialDate = isJobOpsUsableDate_(appliedDate)
    ? new Date(appliedDate)
    : new Date(now.getTime());

  return {
    appliedDate: isJobOpsUsableDate_(appliedDate) ? null : initialDate,
    followUpDate: isJobOpsUsableDate_(followUpDate)
      ? null
      : addJobOpsBusinessDays_(initialDate, followUpBusinessDays),
  };
}

/**
 * Checks whether a Sheets value represents a valid date.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isJobOpsUsableDate_(value) {
  if (normalizeJobOpsSingleLineText_(value) === '') {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Handles one installed onEdit event without scanning the spreadsheet.
 *
 * @param {GoogleAppsScript.Events.SheetsOnEdit} event
 * @returns {Object|undefined}
 */
function runJobOpsStatusEdit_(event) {
  const range = event && event.range;
  if (!range) {
    return undefined;
  }

  const sheet = range.getSheet();
  if (sheet.getName() !== JOBOPS_SHEET_NAMES.JOBS || range.getRow() <= 1) {
    return undefined;
  }

  const headers = JOBOPS_SHEET_HEADERS.Jobs;
  const statusColumn = getJobOpsColumnNumber_(headers, 'STATUS');
  if (range.getColumn() !== statusColumn) {
    return undefined;
  }

  const status = event.value === undefined ? range.getValue() : event.value;
  if (normalizeJobOpsSingleLineText_(status).toUpperCase() !== 'APPLIED') {
    return undefined;
  }

  const row = sheet.getRange(range.getRow(), 1, 1, headers.length).getValues()[0];
  const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(range.getSheet().getParent()));
  const updates = getJobOpsAppliedDateUpdates_(
    headers,
    row,
    status,
    new Date(),
    config.FOLLOW_UP_BUSINESS_DAYS,
  );

  if (updates.appliedDate) {
    sheet
      .getRange(range.getRow(), getJobOpsColumnNumber_(headers, 'APPLIED_DATE'))
      .setValue(updates.appliedDate);
  }
  if (updates.followUpDate) {
    sheet
      .getRange(range.getRow(), getJobOpsColumnNumber_(headers, 'FOLLOW_UP_DATE'))
      .setValue(updates.followUpDate);
  }

  return { updated: Boolean(updates.appliedDate || updates.followUpDate) };
}
