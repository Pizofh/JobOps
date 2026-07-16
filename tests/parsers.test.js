const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

function fixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', relativePath), 'utf8'));
}

function defaultSources(context) {
  return context.parseJobOpsSourceDefinitions_([
    ['SOURCE', 'SENDER_DOMAINS', 'SUBJECT_PATTERNS', 'PARSER_NAME', 'ENABLED'],
    ['LinkedIn', 'linkedin.com', 'job alert,jobs for you', 'parseLinkedInJob', true],
    ['Indeed', 'indeed.com', 'job alert,new jobs', 'parseIndeedJob', true],
    [
      'Recruiter',
      '',
      'vacancy,position,opportunity,role,vacante,oportunidad,cargo',
      'parseRecruiterJob',
      true,
    ],
    ['Generic', '', '', 'parseGenericJob', true],
  ]);
}

test('generic parser normalizes a configured platform alert', () => {
  const context = loadJobOpsContext();
  const parsed = context.parseJobOpsMessage_(
    fixture('generic/linkedin-alert.json'),
    defaultSources(context),
  );

  assert.equal(parsed.source, 'LinkedIn');
  assert.equal(parsed.position, 'DevOps Engineer');
  assert.equal(parsed.company, 'Acme Labs');
  assert.equal(parsed.workMode, 'REMOTE');
  assert.equal(parsed.jobUrl, 'https://www.linkedin.com/jobs/view/123456?currentJobId=123456');
  assert.equal(parsed.sourceJobId, '123456');
  assert.ok(Array.from(parsed.requiredTechnologies).includes('Terraform'));
  assert.ok(parsed.warnings.some((warning) => warning.includes('generic fallback')));
});

test('recruiter parser reads original headers from a forwarded Hotmail message', () => {
  const context = loadJobOpsContext();
  const parsed = context.parseJobOpsMessage_(
    fixture('recruiters/forwarded-hotmail.json'),
    defaultSources(context),
  );

  assert.equal(parsed.source, 'Recruiter');
  assert.equal(parsed.company, 'Nube Corp');
  assert.equal(parsed.position, 'DevOps Engineer');
  assert.equal(parsed.recruiterName, 'Ana Recruiter');
  assert.equal(parsed.recruiterEmail, 'ana@talent.example');
  assert.equal(parsed.workMode, 'REMOTE');
  assert.ok(parsed.warnings.some((warning) => warning.includes('forwarded')));
});

test('malformed candidate throws a stable missing-field error', () => {
  const context = loadJobOpsContext();

  assert.throws(
    () =>
      context.parseJobOpsMessage_(
        fixture('malformed/indeed-missing-fields.json'),
        defaultSources(context),
      ),
    (error) => error.code === 'MISSING_REQUIRED_FIELD',
  );
});

test('recruiter detection rejects promotional newsletters despite technical keywords', () => {
  const context = loadJobOpsContext();
  const detection = context.detectJobOpsSource_(
    {
      subject: 'Newsletter: DevOps role and course promotion',
      from: 'Marketing <news@learning.example>',
      plainBody: 'This webinar promotion includes a Docker opportunity overview.',
      htmlBody: '',
    },
    defaultSources(context),
  );

  assert.equal(detection.candidate, false);
});
