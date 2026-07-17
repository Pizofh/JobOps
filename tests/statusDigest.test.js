const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

function loadDigestContext() {
  return loadJobOpsContext({
    Utilities: {
      formatDate(date) {
        return date.toISOString().slice(0, 10);
      },
    },
  });
}

test('application workflow adds only missing dates using business days', () => {
  const context = loadDigestContext();
  const headers = ['STATUS', 'APPLIED_DATE', 'FOLLOW_UP_DATE'];
  const updates = context.getJobOpsAppliedDateUpdates_(
    headers,
    ['APPLIED', '', ''],
    'APPLIED',
    new Date('2026-07-10T12:00:00.000Z'),
    5,
  );

  assert.equal(updates.appliedDate.toISOString().slice(0, 10), '2026-07-10');
  assert.equal(updates.followUpDate.toISOString().slice(0, 10), '2026-07-17');
  const preserved = context.getJobOpsAppliedDateUpdates_(
    headers,
    ['APPLIED', '2026-07-01', '2026-07-08'],
    'APPLIED',
    new Date('2026-07-10T12:00:00.000Z'),
    5,
  );
  assert.equal(preserved.appliedDate, null);
  assert.equal(preserved.followUpDate, null);
});

test('daily digest selects useful sections and omits email bodies', () => {
  const context = loadDigestContext();
  const sections = context.selectJobOpsDigestSections_(
    [
      {
        STATUS: 'NEW',
        PRIORITY: 'HIGH',
        MATCH_SCORE: 18,
        POSITION: 'DevOps Engineer',
        COMPANY: 'Acme',
        SOURCE: 'LinkedIn',
        DISCOVERED_AT: '2026-07-16T10:00:00.000Z',
        JOB_URL: 'https://jobs.example/1',
      },
      {
        STATUS: 'APPLIED',
        PRIORITY: 'REVIEW',
        FOLLOW_UP_DATE: '2026-07-15T10:00:00.000Z',
        POSITION: 'Cloud Support Engineer',
        COMPANY: 'Nube',
      },
      {
        STATUS: 'NEW',
        PRIORITY: 'REVIEW',
        MATCH_SCORE: 10,
        POSITION: 'Platform Engineer',
        COMPANY: 'Northstar',
        SOURCE: 'Recruiter',
        RECRUITER_EMAIL: 'recruiter@example.test',
      },
    ],
    [
      {
        DETECTED_SOURCE: 'Indeed',
        SUBJECT: 'Alert error',
        ERROR_TYPE: 'PARSER_ERROR',
        RESOLVED: false,
      },
    ],
    { MAX_DIGEST_JOBS: 10, TIMEZONE: 'America/Bogota' },
    new Date('2026-07-16T12:00:00.000Z'),
  );
  const digest = context.buildJobOpsDigest_(
    sections,
    new Date('2026-07-16T12:00:00.000Z'),
    'America/Bogota',
  );

  assert.equal(sections.jobs.length, 2);
  assert.equal(sections.recruiters.length, 1);
  assert.equal(sections.followUps.length, 1);
  assert.equal(sections.errors.length, 1);
  assert.equal(digest.hasContent, true);
  assert.match(digest.htmlBody, /Nuevas oportunidades prioritarias/);
  assert.match(digest.htmlBody, /Seguimientos vencidos/);
  assert.match(digest.plainBody, /PARSER_ERROR/);
});
