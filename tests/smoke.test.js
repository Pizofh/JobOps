const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

const entrypointNames = [
  'setupJobOps',
  'installJobOpsTriggers',
  'ingestJobs',
  'sendDailyDigest',
  'handleStatusEdit',
  'rescoreJobs',
  'dryRunIngestion',
  'validateJobOpsConfiguration',
];

test('Apps Script sources load without accessing Google services at file load time', () => {
  const context = loadJobOpsContext();

  for (const name of entrypointNames) {
    assert.equal(typeof context[name], 'function', `${name} must be globally accessible`);
  }
});

test('entrypoints reserved for later phases remain inert', () => {
  const context = loadJobOpsContext();
  const inertEntrypoints = ['installJobOpsTriggers', 'sendDailyDigest'];

  for (const name of inertEntrypoints) {
    assert.equal(context[name](), undefined, `${name} must remain inert`);
  }

  assert.equal(context.handleStatusEdit({}), undefined);
});
