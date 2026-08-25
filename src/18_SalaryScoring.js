/* global matchesJobOpsScoringRule_ */

const JOBOPS_LEGACY_SALARY_RULE_ID = 'RISK_COP_BELOW_6M';
const JOBOPS_LEGACY_SALARY_PATTERN =
  '(?:cop\\s*\\$?\\s*(?:[1-5]\\d{6}|[1-5](?:[.,]\\d{3}){2}|[1-5](?:[.,]\\d+)?\\s*(?:m|millones?))|(?:[1-5]\\d{6}|[1-5](?:[.,]\\d{3}){2}|[1-5](?:[.,]\\d+)?\\s*(?:m|millones?))\\s*cop)';
const JOBOPS_SMART_SALARY_PATTERN = '__COP_BELOW_5M_SMART_RANGE__';
const JOBOPS_MINIMUM_ACCEPTABLE_COP = 5000000;

/**
 * Uses range-aware salary evaluation for the migrated compensation rule while
 * leaving every other editable scoring rule on the generic matcher.
 *
 * @param {Object} rule
 * @param {Object} job
 * @param {Object<string, string>} contextText
 * @returns {boolean}
 */
function shouldApplyJobOpsScoringRule_(rule, job, contextText) {
  if (rule.riskFlag === 'COP_BELOW_5M') {
    return isJobOpsCopSalaryBelowMinimum_(job.salary, JOBOPS_MINIMUM_ACCEPTABLE_COP);
  }

  return matchesJobOpsScoringRule_(rule, contextText[rule.context]);
}

/**
 * Penalizes only known COP-like monthly salaries whose highest published value
 * is below the configured floor. Unknown salary and ranges reaching the floor
 * are intentionally not penalized.
 *
 * @param {*} salary
 * @param {number} minimumCop
 * @returns {boolean}
 */
function isJobOpsCopSalaryBelowMinimum_(salary, minimumCop) {
  const text = normalizeJobOpsSingleLineText_(salary).toLowerCase();
  if (!text) {
    return false;
  }

  if (/\b(?:usd|eur|gbp)\b|us\$|€|£/iu.test(text)) {
    return false;
  }

  if (!/\bcop\b|\$|\b(?:m|millones?)\b/iu.test(text)) {
    return false;
  }

  const amounts = extractJobOpsCopSalaryAmounts_(text);
  if (amounts.length === 0) {
    return false;
  }

  return Math.max(...amounts) < minimumCop;
}

/**
 * Extracts plausible COP monthly amounts from common Indeed formats such as
 * "$5.400.000 - $8.600.000" and "4,5 millones".
 *
 * @param {string} text
 * @returns {number[]}
 */
function extractJobOpsCopSalaryAmounts_(text) {
  const amounts = [];
  const millionPattern = /(\d+(?:[.,]\d+)?)\s*(?:m|millones?)/giu;
  let match;

  while ((match = millionPattern.exec(text)) !== null) {
    const millions = Number(match[1].replace(',', '.'));
    if (Number.isFinite(millions)) {
      amounts.push(Math.round(millions * 1000000));
    }
  }

  const fullAmountPattern = /\b(?:\d{1,3}(?:[.,]\d{3}){2,}|\d{7,})\b/gu;
  while ((match = fullAmountPattern.exec(text)) !== null) {
    const amount = Number(match[0].replace(/[.,]/gu, ''));
    if (Number.isFinite(amount) && amount >= 1000000) {
      amounts.push(amount);
    }
  }

  return amounts;
}

/**
 * Migrates only the untouched 6M salary-floor rule. The stable legacy RULE_ID
 * is kept to avoid duplicate seed rows; the visible risk flag and behavior move
 * to the new 5M floor. User-customized versions are preserved.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {boolean}
 */
function migrateJobOpsSalaryFloorRule_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.SCORING_RULES);
  if (!sheet) {
    return false;
  }

  const values = sheet.getDataRange().getValues();
  const indexes = getJobOpsRequiredHeaderIndexes_(values, [
    'RULE_ID',
    'PATTERN',
    'MATCH_TYPE',
    'CONTEXT',
    'SCORE',
    'RISK_FLAG',
    'ENABLED',
  ]);
  const notesIndex = getJobOpsOptionalHeaderIndex_(values, 'NOTES');
  const groupIndex = getJobOpsOptionalHeaderIndex_(values, 'GROUP');
  const rowIndex = values.findIndex(
    (row, index) =>
      index > 0 &&
      normalizeJobOpsSingleLineText_(row[indexes.RULE_ID]) === JOBOPS_LEGACY_SALARY_RULE_ID,
  );
  if (rowIndex === -1) {
    return false;
  }

  const row = values[rowIndex];
  const currentPattern = normalizeJobOpsSingleLineText_(row[indexes.PATTERN]);
  const currentRiskFlag = normalizeJobOpsSingleLineText_(row[indexes.RISK_FLAG]);
  if (currentPattern === JOBOPS_SMART_SALARY_PATTERN && currentRiskFlag === 'COP_BELOW_5M') {
    return false;
  }

  const currentNotes = notesIndex === -1 ? '' : normalizeJobOpsSingleLineText_(row[notesIndex]);
  const currentGroup = groupIndex === -1 ? '' : normalizeJobOpsSingleLineText_(row[groupIndex]);
  const hasStandardMetadata =
    (!currentNotes ||
      currentNotes === 'Compensación publicada inferior al mínimo absoluto mensual.') &&
    (!currentGroup || currentGroup === 'COMPENSATION');
  const untouchedLegacyRule =
    (currentPattern === JOBOPS_LEGACY_SALARY_PATTERN || hasStandardMetadata) &&
    normalizeJobOpsSingleLineText_(row[indexes.MATCH_TYPE]).toUpperCase() === 'REGEX' &&
    normalizeJobOpsSingleLineText_(row[indexes.CONTEXT]).toUpperCase() === 'ANY' &&
    Number(row[indexes.SCORE]) === -12 &&
    currentRiskFlag === 'COP_BELOW_6M' &&
    parseJobOpsLooseBoolean_(row[indexes.ENABLED]);
  if (!untouchedLegacyRule) {
    return false;
  }

  const patternCell = sheet.getRange(rowIndex + 1, indexes.PATTERN + 1);
  patternCell.setValues([[JOBOPS_SMART_SALARY_PATTERN]]);
  const riskFlagCell = sheet.getRange(rowIndex + 1, indexes.RISK_FLAG + 1);
  riskFlagCell.setValues([['COP_BELOW_5M']]);
  if (notesIndex !== -1) {
    const notesCell = sheet.getRange(rowIndex + 1, notesIndex + 1);
    notesCell.setValues([
      [
        'Compensación COP: penaliza solo si el máximo publicado del rango es inferior a 5M mensuales.',
      ],
    ]);
  }
  return true;
}
