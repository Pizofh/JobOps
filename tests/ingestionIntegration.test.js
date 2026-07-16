const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

function fixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', relativePath), 'utf8'));
}

test('ingestion dry run is immutable and real ingestion isolates message errors', () => {
  const generic = fixture('generic/linkedin-alert.json');
  const recruiter = fixture('recruiters/forwarded-hotmail.json');
  const malformed = fixture('malformed/indeed-missing-fields.json');
  const duplicate = {
    ...generic,
    messageId: 'generic-message-duplicate',
    threadId: 'generic-thread-duplicate',
  };
  const services = createFakeGoogleServices({
    gmailThreads: [generic, recruiter, malformed, duplicate].map((message) => ({
      threadId: message.threadId,
      messages: [message],
    })),
  });
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();

  const dryRun = context.dryRunIngestion();
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.wouldCreateJobs, 2);
  assert.equal(dryRun.createdJobs, 0);
  assert.equal(dryRun.parsingErrors, 1);
  assert.equal(dryRun.duplicates, 1);
  assert.equal(services.spreadsheet.getSheetByName('Jobs').getLastRow(), 1);
  assert.equal(services.spreadsheet.getSheetByName('ParsingErrors').getLastRow(), 1);
  for (const thread of services.threads) {
    assert.equal(thread.labelNames.size, 0);
  }

  const realRun = context.ingestJobs();
  assert.equal(realRun.dryRun, false);
  assert.equal(realRun.createdJobs, 2);
  assert.equal(realRun.parsingErrors, 1);
  assert.equal(realRun.duplicates, 1);

  const jobsSheet = services.spreadsheet.getSheetByName('Jobs');
  const jobValues = jobsSheet.getDataRange().getValues();
  const headers = jobValues[0];
  const recruiterRow = jobValues.find(
    (row, index) => index > 0 && row[headers.indexOf('SOURCE')] === 'Recruiter',
  );
  assert.ok(recruiterRow);
  assert.equal(recruiterRow[headers.indexOf('MATCH_SCORE')], 5);
  assert.equal(recruiterRow[headers.indexOf('RECRUITER_EMAIL')], 'ana@talent.example');
  assert.equal(jobsSheet.getLastRow(), 3);
  assert.equal(services.spreadsheet.getSheetByName('ParsingErrors').getLastRow(), 2);

  const recruiterThread = services.threads.find((thread) => thread.id === recruiter.threadId);
  const malformedThread = services.threads.find((thread) => thread.id === malformed.threadId);
  assert.equal(recruiterThread.labelNames.has('Jobs/Processed'), true);
  assert.equal(recruiterThread.labelNames.has('Jobs/Recruiters'), true);
  assert.equal(malformedThread.labelNames.has('Jobs/Failed'), true);

  const rerun = context.ingestJobs();
  assert.equal(rerun.candidateMessages, 0);
  assert.equal(rerun.createdJobs, 0);
  assert.equal(jobsSheet.getLastRow(), 3);
});

test('a later exact URL enriches the stored job and preserves manual spreadsheet fields', () => {
  const linkedIn = fixture('generic/linkedin-alert.json');
  const services = createFakeGoogleServices({
    gmailThreads: [{ threadId: linkedIn.threadId, messages: [linkedIn] }],
  });
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();
  context.ingestJobs();

  const jobsSheet = services.spreadsheet.getSheetByName('Jobs');
  const headers = jobsSheet.getDataRange().getValues()[0];
  jobsSheet.getRange(2, headers.indexOf('STATUS') + 1).setValues([['APPLIED']]);
  jobsSheet.getRange(2, headers.indexOf('APPLIED_DATE') + 1).setValues([['2026-07-15']]);
  jobsSheet.getRange(2, headers.indexOf('FOLLOW_UP_DATE') + 1).setValues([['2026-07-22']]);
  jobsSheet.getRange(2, headers.indexOf('NOTES') + 1).setValues([['Manual review note']]);

  const message = services.threads[0].messages[0].data;
  Object.assign(message, {
    subject: 'DevOps Engineer opportunity at Acme Labs',
    from: 'Ana Recruiter <ana@talent.example>',
    date: new Date('2026-07-16T14:30:00.000Z'),
    plainBody:
      'Position: DevOps Engineer\nCompany: Acme Labs\nLocation: Bogota, Colombia\nRemote role using Linux, Docker and Terraform.\nApply: https://www.linkedin.com/jobs/view/123456?currentJobId=123456',
    messageId: 'recruiter-duplicate-message-001',
  });
  services.threads[0].labelNames.clear();

  const result = context.ingestJobs();
  const values = jobsSheet.getDataRange().getValues();
  const row = values[1];

  assert.equal(result.createdJobs, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(jobsSheet.getLastRow(), 2);
  assert.equal(row[headers.indexOf('ALL_SOURCES')], 'LinkedIn, Recruiter');
  assert.equal(row[headers.indexOf('REQUIRED_TECHNOLOGIES')], 'Linux, Docker, AWS, Terraform');
  assert.equal(row[headers.indexOf('STATUS')], 'APPLIED');
  assert.equal(row[headers.indexOf('APPLIED_DATE')], '2026-07-15');
  assert.equal(row[headers.indexOf('FOLLOW_UP_DATE')], '2026-07-22');
  assert.equal(row[headers.indexOf('NOTES')], 'Manual review note');
});
