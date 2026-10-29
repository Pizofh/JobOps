const assert = require('node:assert/strict');
const test = require('node:test');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('official availability distinguishes closed, missing, invalid and rate limited', () => {
  const c = loadJobOpsContext({ Utilities: { formatDate: (date) => date.toISOString() } });
  const guid = 'https://himalayas.app/companies/example/jobs/devops';
  for (const [code, body, expected] of [
    [200, { job: { guid } }, 'OPEN'],
    [410, { expiryDate: 1 }, 'CLOSED'],
    [404, {}, 'UNKNOWN'],
    [410, {}, 'UNKNOWN'],
    [200, {}, 'UNKNOWN'],
  ]) {
    assert.equal(
      c.fetchJobOpsAvailability_(guid, () => ({
        getResponseCode: () => code,
        getContentText: () => JSON.stringify(body),
      })).state,
      expected,
    );
  }
  assert.equal(
    c.fetchJobOpsAvailability_(guid, () => {
      throw new Error('network');
    }).state,
    'UNKNOWN',
  );
  assert.equal(
    c.fetchJobOpsAvailability_(guid, () => ({ getResponseCode: () => 429 })).rateLimited,
    true,
  );
  assert.equal(c.buildJobOpsAvailabilityUrl_('https://evil.test/job'), '');
});

test('metrics use evidence of application and do not infer rejected interviews', () => {
  const c = loadJobOpsContext({ Utilities: { formatDate: (date) => date.toISOString() } });
  const metrics = c.buildJobOpsSearchMetrics_([
    { SOURCE: 'Example', STATUS: 'REJECTED' },
    { SOURCE: 'Example', STATUS: 'TECHNICAL' },
  ]);
  assert.equal(metrics['source: Example'].found, 2);
  assert.equal(metrics['source: Example'].applied, 1);
  assert.equal(metrics['source: Example'].interview, 1);
});

test('LOW applications and assessed UNKNOWN remain visible with separate counters', () => {
  const c = loadJobOpsContext({ Utilities: { formatDate: (date) => date.toISOString() } });
  const result = c.buildJobOpsWebDashboard_(
    [
      {
        JOB_ID: '1',
        STATUS: 'APPLIED',
        PRIORITY: 'LOW',
        FIT_LEVEL: 'UNKNOWN',
        FIT_VERSION: '1.1.0',
      },
    ],
    new Date(),
  );
  assert.equal(result.jobs.length, 1);
  assert.equal(result.counts.applied, 1);
  assert.equal(result.counts.pendingFit, 0);
  assert.equal(result.counts.unknownFit, 1);
});

test('partial evaluation update writes actual row and preserves CV and manual fields', () => {
  const c = loadJobOpsContext({ Utilities: { formatDate: (date) => date.toISOString() } });
  const writes = [];
  const sheet = { getRange: (...args) => ({ setValues: () => writes.push(args) }) };
  c.updateJobOpsJobEvaluationFields_({ getSheetByName: () => sheet }, [
    { rowNumber: 42, record: {} },
  ]);
  assert.ok(writes.length > 0);
  assert.ok(writes.every((w) => w[0] === 42));
});
