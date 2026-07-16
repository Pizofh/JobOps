const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('deduplication accepts only exact message IDs, keys, or canonical URLs', () => {
  const context = loadJobOpsContext();
  const headers = ['GMAIL_MESSAGE_ID', 'DEDUPLICATION_KEY', 'JOB_URL'];
  const index = context.buildJobOpsDeduplicationIndex_(headers, [
    [
      'message-1',
      'URL:https://jobs.example/jobs/123',
      'https://jobs.example/jobs/123?utm_source=x',
    ],
  ]);

  assert.equal(
    context.isDuplicateJobOpsCandidate_(
      { jobUrl: 'https://jobs.example/jobs/123?ref=email' },
      index,
    ),
    true,
  );
  assert.equal(context.isDuplicateJobOpsCandidate_({ messageId: 'message-1' }, index), true);
  assert.equal(
    context.isDuplicateJobOpsCandidate_({ jobUrl: 'https://jobs.example/jobs/124' }, index),
    false,
  );
  assert.equal(context.buildJobOpsJobId_('message-1'), context.buildJobOpsJobId_('message-1'));
});

test('deduplication uses source job IDs and merges a second source without changing manual fields', () => {
  const context = loadJobOpsContext();
  const headers = [
    'JOB_ID',
    'DISCOVERED_AT',
    'LAST_UPDATED_AT',
    'SOURCE',
    'ALL_SOURCES',
    'SOURCE_JOB_ID',
    'COMPANY',
    'POSITION',
    'LOCATION',
    'WORK_MODE',
    'JOB_URL',
    'REQUIRED_TECHNOLOGIES',
    'GMAIL_MESSAGE_ID',
    'DEDUPLICATION_KEY',
    'STATUS',
    'APPLIED_DATE',
    'FOLLOW_UP_DATE',
    'NOTES',
  ];
  const existing = {
    JOB_ID: 'JOB-1',
    DISCOVERED_AT: new Date('2026-07-10T10:00:00.000Z'),
    LAST_UPDATED_AT: new Date('2026-07-10T10:00:00.000Z'),
    SOURCE: 'LinkedIn',
    ALL_SOURCES: 'LinkedIn',
    SOURCE_JOB_ID: 'linkedin-100',
    COMPANY: 'Acme Labs',
    POSITION: 'DevOps Engineer',
    LOCATION: 'UNKNOWN',
    WORK_MODE: 'UNKNOWN',
    JOB_URL: 'https://jobs.example/jobs/100?utm_source=linkedin',
    REQUIRED_TECHNOLOGIES: 'Linux, Docker',
    GMAIL_MESSAGE_ID: 'message-linkedin-100',
    DEDUPLICATION_KEY: 'SOURCE:linkedin|linkedin-100',
    STATUS: 'APPLIED',
    APPLIED_DATE: '2026-07-11',
    FOLLOW_UP_DATE: '2026-07-18',
    NOTES: 'Manual note',
  };
  const rows = [headers.map((header) => existing[header] || '')];
  const index = context.buildJobOpsDeduplicationIndex_(headers, rows);
  const incoming = {
    ...existing,
    ALL_SOURCES: 'Indeed',
    SOURCE: 'Indeed',
    SOURCE_JOB_ID: 'indeed-900',
    LOCATION: 'Bogota, Colombia',
    WORK_MODE: 'REMOTE',
    REQUIRED_TECHNOLOGIES: 'Docker, Terraform',
    GMAIL_MESSAGE_ID: 'message-indeed-900',
    LAST_UPDATED_AT: new Date('2026-07-12T10:00:00.000Z'),
  };
  const candidate = {
    messageId: incoming.GMAIL_MESSAGE_ID,
    jobUrl: incoming.JOB_URL,
    source: incoming.SOURCE,
    sourceJobId: incoming.SOURCE_JOB_ID,
    deduplicationKey: context.buildJobOpsDeduplicationKey_({
      source: incoming.SOURCE,
      sourceJobId: incoming.SOURCE_JOB_ID,
      jobUrl: incoming.JOB_URL,
      messageId: incoming.GMAIL_MESSAGE_ID,
    }),
  };

  assert.equal(candidate.deduplicationKey, 'SOURCE:indeed|indeed-900');
  const match = context.findJobOpsDuplicateMatch_(candidate, index);
  assert.equal(match.type, 'jobUrl');

  const merged = context.mergeJobOpsDuplicateRecord_(match.target.record, incoming);
  assert.equal(merged.ALL_SOURCES, 'LinkedIn, Indeed');
  assert.equal(merged.LOCATION, 'Bogota, Colombia');
  assert.equal(merged.WORK_MODE, 'REMOTE');
  assert.equal(merged.REQUIRED_TECHNOLOGIES, 'Linux, Docker, Terraform');
  assert.equal(merged.STATUS, 'APPLIED');
  assert.equal(merged.APPLIED_DATE, '2026-07-11');
  assert.equal(merged.FOLLOW_UP_DATE, '2026-07-18');
  assert.equal(merged.NOTES, 'Manual note');
});
