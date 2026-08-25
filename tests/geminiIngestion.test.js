const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('Gemini validation keeps separate Indeed jobs from one digest', () => {
  const context = loadJobOpsContext();
  const evidence = {
    jobLinks: [
      {
        ref: 'JOB_LINK_1',
        url: 'https://co.indeed.com/rc/clk/dl?jk=aaa111',
        sourceJobId: 'aaa111',
      },
      {
        ref: 'JOB_LINK_2',
        url: 'https://co.indeed.com/rc/clk/dl?jk=bbb222',
        sourceJobId: 'bbb222',
      },
    ],
  };

  const jobs = context.validateJobOpsAiJobs_(
    {
      jobs: [
        {
          position: 'SRE Intern',
          company: 'Acme',
          location: 'Bogota',
          salary: '',
          experienceRequested: '',
          workMode: 'UNKNOWN',
          jobLinkRef: 'JOB_LINK_1',
          sourceJobId: 'aaa111',
          requiredTechnologies: ['Linux'],
          descriptionText: 'Linux role',
        },
        {
          position: 'DevOps Engineer',
          company: 'Example Corp',
          location: 'Bogota',
          salary: '',
          experienceRequested: '',
          workMode: 'HYBRID',
          jobLinkRef: 'JOB_LINK_2',
          sourceJobId: 'bbb222',
          requiredTechnologies: ['Docker'],
          descriptionText: 'Docker role',
        },
      ],
    },
    evidence,
  );

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].sourceJobId, 'aaa111');
  assert.equal(jobs[0].jobUrl, 'https://co.indeed.com/rc/clk/dl?jk=aaa111');
  assert.equal(jobs[1].sourceJobId, 'bbb222');
});

test('LinkedIn job links are reduced to public per-vacancy URLs', () => {
  const context = loadJobOpsContext();
  const links = context.buildJobOpsLinkedInJobLinks_([
    'https://www.linkedin.com/comm/jobs/view/4321098765?trackingId=private-token&currentJobId=4321098765',
    'https://www.linkedin.com/jobs/view/9876543210/?trk=job-alert&currentJobId=9876543210',
    'https://www.linkedin.com/comm/feed/?lipi=private-feed-token',
  ]);

  assert.equal(links.length, 2);
  assert.equal(links[0].sourceJobId, '4321098765');
  assert.equal(links[0].url, 'https://www.linkedin.com/jobs/view/4321098765/');
  assert.equal(links[1].sourceJobId, '9876543210');
  assert.equal(links[1].url, 'https://www.linkedin.com/jobs/view/9876543210/');
  assert.equal(
    links.some((link) => link.url.includes('private-token')),
    false,
  );
});

test('Gemini validation keeps separate LinkedIn jobs and normalizes parser metadata', () => {
  const context = loadJobOpsContext();
  const evidence = {
    source: 'LinkedIn',
    jobLinks: [
      {
        ref: 'JOB_LINK_1',
        url: 'https://www.linkedin.com/jobs/view/4321098765/',
        sourceJobId: '4321098765',
      },
      {
        ref: 'JOB_LINK_2',
        url: 'https://www.linkedin.com/jobs/view/9876543210/',
        sourceJobId: '9876543210',
      },
    ],
  };

  const jobs = context.validateJobOpsAiJobs_(
    {
      jobs: [
        {
          position: 'Cloud Platform Engineer',
          company: 'Acme',
          location: 'Bogota',
          salary: '',
          experienceRequested: '',
          workMode: 'HYBRID',
          jobLinkRef: 'JOB_LINK_1',
          sourceJobId: '4321098765',
          requiredTechnologies: ['AWS', 'Terraform'],
          descriptionText: 'AWS and Terraform',
        },
        {
          position: 'Infrastructure Engineer',
          company: 'Example Corp',
          location: 'Bogota',
          salary: '',
          experienceRequested: '',
          workMode: 'REMOTE',
          jobLinkRef: 'JOB_LINK_2',
          sourceJobId: '9876543210',
          requiredTechnologies: ['Linux'],
          descriptionText: 'Linux infrastructure',
        },
      ],
    },
    evidence,
  );
  const normalized = jobs.map((job) =>
    context.normalizeJobOpsAiJob_(job, { source: 'LinkedIn' }),
  );

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].parserName, 'parseLinkedInJob+Gemini');
  assert.equal(normalized[0].jobUrl, 'https://www.linkedin.com/jobs/view/4321098765/');
  assert.equal(normalized[1].workMode, 'REMOTE');
});

test('Gemini validation rejects hallucinated link references or identifiers', () => {
  const context = loadJobOpsContext();
  const evidence = {
    jobLinks: [
      {
        ref: 'JOB_LINK_1',
        url: 'https://co.indeed.com/rc/clk/dl?jk=real123',
        sourceJobId: 'real123',
      },
    ],
  };

  const jobs = context.validateJobOpsAiJobs_(
    {
      jobs: [
        {
          position: 'DevOps Engineer',
          company: 'Imaginary Corp',
          location: '',
          salary: '',
          experienceRequested: '',
          workMode: 'UNKNOWN',
          jobLinkRef: 'JOB_LINK_1',
          sourceJobId: 'fake999',
          requiredTechnologies: [],
          descriptionText: '',
        },
        {
          position: 'Platform Engineer',
          company: 'Imaginary Corp',
          location: '',
          salary: '',
          experienceRequested: '',
          workMode: 'UNKNOWN',
          jobLinkRef: 'JOB_LINK_999',
          sourceJobId: '',
          requiredTechnologies: [],
          descriptionText: '',
        },
      ],
    },
    evidence,
  );

  assert.equal(jobs.length, 0);
});

test('Gemini request uses conservative current responseFormat structured output shape', () => {
  const context = loadJobOpsContext();
  const request = context.buildJobOpsGeminiRequest_({
    source: 'LinkedIn',
    subject: 'DevOps roles',
    body: 'DevOps Engineer\nAcme',
    jobLinks: [{ ref: 'JOB_LINK_1', sourceJobId: 'aaa111' }],
  });

  const textFormat = request.generationConfig.responseFormat.text;
  const prompt = request.contents[0].parts[0].text;
  assert.equal(textFormat.mimeType, 'APPLICATION_JSON');
  assert.equal(textFormat.schema.type, 'object');
  assert.equal('additionalProperties' in textFormat.schema, false);
  assert.equal('maxItems' in textFormat.schema.properties.jobs, false);
  assert.equal('enum' in textFormat.schema.properties.jobs.items.properties.workMode, false);
  assert.equal('responseMimeType' in request.generationConfig, false);
  assert.equal('responseJsonSchema' in request.generationConfig, false);
  assert.equal('temperature' in request.generationConfig, false);
  assert.match(prompt, /LinkedIn job-alert email/);
});

test('jobs in the same Gmail message receive different batch identities', () => {
  const context = loadJobOpsContext();
  const input = { messageId: 'gmail-message-1' };

  const first = context.buildJobOpsCandidateMessageIdentity_(input, {
    position: 'SRE Intern',
    sourceJobId: 'aaa111',
    jobUrl: 'https://co.indeed.com/rc/clk/dl?jk=aaa111',
  });
  const second = context.buildJobOpsCandidateMessageIdentity_(input, {
    position: 'DevOps Engineer',
    sourceJobId: 'bbb222',
    jobUrl: 'https://co.indeed.com/rc/clk/dl?jk=bbb222',
  });

  assert.notEqual(first, second);
  assert.notEqual(
    context.buildJobOpsBatchJobId_(input, { sourceJobId: 'aaa111' }),
    context.buildJobOpsBatchJobId_(input, { sourceJobId: 'bbb222' }),
  );
});

test('AI evidence strips email addresses, footer data and personalized URLs', () => {
  const context = loadJobOpsContext();
  const stripped = context.stripJobOpsAiNoise_(
    'DevOps Engineer\nAcme\nsteve@example.com\nAdministrar esta alerta de empleo\nsecret-token',
  );
  const links = context.buildJobOpsIndeedJobLinks_([
    'https://co.indeed.com/rc/clk/dl?jk=aaa111&tk=private-token',
  ]);
  const redacted = context.redactJobOpsAiUrls_(
    'DevOps Engineer <https://co.indeed.com/rc/clk/dl?jk=aaa111&tk=private-token>',
    links,
  );

  assert.ok(stripped.includes('DevOps Engineer'));
  assert.ok(stripped.includes('[email removed]'));
  assert.equal(stripped.includes('secret-token'), false);
  assert.ok(redacted.includes('JOB_LINK_1'));
  assert.ok(redacted.includes('sourceJobId=aaa111'));
  assert.equal(redacted.includes('private-token'), false);
});
