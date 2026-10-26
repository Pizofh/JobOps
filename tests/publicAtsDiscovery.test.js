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


test('automatic discovery works without any company board configuration', () => {
  const context = loadJobOpsContext();
  assert.equal(context.buildJobOpsHimalayasSearchUrl_('devops'),
    'https://himalayas.app/jobs/api/search?q=devops&country=CO&sort=recent&page=1');
  assert.throws(() => context.buildJobOpsHimalayasSearchUrl_('random-injected-query'));

  const responses = [{
    guid: 'https://himalayas.app/companies/example/jobs/devops-engineer',
    title: 'DevOps Engineer',
    companyName: 'Example Cloud',
    applicationLink: 'https://himalayas.app/companies/example/jobs/devops-engineer',
    description: '<p>Linux Docker Terraform</p>',
    locationRestrictions: ['Colombia', 'Mexico'],
    expiryDate: 2090000000,
    currency: 'USD',
    minSalary: 30000,
    maxSalary: 50000,
    salaryPeriod: 'annual',
  }];
  const parsed = context.fetchJobOpsHimalayasJobs_('devops', () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({jobs: responses}),
  }));
  assert.equal(parsed.length, 1);
  const job = context.normalizeJobOpsHimalayasPosting_(parsed[0]);
  assert.equal(job.source, 'Himalayas');
  assert.equal(job.company, 'Example Cloud');
  assert.equal(job.workMode, 'REMOTE');
  assert.equal(job.salary, 'USD 30000 - 50000 / annual');
  assert.equal(job.jobUrl, 'https://himalayas.app/companies/example/jobs/devops-engineer');
  assert.equal(job.location, 'Remote: Colombia, Mexico');
  assert.ok(job.requiredTechnologies.includes('Docker'));
});

test('automatic discovery refuses rate-limited calls and invalid records', () => {
  const context = loadJobOpsContext();
  let calls = 0;
  assert.throws(() => context.fetchJobOpsHimalayasJobs_('cloud engineer', () => {
    calls++;
    return {getResponseCode: () => 429};
  }), /HTTP 429/u);
  assert.equal(calls, 1);
  assert.equal(context.normalizeJobOpsHimalayasPosting_({title: 'Cloud Engineer'}), null);
});
