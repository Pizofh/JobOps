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
