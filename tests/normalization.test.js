const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('normalization produces readable text and conservative canonical URLs', () => {
  const context = loadJobOpsContext();

  assert.equal(
    context.jobOpsHtmlToText_('<p>Hello&nbsp;<b>world</b></p><script>x()</script>'),
    'Hello world',
  );
  assert.equal(
    context.canonicalizeJobOpsUrl_(
      'HTTPS://Jobs.Example/positions/123?utm_source=email&team=platform&trackingId=abc#details',
    ),
    'https://jobs.example/positions/123?team=platform',
  );
  assert.equal(context.detectJobOpsWorkMode_('Modalidad: híbrida'), 'HYBRID');
  assert.deepEqual(
    Array.from(context.extractJobOpsTechnologies_('Linux, Docker, Terraform and AWS')),
    ['Linux', 'Docker', 'AWS', 'Terraform'],
  );
});

test('forwarded metadata preserves the original professional sender', () => {
  const context = loadJobOpsContext();
  const metadata = context.extractJobOpsForwardedMetadata_(
    '---------- Forwarded message ---------\nFrom: Recruiter <person@example.test>\nSubject: DevOps opportunity',
  );

  assert.equal(metadata.forwarded, true);
  assert.equal(metadata.from, 'Recruiter <person@example.test>');
  assert.equal(metadata.subject, 'DevOps opportunity');
});
