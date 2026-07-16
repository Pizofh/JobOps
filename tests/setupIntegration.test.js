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
