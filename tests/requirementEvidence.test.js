const assert = require('node:assert/strict');
const test = require('node:test');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('deterministic evidence separates mandatory cloud experience from preferred skills', () => {
  const c = loadJobOpsContext();
  const evidence = c.extractJobOpsRequirementEvidence_({
    position: 'Senior DevOps Engineer',
    descriptionText:
      'Required: 3+ years experience in AWS production. Terraform preferred. English B2 required.',
  });
  assert.equal(evidence.seniorityLevel, 'SENIOR');
  assert.equal(evidence.minimumYearsOverall, null);
  assert.equal(evidence.cloudGap, true);
  assert.equal(evidence.experienceRequirements.length, 1);
  assert.ok(evidence.reviewReasons.some((r) => r.includes('Deseables: Terraform')));
  const result = c.applyJobOpsFitToEvaluation_(
    { MATCH_SCORE: 45 },
    evidence,
    { HIGH_PRIORITY_THRESHOLD: 15, REVIEW_THRESHOLD: 10, OPTIONAL_THRESHOLD: 6 },
    { strategicLevel: 'DIRECT', minimumReviewScore: 8 },
    'DETERMINISTIC',
  );
  assert.equal(result.MATCH_SCORE, 45);
  assert.notEqual(result.PRIORITY, 'HIGH');
});

test('missing requirements remain unknown and desirable years are not mandatory', () => {
  const c = loadJobOpsContext();
  const evidence = c.extractJobOpsRequirementEvidence_({
    position: 'Engineer',
    descriptionText: '5 years experience preferred.',
  });
  assert.equal(evidence.minimumYearsOverall, null);
  assert.equal(evidence.experienceRequirements.length, 0);
  assert.equal(c.calculateJobOpsFitAssessment_(evidence).level, 'UNKNOWN');
});

test('MID and mandatory keywords do not confirm fit without explicit experience', () => {
  const c = loadJobOpsContext();
  const evidence = c.extractJobOpsRequirementEvidence_({
    position: 'DevOps Engineer',
    experienceRequested: 'Mid-level',
    descriptionText: 'Required: Python. Linux Kubernetes Terraform Ansible Prometheus.',
  });
  const result = c.applyJobOpsFitToEvaluation_(
    { MATCH_SCORE: 31 },
    evidence,
    { HIGH_PRIORITY_THRESHOLD: 15, REVIEW_THRESHOLD: 10, OPTIONAL_THRESHOLD: 6 },
    { strategicLevel: 'DIRECT', minimumReviewScore: 8 },
    'DETERMINISTIC',
  );
  assert.equal(result.FIT_LEVEL, 'UNKNOWN');
  assert.equal(result.PRIORITY, 'REVIEW');
  assert.equal(result.MATCH_SCORE, 31);
  assert.equal(result.FINAL_SCORE, 30);
  assert.match(result.FIT_REASONS, /compatibilidad pendiente/);
  assert.equal(result.FIT_VERSION, '1.2.0');
  const stored = c.applyJobOpsStoredFit_(
    { MATCH_SCORE: 31 },
    {
      level: result.FIT_LEVEL,
      adjustment: result.FIT_ADJUSTMENT,
      version: result.FIT_VERSION,
      reasons: result.FIT_REASONS,
      provider: result.FIT_PROVIDER,
    },
    { HIGH_PRIORITY_THRESHOLD: 15, REVIEW_THRESHOLD: 10, OPTIONAL_THRESHOLD: 6 },
    { strategicLevel: 'DIRECT', minimumReviewScore: 8 },
  );
  assert.equal(stored.PRIORITY, 'REVIEW');
});

test('MID with explicit accessible years can retain fit while cloud requirements stay stretch', () => {
  const c = loadJobOpsContext();
  const classify = (descriptionText) =>
    c.applyJobOpsFitToEvaluation_(
      { MATCH_SCORE: 31 },
      c.extractJobOpsRequirementEvidence_({
        position: 'DevOps Engineer',
        experienceRequested: 'Mid-level',
        descriptionText,
      }),
      { HIGH_PRIORITY_THRESHOLD: 15, REVIEW_THRESHOLD: 10, OPTIONAL_THRESHOLD: 6 },
      { strategicLevel: 'DIRECT', minimumReviewScore: 8 },
      'DETERMINISTIC',
    );
  assert.equal(classify('Minimum 2 years experience.').FIT_LEVEL, 'GOOD');
  assert.equal(
    classify('Required: professional production experience in AWS.').FIT_LEVEL,
    'STRETCH',
  );
});
