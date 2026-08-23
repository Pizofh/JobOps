const JOBOPS_STRATEGIC_LEVEL_SCORE_BONUSES = Object.freeze({
  DIRECT: 6,
  BRIDGE: 4,
  SECONDARY: 1,
  UNRELATED: 0,
});

const JOBOPS_LEGACY_ENTRY_LEVEL_PATTERN =
  '\\b(?:junior|jr\\.?|associate|analyst|engineer i|level 1|entry level)\\b';
const JOBOPS_ENTRY_LEVEL_PATTERN =
  '\\b(?:junior|jr\\.?|associate|analyst|engineer i|level 1|entry level|intern(?:ship)?|trainee|practicante)\\b';

/**
 * Gives target role families a small transparent baseline so sparse job-alert
 * emails can still be prioritized before opening the full posting.
 *
 * @param {*} strategicLevel
 * @returns {number}
 */
function getJobOpsStrategicLevelScoreBonus_(strategicLevel) {
  const level = normalizeJobOpsSingleLineText_(strategicLevel).toUpperCase();
  return JOBOPS_STRATEGIC_LEVEL_SCORE_BONUSES[level] || 0;
}

/**
 * Migrates only the untouched BONUS_JUNIOR rule. User-customized scoring rules
 * are deliberately preserved.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {boolean}
 */
function migrateJobOpsEntryLevelScoringRule_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(JOBOPS_SHEET_NAMES.SCORING_RULES);
  if (!sheet) {
    return false;
  }

  const values = sheet.getDataRange().getValues();
  const indexes = getJobOpsRequiredHeaderIndexes_(values, ['RULE_ID', 'PATTERN']);
  const rowIndex = values.findIndex(
    (row, index) =>
      index > 0 && normalizeJobOpsSingleLineText_(row[indexes.RULE_ID]) === 'BONUS_JUNIOR',
  );
  if (rowIndex === -1) {
    return false;
  }

  const currentPattern = normalizeJobOpsSingleLineText_(values[rowIndex][indexes.PATTERN]);
  if (currentPattern === JOBOPS_ENTRY_LEVEL_PATTERN) {
    return false;
  }
  if (currentPattern !== JOBOPS_LEGACY_ENTRY_LEVEL_PATTERN) {
    return false;
  }

  sheet.getRange(rowIndex + 1, indexes.PATTERN + 1).setValue(JOBOPS_ENTRY_LEVEL_PATTERN);
  return true;
}
