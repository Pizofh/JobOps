const assert = require('node:assert/strict');
const test = require('node:test');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('public ATS board configuration only accepts documented providers and bounded slugs', () => {
  const context = loadJobOpsContext();
  const header = ['ATS', 'BOARD', 'COMPANY', 'ENABLED'];
  const boards = context.parseJobOpsPublicAtsBoards_([
    header,
    ['GREENHOUSE', 'example', 'Example', true],
    ['LEVER', 'other-company', 'Other Company', 'true'],
    ['ASHBY', 'disabled', 'Disabled', false],
  ]);
  assert.equal(boards.length, 2);
  assert.equal(boards[0].ats, 'GREENHOUSE');
  assert.equal(boards[1].board, 'other-company');
  assert.throws(() =>
    context.parseJobOpsPublicAtsBoards_([header, ['GREENHOUSE', 'https://evil.com', 'Bad', true]]),
  );
  assert.throws(() =>
    context.parseJobOpsPublicAtsBoards_([header, ['OTHER', 'company', 'Bad', true]]),
  );
});

test('public ATS uses only fixed official HTTPS endpoints', () => {
  const context = loadJobOpsContext();
  assert.equal(
    context.buildJobOpsPublicAtsUrl_({ ats: 'GREENHOUSE', board: 'example' }),
    'https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true',
  );
  assert.equal(
    context.buildJobOpsPublicAtsUrl_({ ats: 'ASHBY', board: 'example' }),
    'https://api.ashbyhq.com/posting-api/job-board/example?includeCompensation=true',
  );
});

test('public ATS stops on a 429 without retrying', () => {
  const context = loadJobOpsContext();
  let calls = 0;
  assert.throws(
    () =>
      context.fetchJobOpsPublicAtsPostings_({ ats: 'LEVER', board: 'acme' }, () => {
        calls += 1;
        return { getResponseCode: () => 429 };
      }),
    /HTTP 429/u,
  );
  assert.equal(calls, 1);
});

test('public ATS parses Greenhouse and Lever job metadata', () => {
  const context = loadJobOpsContext();
  const greenhouse = context.normalizeJobOpsPublicAtsPosting_(
    { ats: 'GREENHOUSE', board: 'acme', company: 'Acme' },
    {
      id: 12345,
      title: 'DevOps Engineer',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/12345',
      location: { name: 'Bogotá, Colombia' },
      content: '<p>Linux and Terraform, 2+ years experience.</p>',
    },
  );
  assert.equal(greenhouse.sourceJobId, 'acme:12345');
  assert.equal(greenhouse.position, 'DevOps Engineer');
  assert.equal(greenhouse.company, 'Acme');
  assert.ok(greenhouse.requiredTechnologies.includes('Linux'));
  assert.equal(context.JOBOPS_PUBLIC_ATS_TITLE_PATTERN.test(greenhouse.position), true);

  const lever = context.normalizeJobOpsPublicAtsPosting_(
    { ats: 'LEVER', board: 'acme', company: 'Acme' },
    {
      id: 'abc123',
      text: 'Platform Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/abc123',
      categories: { location: 'Remote - LATAM' },
      workplaceType: 'remote',
      descriptionPlain: 'AWS cloud infrastructure and Docker',
    },
  );
  assert.equal(lever.workMode, 'REMOTE');
  assert.equal(lever.jobUrl, 'https://jobs.lever.co/acme/abc123');
});
