const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('ElEmpleo application confirmations are ignored as administrative messages', () => {
  const context = loadJobOpsContext();

  assert.equal(
    context.isJobOpsAdministrativeMessage_({
      subject: 'Te has postulado a una oferta de empleo exitosamente',
      body: 'Tu postulación fue enviada.',
    }),
    true,
  );
});

test('sponsored Indeed jobs without source IDs use a stable content dedup key', () => {
  const context = loadJobOpsContext();
  const first = context.buildJobOpsDeduplicationKey_({
    source: 'Indeed',
    sourceJobId: '',
    jobUrl: 'https://co.indeed.com/pagead/clk/dl?ad=tracking-one&tmtk=abc',
    company: 'AMS DataSerfs, Inc',
    position: 'Enterprise Storage Systems Engineer',
    location: 'Bogotá, Cundinamarca',
    messageId: 'message-1',
  });
  const second = context.buildJobOpsDeduplicationKey_({
    source: 'Indeed',
    sourceJobId: '',
    jobUrl: 'https://co.indeed.com/pagead/clk/dl?ad=tracking-two&tmtk=xyz',
    company: 'AMS DataSerfs, Inc',
    position: 'Enterprise Storage Systems Engineer',
    location: 'Bogotá, Cundinamarca',
    messageId: 'message-2',
  });

  assert.match(first, /^CONTENT:indeed\|/u);
  assert.equal(first, second);
});

test('normal Indeed jobs with source IDs still use the exact source job key', () => {
  const context = loadJobOpsContext();
  const key = context.buildJobOpsDeduplicationKey_({
    source: 'Indeed',
    sourceJobId: 'abc123',
    jobUrl: 'https://co.indeed.com/rc/clk/dl?jk=abc123',
    company: 'Acme',
    position: 'DevOps Engineer',
    location: 'Bogotá',
    messageId: 'message-3',
  });

  assert.equal(key, 'SOURCE:indeed|abc123');
});
