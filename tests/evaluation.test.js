const assert = require('node:assert/strict');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

function roleFamilyValues() {
  return [
    [
      'ROLE_FAMILY',
      'PATTERNS',
      'PRIORITY_ORDER',
      'RECOMMENDED_CV_PROFILE',
      'MINIMUM_REVIEW_SCORE',
      'ENABLED',
    ],
    ['DEVOPS_PLATFORM_SRE', 'devops,platform engineer', 1, 'DEVOPS_PLATFORM', 10, true],
    ['OTHER_TECHNICAL', 'engineer,developer', 7, 'CV_TO_CREATE', 6, true],
    ['UNRELATED', '', 8, 'CV_TO_CREATE', 999, true],
  ];
}

function scoringRuleValues() {
  return [
    ['RULE_ID', 'PATTERN', 'MATCH_TYPE', 'CONTEXT', 'SCORE', 'RISK_FLAG', 'ENABLED'],
    ['LINUX', 'Linux', 'KEYWORD', 'REQUIRED', 4, '', true],
    ['DOCKER', 'Docker', 'KEYWORD', 'ANY', 4, '', true],
    ['SENIOR', 'Senior', 'KEYWORD', 'NEGATIVE', -5, 'SENIOR_TITLE', true],
  ];
}

function cvProfileValues() {
  return [
    ['CV_PROFILE', 'DRIVE_URL', 'TARGET_ROLE_FAMILIES', 'ENABLED'],
    ['DEVOPS_PLATFORM', 'https://drive.example/devops', 'DEVOPS_PLATFORM_SRE', true],
    ['CV_TO_CREATE', '', 'OTHER_TECHNICAL,UNRELATED', true],
  ];
}

function scoringConfig() {
  return {
    HIGH_PRIORITY_THRESHOLD: 15,
    REVIEW_THRESHOLD: 10,
    OPTIONAL_THRESHOLD: 6,
    RECRUITER_SCORE_BONUS: 5,
  };
}

test('editable role, score and CV settings produce an explainable recommendation', () => {
  const context = loadJobOpsContext();
  const roleFamilies = context.parseJobOpsRoleFamilies_(roleFamilyValues());
  const scoringRules = context.parseJobOpsScoringRules_(scoringRuleValues());
  const cvProfiles = context.parseJobOpsCvProfiles_(cvProfileValues());
  const result = context.evaluateJobOpsJob_(
    {
      position: 'Senior DevOps Engineer',
      descriptionText: 'Requirements: Linux experience. Docker is used daily.',
      requiredTechnologies: ['Linux', 'Docker'],
      isRecruiter: true,
    },
    { roleFamilies, scoringRules, cvProfiles, config: scoringConfig() },
  );

  assert.equal(result.ROLE_FAMILY, 'DEVOPS_PLATFORM_SRE');
  assert.equal(result.MATCH_SCORE, 8);
  assert.equal(result.PRIORITY, 'OPTIONAL');
  assert.equal(result.RECOMMENDED_CV, 'DEVOPS_PLATFORM');
  assert.equal(result.CV_LINK, 'https://drive.example/devops');
  assert.match(result.STRONG_MATCHES, /Linux \+4/);
  assert.match(result.STRONG_MATCHES, /Docker \+4/);
  assert.match(result.STRONG_MATCHES, /Recruiter \+5/);
  assert.match(result.RISK_FLAGS, /SENIOR_TITLE -5/);
});

test('invalid editable regex rules fail with a configuration error', () => {
  const context = loadJobOpsContext();
  const values = scoringRuleValues();
  values[1][2] = 'REGEX';
  values[1][1] = '[';

  assert.throws(
    () => context.parseJobOpsScoringRules_(values),
    (error) => error.code === 'CONFIGURATION_ERROR',
  );
});

test('rescoreJobs updates only evaluation fields and retains manual job values', () => {
  const message = {
    subject: 'Job alert: DevOps Engineer at Acme Labs',
    from: 'LinkedIn Jobs <alerts@linkedin.com>',
    date: '2026-07-14T14:30:00.000Z',
    plainBody:
      'Location: Bogota, Colombia\nWork mode: Remote\nTechnologies: Linux, Docker, AWS and Terraform\nView job: https://www.linkedin.com/jobs/view/123456?currentJobId=123456',
    htmlBody: '',
    messageId: 'rescore-message-001',
    threadId: 'rescore-thread-001',
  };
  const services = createFakeGoogleServices({
    gmailThreads: [{ threadId: message.threadId, messages: [message] }],
  });
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();
  context.ingestJobs();

  const jobsSheet = services.spreadsheet.getSheetByName('Jobs');
  const headers = jobsSheet.getDataRange().getValues()[0];
  jobsSheet.getRange(2, headers.indexOf('STATUS') + 1).setValues([['APPLIED']]);
  jobsSheet.getRange(2, headers.indexOf('APPLIED_DATE') + 1).setValues([['2026-07-15']]);
  jobsSheet.getRange(2, headers.indexOf('FOLLOW_UP_DATE') + 1).setValues([['2026-07-22']]);
  jobsSheet.getRange(2, headers.indexOf('NOTES') + 1).setValues([['Manual note']]);

  const result = context.rescoreJobs();
  const row = jobsSheet.getDataRange().getValues()[1];

  assert.equal(result.phase, 4);
  assert.equal(result.rescoredJobs, 1);
  assert.equal(row[headers.indexOf('ROLE_FAMILY')], 'DEVOPS_CLOUDOPS_JR');
  assert.equal(row[headers.indexOf('MATCH_SCORE')], 14);
  assert.equal(row[headers.indexOf('STATUS')], 'APPLIED');
  assert.equal(row[headers.indexOf('APPLIED_DATE')], '2026-07-15');
  assert.equal(row[headers.indexOf('FOLLOW_UP_DATE')], '2026-07-22');
  assert.equal(row[headers.indexOf('NOTES')], 'Manual note');
});
