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
