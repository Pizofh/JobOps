const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

function roleFamilies(context) {
  return context.parseJobOpsRoleFamilies_([
    [
      'ROLE_FAMILY',
      'PATTERNS',
      'PRIORITY_ORDER',
      'RECOMMENDED_CV_PROFILE',
      'MINIMUM_REVIEW_SCORE',
      'ENABLED',
      'NOTES',
      'STRATEGIC_LEVEL',
    ],
    [
      'PLATFORM_SRE_ASSOCIATE',
      'platform engineer,site reliability engineer,sre engineer',
      1,
      'DEVOPS_PLATFORM',
      8,
      true,
      '',
      'DIRECT',
    ],
    [
      'LINUX_INFRASTRUCTURE',
      'systems engineer,infrastructure engineer',
      2,
      'DEVOPS_PLATFORM',
      9,
      true,
      '',
      'BRIDGE',
    ],
    ['UNRELATED', '', 99, 'CV_TO_CREATE', 999, true, '', 'UNRELATED'],
  ]);
}

test('semantic Gemini request asks for an enabled role family without exposing scores', () => {
  const context = loadJobOpsContext();
  const families = roleFamilies(context);
  const evidence = {
    source: 'Indeed',
    subject: 'Platform roles',
    body: 'SRE / Platform Infrastructure Engineer Intern',
    jobLinks: [{ ref: 'JOB_LINK_1', sourceJobId: 'abc123' }],
    roleFamilies: context.buildJobOpsAiRoleFamilyEvidence_(families),
  };

  const request = context.buildJobOpsSemanticGeminiRequest_(evidence);
  const schema = request.generationConfig.responseFormat.text.schema;
  const prompt = request.contents[0].parts[0].text;

  assert.equal(schema.properties.jobs.items.properties.roleFamily.type, 'string');
  assert.ok(schema.properties.jobs.items.required.includes('roleFamily'));
  assert.match(prompt, /PLATFORM_SRE_ASSOCIATE/);
  assert.match(prompt, /Classify by the meaning and responsibilities/);
  assert.equal(prompt.includes('MATCH_SCORE'), false);
  assert.equal(prompt.includes('HIGH_PRIORITY_THRESHOLD'), false);
});

test('valid semantic role evidence steers deterministic classification while scoring remains separate', () => {
  const context = loadJobOpsContext();
  const families = roleFamilies(context);
  const job = context.applyJobOpsSemanticRoleEvidence_(
    {
      position: 'SRE / Platform Infrastructure Engineer Intern',
      descriptionText: '',
      requiredTechnologies: [],
      warnings: [],
      parserName: 'parseIndeedJob+Gemini',
    },
    'PLATFORM_SRE_ASSOCIATE',
    families,
  );

  const classification = context.classifyJobOpsRole_(job, families);
  assert.equal(classification.roleFamily, 'PLATFORM_SRE_ASSOCIATE');
  assert.equal(job.parserName, 'parseIndeedJob+GeminiSemantic');
  assert.equal(job.descriptionText, '');
  assert.deepEqual(Array.from(job.requiredTechnologies), []);
});

test('unknown semantic family is rejected and leaves deterministic fallback intact', () => {
  const context = loadJobOpsContext();
  const families = roleFamilies(context);
  assert.equal(context.validateJobOpsSemanticRoleFamily_('MADE_UP_ROLE', families), '');

  const job = context.applyJobOpsSemanticRoleEvidence_(
    {
      position: 'Infrastructure Engineer',
      descriptionText: '',
      requiredTechnologies: [],
      warnings: [],
      parserName: 'parseIndeedJob+Gemini',
    },
    '',
    families,
  );
  const classification = context.classifyJobOpsRole_(job, families);
  assert.equal(classification.roleFamily, 'LINUX_INFRASTRUCTURE');
  assert.equal(job.parserName, 'parseIndeedJob+Gemini');
});

test(
  'duplicate semantic reevaluation preserves the semantic family and upgrades parser metadata',
  () => {
    const context = loadJobOpsContext();
    const target = {
      POSITION: 'SRE / Platform Infrastructure Engineer Intern',
      REQUIRED_TECHNOLOGIES: '',
      LOCATION: 'Bogota, Colombia',
      WORK_MODE: 'UNKNOWN',
      SALARY: '',
      EXPERIENCE_REQUESTED: '',
      SOURCE: 'LinkedIn',
      RECRUITER_EMAIL: '',
      PARSER: 'parseLinkedInJob+Gemini',
      PARSER_VERSION: '1.1.2000',
    };
    const parsed = {
      descriptionText: '',
      semanticRoleFamily: 'PLATFORM_SRE_ASSOCIATE',
    };
    const incoming = {
      PARSER: 'parseLinkedInJob+GeminiSemantic',
      PARSER_VERSION: '1.1.2001',
    };

    context.evaluateJobOpsJob_ = (job) => ({
      ROLE_FAMILY: job.semanticRoleFamily,
      MATCH_SCORE: 12,
      PRIORITY: 'REVIEW',
      RECOMMENDED_CV: 'DEVOPS_PLATFORM',
      CV_LINK: '',
      STRONG_MATCHES: '',
      RISK_FLAGS: '',
    });

    context.applyJobOpsDuplicateEvaluation_(target, parsed, incoming, {});

    assert.equal(target.ROLE_FAMILY, 'PLATFORM_SRE_ASSOCIATE');
    assert.equal(target.PARSER, 'parseLinkedInJob+GeminiSemantic');
    assert.equal(target.PARSER_VERSION, '1.1.2001');
  },
);
