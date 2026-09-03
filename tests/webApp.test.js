const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

function makeRecord(overrides = {}) {
  return {
    JOB_ID: 'job-1',
    COMPANY: 'Example Co',
    POSITION: 'Platform Engineer',
    LOCATION: 'Bogotá',
    WORK_MODE: 'HYBRID',
    SOURCE: 'LinkedIn',
    ROLE_FAMILY: 'PLATFORM_SRE_ASSOCIATE',
    MATCH_SCORE: 12,
    PRIORITY: 'REVIEW',
    SALARY: '',
    EXPERIENCE_REQUESTED: '',
    REQUIRED_TECHNOLOGIES: 'Linux, Terraform',
    STRONG_MATCHES: 'Linux +4',
    RISK_FLAGS: '',
    JOB_URL: 'https://example.test/job',
    RECOMMENDED_CV: 'DEVOPS_PLATFORM',
    CV_LINK: 'https://drive.google.com/example',
    STATUS: 'NEW',
    APPLIED_DATE: '',
    FOLLOW_UP_DATE: '',
    NOTES: '',
    DISCOVERED_AT: new Date('2026-08-29T12:00:00-05:00'),
    ...overrides,
  };
}

test('web dashboard excludes LOW jobs and sorts HIGH before REVIEW before OPTIONAL', () => {
  const context = loadJobOpsContext({
    Utilities: {
      formatDate(date, _timezone, format) {
        return format === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString();
      },
    },
  });
  const records = [
    makeRecord({ JOB_ID: 'low', PRIORITY: 'LOW', MATCH_SCORE: 1 }),
    makeRecord({ JOB_ID: 'optional', PRIORITY: 'OPTIONAL', MATCH_SCORE: 8 }),
    makeRecord({ JOB_ID: 'high', PRIORITY: 'HIGH', MATCH_SCORE: 20 }),
    makeRecord({ JOB_ID: 'review', PRIORITY: 'REVIEW', MATCH_SCORE: 12 }),
  ];

  const dashboard = context.buildJobOpsWebDashboard_(
    records,
    new Date('2026-08-29T16:00:00-05:00'),
  );

  assert.deepEqual(
    dashboard.jobs.map((job) => job.jobId),
    ['high', 'review', 'optional'],
  );
  assert.equal(dashboard.counts.total, 3);
  assert.equal(dashboard.counts.high, 1);
  assert.equal(dashboard.counts.review, 1);
  assert.equal(dashboard.counts.optional, 1);
});

test('web dashboard marks due follow-ups only for active applied statuses', () => {
  const context = loadJobOpsContext({
    Utilities: {
      formatDate(date, _timezone, format) {
        return format === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString();
      },
    },
  });
  const now = new Date('2026-08-29T16:00:00-05:00');
  const dashboard = context.buildJobOpsWebDashboard_(
    [
      makeRecord({
        JOB_ID: 'due',
        STATUS: 'APPLIED',
        FOLLOW_UP_DATE: new Date('2026-08-28T12:00:00-05:00'),
      }),
      makeRecord({
        JOB_ID: 'rejected',
        STATUS: 'REJECTED',
        FOLLOW_UP_DATE: new Date('2026-08-28T12:00:00-05:00'),
      }),
    ],
    now,
  );

  assert.equal(dashboard.jobs.find((job) => job.jobId === 'due').followUpDue, true);
  assert.equal(dashboard.jobs.find((job) => job.jobId === 'rejected').followUpDue, false);
  assert.equal(dashboard.counts.followUpsDue, 1);
});

test('web update plan accepts only known statuses and truncates notes', () => {
  const context = loadJobOpsContext({
    Utilities: { formatDate: () => '' },
  });

  const plan = context.buildJobOpsWebUpdatePlan_({
    jobId: ' job-1 ',
    status: 'applied',
    notes: 'x'.repeat(1200),
  });

  assert.equal(plan.jobId, 'job-1');
  assert.equal(plan.status, 'APPLIED');
  assert.equal(plan.notes.length, 1000);
  assert.throws(
    () => context.buildJobOpsWebUpdatePlan_({ jobId: 'job-1', status: 'NOPE', notes: '' }),
    /Invalid application status/u,
  );
});

test('web URL projection rejects non-http links', () => {
  const context = loadJobOpsContext({
    Utilities: { formatDate: () => '' },
  });

  assert.equal(context.normalizeJobOpsWebUrl_('javascript:alert(1)'), '');
  assert.equal(
    context.normalizeJobOpsWebUrl_('https://example.com/job'),
    'https://example.com/job',
  );
});

test('web app includes compact mobile layout and touch-friendly controls', () => {
  let renderedHtml = '';
  const output = {
    setTitle() {
      return this;
    },
    setXFrameOptionsMode() {
      return this;
    },
  };
  const context = loadJobOpsContext({
    Utilities: { formatDate: () => '' },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createHtmlOutput(html) {
        renderedHtml = html;
        return output;
      },
    },
  });

  context.doGet();

  assert.match(renderedHtml, /@media \(max-width: 390px\)/u);
  assert.match(renderedHtml, /position: sticky/u);
  assert.match(renderedHtml, /min-height: 44px/u);
});


test('dashboard keeps applied jobs for follow-up and excludes skipped jobs from the review queue', () => {
  const context = loadJobOpsContext({
    Utilities: {
      formatDate(date, _timezone, format) {
        return format === 'yyyy-MM-dd' ? date.toISOString().slice(0, 10) : date.toISOString();
      },
    },
  });

  const dashboard = context.buildJobOpsWebDashboard_(
    [
      makeRecord({ JOB_ID: 'applied', STATUS: 'APPLIED', PRIORITY: 'HIGH' }),
      makeRecord({ JOB_ID: 'skipped', STATUS: 'SKIPPED', PRIORITY: 'REVIEW' }),
    ],
    new Date('2026-09-03T08:00:00-05:00'),
  );

  assert.equal(dashboard.counts.applied, 1);
  assert.equal(dashboard.jobs.find((job) => job.jobId === 'applied').active, true);
  assert.equal(dashboard.jobs.find((job) => job.jobId === 'skipped').archived, true);
});

test('web save updates local dashboard without forcing a full reload', () => {
  let renderedHtml = '';
  const output = {
    setTitle() {
      return this;
    },
    setXFrameOptionsMode() {
      return this;
    },
  };
  const context = loadJobOpsContext({
    Utilities: { formatDate: () => '' },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createHtmlOutput(html) {
        renderedHtml = html;
        return output;
      },
    },
  });

  context.doGet();

  assert.match(renderedHtml, /function getVisibleJobs\(\)/u);
  assert.match(renderedHtml, /var result = await callServer\('updateJobOpsWebJob'/u);
  assert.doesNotMatch(
    renderedHtml,
    /updateJobOpsWebJob'[\s\S]{0,500}await loadDashboard\(false\)/u,
  );
});
