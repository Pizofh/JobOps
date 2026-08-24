const assert = require('node:assert/strict');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('salary floor uses the maximum published COP range value', () => {
  const context = loadJobOpsContext();

  assert.equal(context.isJobOpsCopSalaryBelowMinimum_('$4.900.000', 5000000), true);
  assert.equal(context.isJobOpsCopSalaryBelowMinimum_('$5.000.000', 5000000), false);
  assert.equal(
    context.isJobOpsCopSalaryBelowMinimum_('$4.500.000 - $5.500.000 por mes', 5000000),
    false,
  );
  assert.equal(
    context.isJobOpsCopSalaryBelowMinimum_('$4.000.000 - $4.900.000 por mes', 5000000),
    true,
  );
  assert.equal(context.isJobOpsCopSalaryBelowMinimum_('', 5000000), false);
  assert.equal(context.isJobOpsCopSalaryBelowMinimum_('USD 1,500 monthly', 5000000), false);
});

test('setup migrates only the untouched salary-floor rule', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  const first = context.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('ScoringRules');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const row = values.find((candidate) => candidate[0] === 'RISK_COP_BELOW_6M');

  assert.equal(first.spreadsheet.migratedSalaryFloorRule, true);
  assert.equal(row[headers.indexOf('PATTERN')], '__COP_BELOW_5M_SMART_RANGE__');
  assert.equal(row[headers.indexOf('RISK_FLAG')], 'COP_BELOW_5M');

  const second = context.setupJobOps();
  assert.equal(second.spreadsheet.migratedSalaryFloorRule, false);
});
