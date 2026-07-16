const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('default configuration is valid and typed', () => {
  const context = loadJobOpsContext();
  const rawConfig = context.buildDefaultJobOpsConfigMap_();
  const config = context.normalizeAndValidateJobOpsConfig_(rawConfig);

  assert.equal(config.TIMEZONE, 'America/Bogota');
  assert.equal(config.DIGEST_ENABLED, true);
  assert.equal(config.DIGEST_HOUR, 8);
  assert.equal(config.RECRUITER_SCORE_BONUS, 5);
  assert.equal(config.DRY_RUN, false);
});

test('invalid booleans and threshold order are rejected together', () => {
  const context = loadJobOpsContext();
  const rawConfig = context.buildDefaultJobOpsConfigMap_();
  rawConfig.DIGEST_ENABLED = 'sometimes';
  rawConfig.REVIEW_THRESHOLD = 20;

  assert.throws(
    () => context.normalizeAndValidateJobOpsConfig_(rawConfig),
    (error) =>
      error.code === 'CONFIGURATION_ERROR' &&
      error.message.includes('DIGEST_ENABLED') &&
      error.message.includes('Priority thresholds'),
  );
});

test('blank numeric configuration is not silently converted to zero', () => {
  const context = loadJobOpsContext();
  const rawConfig = context.buildDefaultJobOpsConfigMap_();
  rawConfig.DIGEST_HOUR = '';
  rawConfig.RECRUITER_SCORE_BONUS = '   ';

  assert.throws(
    () => context.normalizeAndValidateJobOpsConfig_(rawConfig),
    (error) =>
      error.code === 'CONFIGURATION_ERROR' &&
      error.message.includes('DIGEST_HOUR') &&
      error.message.includes('RECRUITER_SCORE_BONUS'),
  );
});

test('Config rows are read by header name and duplicate keys are rejected', () => {
  const context = loadJobOpsContext();
  const values = [
    ['DESCRIPTION', 'VALUE', 'KEY'],
    ['Timezone', 'America/Bogota', 'TIMEZONE'],
    ['Duplicate', 'UTC', 'timezone'],
  ];

  assert.throws(
    () => context.readJobOpsConfigFromValues_(values),
    (error) => error.code === 'CONFIGURATION_ERROR' && error.message.includes('duplicate key'),
  );
});

test('Script Properties and application statuses are validated conservatively', () => {
  const context = loadJobOpsContext();

  assert.deepEqual(
    Array.from(
      context.getJobOpsScriptPropertyErrors_({
        SPREADSHEET_ID: 'short',
        USER_EMAIL: 'invalid',
      }),
    ),
    [
      'Script Property SPREADSHEET_ID is missing or invalid.',
      'Script Property USER_EMAIL is missing or invalid.',
    ],
  );
  assert.equal(context.isValidJobOpsStatus_('applied'), true);
  assert.equal(context.isValidJobOpsStatus_('pending'), false);
});
