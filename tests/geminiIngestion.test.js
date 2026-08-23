const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('Gemini validation keeps separate Indeed jobs from one digest', () => {
  const context = loadJobOpsContext();
  const evidence = {
    allowedSourceJobIds: ['aaa111', 'bbb222'],
    allowedUrls: [
      'https://co.indeed.com/rc/clk/dl?jk=aaa111',
      'https://co.indeed.com/rc/clk/dl?jk=bbb222',
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
          jobUrl: 'https://co.indeed.com/rc/clk/dl?jk=aaa111',
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
          jobUrl: 'https://co.indeed.com/rc/clk/dl?jk=bbb222',
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
  assert.equal(jobs[1].sourceJobId, 'bbb222');
});

test('Gemini validation rejects hallucinated identifiers and URLs', () => {
  const context = loadJobOpsContext();
  const evidence = {
    allowedSourceJobIds: ['real123'],
    allowedUrls: ['https://co.indeed.com/rc/clk/dl?jk=real123'],
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
          jobUrl: 'https://co.indeed.com/rc/clk/dl?jk=fake999',
          sourceJobId: 'fake999',
          requiredTechnologies: [],
          descriptionText: '',
        },
      ],
    },
    evidence,
  );

  assert.equal(jobs.length, 0);
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
  assert.notEqual(context.buildJobOpsBatchJobId_(input, { sourceJobId: 'aaa111' }), context.buildJobOpsBatchJobId_(input, { sourceJobId: 'bbb222' }));
});

test('AI evidence strips email addresses and Indeed account-management footer', () => {
  const context = loadJobOpsContext();
  const sanitized = context.stripJobOpsAiNoise_(
    'DevOps Engineer\nAcme\nsteve@example.com\nAdministrar esta alerta de empleo\nsecret-token',
  );

  assert.ok(sanitized.includes('DevOps Engineer'));
  assert.ok(sanitized.includes('[email removed]'));
  assert.equal(sanitized.includes('secret-token'), false);
});
