const assert = require('node:assert/strict');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

function createStrategyContext() {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();
  return {
    context,
    services,
    roles: context.readJobOpsRoleFamilies_(services.spreadsheet),
    rules: context.readJobOpsScoringRules_(services.spreadsheet),
    profiles: context.readJobOpsCvProfiles_(services.spreadsheet),
    config: {
      HIGH_PRIORITY_THRESHOLD: 15,
      REVIEW_THRESHOLD: 10,
      OPTIONAL_THRESHOLD: 6,
      RECRUITER_SCORE_BONUS: 5,
    },
  };
}

test('strategy classifies direct and bridge role families from editable patterns', () => {
  const { context, roles } = createStrategyContext();
  const cases = [
    ['Junior DevOps Engineer', 'DEVOPS_CLOUDOPS_JR'],
    ['Cloud Site Reliability Engineer Associate', 'PLATFORM_SRE_ASSOCIATE'],
    ['Cloud Support Engineer - Linux and AWS', 'CLOUD_SUPPORT_OPERATIONS'],
    ['Application Support Engineer L2 - SQL, APIs and logs', 'APPLICATION_PRODUCTION_SUPPORT'],
    ['Release Engineer - GitLab CI/CD and Docker', 'RELEASE_CICD_AUTOMATION'],
    ['Linux Systems Engineer - Ansible and Nginx', 'LINUX_INFRASTRUCTURE'],
    ['Python Backend Engineer - Docker, AWS and CI/CD', 'BACKEND_WITH_DEVOPS'],
    ['Observability Engineer - Prometheus and Grafana', 'OBSERVABILITY_NOC'],
    ['IAM Analyst - AWS and access control', 'IAM_DEVSECOPS'],
  ];

  for (const [position, family] of cases) {
    const result = context.classifyJobOpsRole_({ position, descriptionText: '' }, roles);
    assert.equal(result.roleFamily, family, position);
  }
});

test('strategy scores seniority, experience, Kubernetes and recruiter signals transparently', () => {
  const { context, rules, config } = createStrategyContext();
  const score = (position, descriptionText, isRecruiter = false) =>
    context.calculateJobOpsScore_(
      { position, descriptionText, requiredTechnologies: [], isRecruiter },
      rules,
      config,
    );

  const desktop = score('Desktop Support Technician', 'Requirements: printer support.');
  assert.ok(desktop.score <= -8);
  assert.match(desktop.riskFlags.join('\n'), /DESKTOP_SUPPORT|PRINTER_SUPPORT/);

  const helpDesk = context.classifyJobOpsRole_(
    { position: 'Help Desk L1', descriptionText: '' },
    createStrategyContext().roles,
  );
  assert.equal(helpDesk.roleFamily, 'UNRELATED');

  const niceKubernetes = score('Cloud Support Engineer', 'Nice to have: Kubernetes.');
  const ownershipKubernetes = score(
    'Cloud Support Engineer',
    'Requirements: Kubernetes ownership in production.',
  );
  assert.ok(ownershipKubernetes.score < niceKubernetes.score);
  assert.match(ownershipKubernetes.riskFlags.join('\n'), /KUBERNETES_OWNERSHIP/);

  const twoYears = score('Junior DevOps Engineer', 'Requirements: 2 years experience with Linux.');
  assert.ok(twoYears.score >= 3);
  assert.doesNotMatch(twoYears.riskFlags.join('\n'), /YEARS_REQUIRED/);

  const fiveYears = score('DevOps Engineer', 'Requirements: 5+ years of Linux experience.');
  assert.match(fiveYears.riskFlags.join('\n'), /FIVE_YEARS_REQUIRED/);

  const senior = score('Senior DevOps Engineer', 'Requirements: Linux.');
  assert.match(senior.riskFlags.join('\n'), /SENIOR_TITLE/);

  const recruiter = score('Junior DevOps Engineer', 'Requirements: Linux.', true);
  assert.match(recruiter.strongMatches.join('\n'), /Recruiter \+5/);
});

test('bridge roles can be HIGH and unavailable profile links fall back to CV_TO_CREATE', () => {
  const { context, roles, rules, profiles, config } = createStrategyContext();
  const result = context.evaluateJobOpsJob_(
    {
      position: 'Application Support Engineer L2',
      descriptionText:
        'Requirements: Linux, Docker, troubleshooting, API, SQL and logs. Application Support.',
      requiredTechnologies: ['Linux', 'Docker', 'SQL'],
      isRecruiter: false,
    },
    { roleFamilies: roles, scoringRules: rules, cvProfiles: profiles, config },
  );

  assert.equal(result.ROLE_FAMILY, 'APPLICATION_PRODUCTION_SUPPORT');
  assert.equal(result.PRIORITY, 'HIGH');
  assert.equal(result.RECOMMENDED_CV, 'CV_TO_CREATE');
  assert.match(result.STRONG_MATCHES, /application support/i);
});

test('setup migrates standard rows once and preserves a customized configuration row', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  const first = context.setupJobOps();
  const roleSheet = services.spreadsheet.getSheetByName('RoleFamilies');
  const headers = roleSheet.getDataRange().getValues()[0];
  const cloudRow = roleSheet
    .getDataRange()
    .getValues()
    .find((row) => row[0] === 'CLOUD_SUPPORT_OPERATIONS');
  cloudRow[headers.indexOf('NOTES')] = 'ConfiguraciÃ³n manual';
  const rowNumber =
    roleSheet
      .getDataRange()
      .getValues()
      .findIndex((row) => row[0] === 'CLOUD_SUPPORT_OPERATIONS') + 1;
  roleSheet.getRange(rowNumber, 1, 1, cloudRow.length).setValues([cloudRow]);

  const second = context.setupJobOps();
  const third = context.setupJobOps();
  const updated = roleSheet.getDataRange().getValues()[rowNumber - 1];

  assert.ok(first.spreadsheet.seededRows.RoleFamilies > 0);
  assert.equal(second.spreadsheet.seededRows.RoleFamilies, 0);
  assert.equal(third.spreadsheet.seededRows.RoleFamilies, 0);
  assert.equal(updated[headers.indexOf('NOTES')], 'ConfiguraciÃ³n manual');
  assert.equal(
    roleSheet
      .getDataRange()
      .getValues()
      .filter((row) => row[0] === 'CLOUD_SUPPORT_OPERATIONS').length,
    1,
  );
});

test('digest uses soft strategy distribution without displacing stronger priorities', () => {
  const { context } = createStrategyContext();
  const jobs = [
    ...Array.from({ length: 10 }, (_, index) => ({
      ROLE_FAMILY: 'DEVOPS_CLOUDOPS_JR',
      PRIORITY: 'HIGH',
      MATCH_SCORE: 20 - index,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      ROLE_FAMILY: 'CLOUD_SUPPORT_OPERATIONS',
      PRIORITY: 'HIGH',
      MATCH_SCORE: 19 - index,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      ROLE_FAMILY: 'BACKEND_WITH_DEVOPS',
      PRIORITY: 'HIGH',
      MATCH_SCORE: 18 - index,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      ROLE_FAMILY: 'LINUX_INFRASTRUCTURE',
      PRIORITY: 'HIGH',
      MATCH_SCORE: 17 - index,
    })),
  ];
  const selected = context.selectJobOpsDistributedDigestJobs_(jobs, 10);
  const counts = Object.fromEntries(
    selected.map((job) => job.ROLE_FAMILY).map((family) => [family, 0]),
  );
  for (const job of selected) {
    counts[job.ROLE_FAMILY] += 1;
  }

  assert.deepEqual(JSON.parse(JSON.stringify(counts)), {
    DEVOPS_CLOUDOPS_JR: 4,
    CLOUD_SUPPORT_OPERATIONS: 3,
    BACKEND_WITH_DEVOPS: 2,
    LINUX_INFRASTRUCTURE: 1,
  });

  const directHigh = Array.from({ length: 10 }, () => ({
    ROLE_FAMILY: 'DEVOPS_CLOUDOPS_JR',
    PRIORITY: 'HIGH',
  }));
  const supportReview = Array.from({ length: 10 }, () => ({
    ROLE_FAMILY: 'CLOUD_SUPPORT_OPERATIONS',
    PRIORITY: 'REVIEW',
  }));
  assert.equal(
    context
      .selectJobOpsDistributedDigestJobs_(directHigh.concat(supportReview), 10)
      .every((job) => job.PRIORITY === 'HIGH'),
    true,
  );
});
