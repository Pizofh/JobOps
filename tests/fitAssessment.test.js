const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('fit assessment strongly penalizes high general and technology-specific years', () => {
  const context = loadJobOpsContext();

  const fit = context.calculateJobOpsFitAssessment_(
    {
      seniorityLevel: 'MID',
      minimumYearsOverall: 4,
      experienceRequirements: ['Cloud: 4 years', 'Terraform: 5 years'],
      hardRequirements: ['AWS production experience'],
    },
    '',
  );

  assert.equal(fit.adjustment, -10);
  assert.equal(fit.level, 'POOR');
  assert.ok(fit.reasons.some((reason) => reason.includes('4 años')));
  assert.ok(fit.reasons.some((reason) => reason.includes('Terraform: 5 years')));
});

test('fit assessment rewards explicit entry seniority and accessible experience', () => {
  const context = loadJobOpsContext();

  const fit = context.calculateJobOpsFitAssessment_(
    {
      seniorityLevel: 'JUNIOR',
      minimumYearsOverall: 2,
      experienceRequirements: [],
      hardRequirements: [],
    },
    '',
  );

  assert.equal(fit.adjustment, 4);
  assert.equal(fit.level, 'STRONG');
});

test('fit assessment does not double penalize seniority already captured by base rules', () => {
  const context = loadJobOpsContext();

  const fit = context.calculateJobOpsFitAssessment_(
    {
      seniorityLevel: 'SENIOR',
      minimumYearsOverall: 0,
      experienceRequirements: [],
      hardRequirements: [],
    },
    'SENIOR_TITLE -7',
  );

  assert.equal(fit.adjustment, 0);
  assert.equal(fit.level, 'STRETCH');
});

test('fit application keeps transparent match score and derives final score separately', () => {
  const context = loadJobOpsContext();
  const evaluation = {
    MATCH_SCORE: 20,
    PRIORITY: 'HIGH',
    RISK_FLAGS: '',
    ROLE_FAMILY: 'DEVOPS_CLOUDOPS_JR',
  };
  const config = {
    HIGH_PRIORITY_THRESHOLD: 15,
    REVIEW_THRESHOLD: 10,
    OPTIONAL_THRESHOLD: 6,
  };
  const classification = {
    strategicLevel: 'DIRECT',
    minimumReviewScore: 8,
  };

  const result = context.applyJobOpsFitToEvaluation_(
    evaluation,
    {
      seniorityLevel: 'MID',
      minimumYearsOverall: 4,
      experienceRequirements: ['Terraform: 5 years'],
      hardRequirements: [],
    },
    config,
    classification,
    'Gemini',
    new Date('2026-08-31T12:00:00Z'),
  );

  assert.equal(result.MATCH_SCORE, 20);
  assert.equal(result.FIT_ADJUSTMENT, -10);
  assert.equal(result.FINAL_SCORE, 10);
  assert.equal(result.PRIORITY, 'OPTIONAL');
  assert.equal(result.FIT_PROVIDER, 'Gemini');
});

test('fit migration groups several jobs from the same alert into one AI batch', () => {
  const context = loadJobOpsContext();

  const groups = context.groupJobOpsFitTargetsByMessage_([
    { rowNumber: 2, record: { GMAIL_MESSAGE_ID: 'm1' } },
    { rowNumber: 3, record: { GMAIL_MESSAGE_ID: 'm1' } },
    { rowNumber: 4, record: { GMAIL_MESSAGE_ID: 'm2' } },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.messageId === 'm1').targets.length, 2);
});

test('fit migration matches stored jobs by source job id before looser fields', () => {
  const context = loadJobOpsContext();

  const parsed = context.findJobOpsFitParsedMatch_(
    {
      SOURCE_JOB_ID: '4455981303',
      JOB_URL: 'https://www.linkedin.com/jobs/view/4455981303/',
      COMPANY: 'BairesDev',
      POSITION: 'DevOps Engineer',
    },
    [
      {
        sourceJobId: '4455981303',
        jobUrl: 'https://www.linkedin.com/jobs/view/4455981303/',
        company: 'Different display',
        position: 'Different title',
      },
    ],
  );

  assert.equal(parsed.sourceJobId, '4455981303');
});

test('fit migration skips LOW and already current assessments', () => {
  const context = loadJobOpsContext();

  assert.equal(
    context.isJobOpsFitMigrationCandidate_({
      PRIORITY: 'LOW',
      STATUS: 'NEW',
      FIT_VERSION: '',
    }),
    false,
  );
  assert.equal(
    context.isJobOpsFitMigrationCandidate_({
      PRIORITY: 'HIGH',
      STATUS: 'NEW',
      FIT_VERSION: '1.1.0',
    }),
    false,
  );
  assert.equal(
    context.isJobOpsFitMigrationCandidate_({
      PRIORITY: 'REVIEW',
      STATUS: 'NEW',
      FIT_VERSION: '',
    }),
    true,
  );
});

test('hard requirements alone stay UNKNOWN instead of pretending candidate fit is known', () => {
  const context = loadJobOpsContext();
  const fit = context.calculateJobOpsFitAssessment_(
    {
      seniorityLevel: 'UNKNOWN',
      minimumYearsOverall: 0,
      experienceRequirements: [],
      hardRequirements: ['AWS certification required'],
    },
    '',
  );

  assert.equal(fit.adjustment, 0);
  assert.equal(fit.level, 'UNKNOWN');
  assert.ok(fit.reasons.some((reason) => reason.includes('revisión manual')));
});

test('fit assessment does not subtract years twice when base scoring already captured them', () => {
  const context = loadJobOpsContext();
  const fit = context.calculateJobOpsFitAssessment_(
    {
      seniorityLevel: 'UNKNOWN',
      minimumYearsOverall: 5,
      experienceRequirements: ['Terraform: 5 years'],
      hardRequirements: [],
    },
    'FIVE_YEARS_REQUIRED -5',
  );

  assert.equal(fit.adjustment, 0);
  assert.equal(fit.level, 'STRETCH');
});

test('fit migration can recover LOW jobs within the maximum positive fit adjustment', () => {
  const context = loadJobOpsContext();
  const config = { OPTIONAL_THRESHOLD: 6 };

  assert.equal(
    context.isJobOpsFitMigrationCandidate_(
      { PRIORITY: 'LOW', STATUS: 'NEW', FIT_VERSION: '', MATCH_SCORE: 3 },
      config,
    ),
    true,
  );
  assert.equal(
    context.isJobOpsFitMigrationCandidate_(
      { PRIORITY: 'LOW', STATUS: 'NEW', FIT_VERSION: '', MATCH_SCORE: 1 },
      config,
    ),
    false,
  );
});
