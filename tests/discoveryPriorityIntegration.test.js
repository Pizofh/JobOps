const assert = require('node:assert/strict');
const test = require('node:test');
const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('discovery preview and import apply guards, preserve fit, and leave duplicates untouched', () => {
  const services = createFakeGoogleServices();
  let requests = 0;
  const context = loadJobOpsContext({
    ...services.globals,
    Utilities: { formatDate: (date) => date.toISOString() },
    UrlFetchApp: {
      fetch() {
        requests += 1;
        return {
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              jobs: [
                {
                  guid: 'https://himalayas.app/companies/example/jobs/devops-internship',
                  applicationLink: 'https://himalayas.app/companies/example/jobs/devops-internship',
                  title: 'DevOps Engineer Internship',
                  companyName: 'Example',
                  seniority: ['Entry-level'],
                  description: 'Linux Bash Ansible Git Docker AWS Terraform automation CI/CD',
                },
              ],
            }),
        };
      },
    },
  });
  context.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('Jobs');
  const before = sheet.getDataRange().getValues();
  const preview = context.dryRunPublicAtsDiscovery();
  assert.equal(preview.wouldCreateJobs, 1);
  assert.equal(preview.preview[0].priority, 'OPTIONAL');
  assert.equal(preview.preview[0].fitProvider, 'DETERMINISTIC');
  assert.equal(preview.preview[0].strategicLevel, 'DIRECT');
  assert.equal(requests, preview.checkedQueries);
  assert.deepEqual(sheet.getDataRange().getValues(), before);

  assert.equal(context.ingestDiscoveredJobs().createdJobs, 1);
  const target = context.readJobOpsJobsForRescore_(services.spreadsheet)[0];
  assert.equal(target.record.PRIORITY, 'OPTIONAL');
  assert.equal(target.record.FIT_PROVIDER, 'DETERMINISTIC');
  assert.equal(target.record.MATCH_SCORE, preview.preview[0].matchScore);
  const headers = sheet.getDataRange().getValues()[0];
  for (const [field, value] of Object.entries({
    STATUS: 'APPLIED',
    NOTES: 'Manual notes',
    RECOMMENDED_CV: 'Manual CV',
    APPLIED_DATE: '2026-10-29',
    FOLLOW_UP_DATE: '2026-11-05',
  })) {
    sheet.getRange(2, headers.indexOf(field) + 1).setValues([[value]]);
  }
  const manualSnapshot = sheet.getDataRange().getValues();
  const repeated = context.ingestDiscoveredJobs();
  assert.equal(repeated.createdJobs, 0);
  assert.ok(repeated.duplicates > 0);
  assert.deepEqual(sheet.getDataRange().getValues(), manualSnapshot);
});

test('discovery logs compact entries and uses configured strategy after bridge correction', () => {
  const services = createFakeGoogleServices();
  const logs = [];
  let requests = 0;
  const c = loadJobOpsContext({
    ...services.globals,
    Utilities: { formatDate: (date) => date.toISOString() },
    console: { log: (entry) => logs.push(entry) },
    UrlFetchApp: {
      fetch() {
        requests += 1;
        return {
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              jobs: [
                {
                  guid: 'https://himalayas.app/companies/example/jobs/linux-support',
                  applicationLink: 'https://himalayas.app/companies/example/jobs/linux-support',
                  companyName: 'Example',
                  title: 'Associate Linux Support Engineer',
                  seniority: ['Mid-level'],
                  description: 'Required: Python. Linux Ansible troubleshooting.',
                },
              ],
            }),
        };
      },
    },
  });
  c.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('Jobs');
  const before = sheet.getDataRange().getValues();
  // Exercise the existing correction rather than relying on the default classifier.
  const evaluate = c.evaluateJobOpsJob_;
  c.evaluateJobOpsJob_ = (job, context) => ({
    ...evaluate(job, context),
    ROLE_FAMILY: 'UNRELATED',
  });
  const result = c.dryRunJobDiscovery();
  assert.equal(result.preview[0].roleFamily, 'LINUX_INFRASTRUCTURE');
  assert.equal(result.preview[0].strategicLevel, 'BRIDGE');
  assert.equal(requests, result.checkedQueries);
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0]).wouldCreateJobs, 1);
  assert.equal(JSON.parse(logs[1]).strategicLevel, 'BRIDGE');
  assert.ok(logs.every((line) => line.length < 2500));
  assert.equal(JSON.parse(logs[0]).preview, undefined);
  assert.ok(result.preview[0].fitReasons);
  assert.deepEqual(sheet.getDataRange().getValues(), before);
});

test('bridge correction uses final score and retains poor-fit caps and evidence', () => {
  const c = loadJobOpsContext();
  const config = { HIGH_PRIORITY_THRESHOLD: 15, REVIEW_THRESHOLD: 10, OPTIONAL_THRESHOLD: 6 };
  const families = [
    { roleFamily: 'LINUX_INFRASTRUCTURE', strategicLevel: 'BRIDGE', minimumReviewScore: 9 },
  ];
  const record = {
    POSITION: 'Associate Linux Support Engineer',
    ROLE_FAMILY: 'UNRELATED',
    MATCH_SCORE: 30,
    FINAL_SCORE: 20,
    PRIORITY: 'LOW',
    FIT_LEVEL: 'POOR',
    FIT_VERSION: '1.1.0',
    FIT_ADJUSTMENT: -10,
    FIT_REASONS: 'Original evidence',
  };
  const result = c.applyJobOpsPublicDiscoveryPriorityGuards_(record, config, families);
  assert.equal(result.ROLE_FAMILY, 'LINUX_INFRASTRUCTURE');
  assert.equal(result.PRIORITY, 'OPTIONAL');
  assert.equal(result.MATCH_SCORE, 30);
  assert.equal(result.FINAL_SCORE, 20);
  assert.ok(result.FIT_REASONS.includes('Original evidence'));
  assert.equal(record.PRIORITY, 'LOW');
  const lowScore = c.applyJobOpsPublicDiscoveryPriorityGuards_(
    { ...record, FINAL_SCORE: 5, FIT_LEVEL: 'UNKNOWN' },
    config,
    families,
  );
  assert.equal(lowScore.PRIORITY, 'LOW');
});
