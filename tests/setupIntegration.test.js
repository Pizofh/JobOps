const assert = require('node:assert/strict');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('setupJobOps creates a usable environment and preserves manual edits on rerun', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);

  const first = context.setupJobOps();

  assert.equal(first.ok, true);
  assert.equal(first.phase, 1);
  assert.equal(first.spreadsheet.createdSheets.length, 7);
  assert.equal(first.gmailLabels.created.length, 4);
  assert.equal(first.validation.valid, true);
  assert.equal(services.spreadsheet.sheets.size, 7);

  const jobsSheet = services.spreadsheet.getSheetByName('Jobs');
  const configSheet = services.spreadsheet.getSheetByName('Config');
  assert.equal(jobsSheet.getLastColumn(), 32);
  assert.equal(jobsSheet.getConditionalFormatRules().length, 8);
  assert.equal(configSheet.getLastRow(), 13);

  const configValues = configSheet.getDataRange().getValues();
  const digestHourRowIndex = configValues.findIndex((row) => row[0] === 'DIGEST_HOUR') + 1;
  configSheet.getRange(digestHourRowIndex, 2).setValues([[9]]);

  const second = context.setupJobOps();

  assert.equal(second.spreadsheet.createdSheets.length, 0);
  assert.equal(second.gmailLabels.created.length, 0);
  assert.equal(second.gmailLabels.existing.length, 4);
  assert.equal(second.validation.valid, true);
  assert.equal(configSheet.getRange(digestHourRowIndex, 2).getValues()[0][0], 9);
  assert.equal(configSheet.getLastRow(), 13);
  assert.equal(jobsSheet.getConditionalFormatRules().length, 8);

  for (const seededCount of Object.values(second.spreadsheet.seededRows)) {
    assert.equal(seededCount, 0);
  }
});

test('setupJobOps upgrades old scoring dropdowns before writing strategy rules', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();

  const sheet = services.spreadsheet.getSheetByName('ScoringRules');
  const headers = sheet.getDataRange().getValues()[0];
  const contextColumn = headers.indexOf('CONTEXT') + 1;
  const oldRule = services.globals.SpreadsheetApp.newDataValidation()
    .requireValueInList(['ANY', 'REQUIRED', 'PREFERRED', 'NEGATIVE'], true)
    .setAllowInvalid(false)
    .build();
  sheet
    .getRange(2, contextColumn, sheet.getMaxRows() - 1, 1)
    .setDataValidations(Array.from({ length: sheet.getMaxRows() - 1 }, () => [oldRule]));

  const juniorRow = sheet
    .getDataRange()
    .getValues()
    .findIndex((row) => row[0] === 'BONUS_JUNIOR');
  sheet.getRange(juniorRow + 1, 1).setValues([['']]);

  assert.doesNotThrow(() => context.setupJobOps());
  assert.deepEqual(
    JSON.parse(JSON.stringify(sheet.getRange(2, contextColumn).getDataValidations()[0][0].values)),
    ['ANY', 'TITLE', 'REQUIRED', 'PREFERRED', 'NEGATIVE'],
  );
});
