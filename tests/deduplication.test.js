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
