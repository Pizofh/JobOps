const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

function response(status, body, headers = {}) {
  return {
    getResponseCode() {
      return status;
    },
    getContentText() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    getAllHeaders() {
      return headers;
    },
  };
}

function semanticRequest(context) {
  const evidence = {
    source: 'LinkedIn',
    subject: 'Platform roles',
    body: 'Platform Engineer',
    jobLinks: [{ ref: 'JOB_LINK_1', sourceJobId: '123' }],
    roleFamilies: [
      {
        roleFamily: 'PLATFORM_SRE_ASSOCIATE',
        strategicLevel: 'DIRECT',
        examples: ['platform engineer'],
      },
    ],
  };
  return context.buildJobOpsSemanticGeminiRequest_(evidence);
}

test('AI provider chain retries Gemini 503 and then falls back to Groq', () => {
  const context = loadJobOpsContext();
  const providers = [
    {
      name: 'gemini',
      displayName: 'Gemini',
      apiKey: 'gemini-key',
      model: 'gemini-test',
    },
    {
      name: 'groq',
      displayName: 'Groq',
      apiKey: 'groq-key',
      model: 'openai/gpt-oss-20b',
    },
  ];
  let calls = 0;
  const sleeps = [];

  const result = context.executeJobOpsAiProviderChain_(
    providers,
    semanticRequest(context),
    (provider, responseText) => ({ provider: provider.name, responseText }),
    () => {
      calls += 1;
      if (calls <= 3) {
        return response(503, { error: { message: 'temporarily unavailable' } });
      }
      return response(200, {
        choices: [{ message: { content: '{"jobs":[]}' } }],
      });
    },
    (milliseconds) => sleeps.push(milliseconds),
  );

  assert.equal(result.provider.name, 'groq');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].status, 503);
  assert.equal(result.failures[0].attempts, 3);
  assert.equal(result.retryCount, 2);
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [750, 1500]);
});

test('HTTP 429 gets one bounded retry before provider fallback', () => {
  const context = loadJobOpsContext();
  const provider = {
    name: 'gemini',
    displayName: 'Gemini',
    apiKey: 'gemini-key',
    model: 'gemini-test',
  };
  let calls = 0;
  const sleeps = [];

  const result = context.requestJobOpsAiProviderWithRetry_(
    provider,
    semanticRequest(context),
    () => {
      calls += 1;
      return response(429, { error: { message: 'quota exceeded' } }, { 'Retry-After': '1' });
    },
    (milliseconds) => sleeps.push(milliseconds),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.attempts, 2);
  assert.equal(result.retryCount, 1);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
});

test('aggregate AI error classifies quota failures and records safe provider trace', () => {
  const context = loadJobOpsContext();
  const error = context.buildJobOpsAiAggregateError_(
    [
      {
        displayName: 'Gemini',
        model: 'gemini-test',
        status: 429,
        attempts: 2,
        detail: 'quota exceeded',
      },
      {
        displayName: 'Groq',
        model: 'openai/gpt-oss-20b',
        status: 429,
        attempts: 2,
        detail: 'rate limit',
      },
    ],
    2,
  );

  assert.equal(error.code, 'AI_RATE_LIMIT');
  assert.equal(error.details.retryCount, 2);
  assert.match(error.details.providerTrace, /Gemini\(gemini-test\) HTTP 429 x2/u);
  assert.match(error.details.providerTrace, /Groq\(openai\/gpt-oss-20b\) HTTP 429 x2/u);
});

test('OpenAI-compatible request uses strict JSON schema and never embeds provider keys', () => {
  const context = loadJobOpsContext();
  const provider = {
    name: 'groq',
    displayName: 'Groq',
    apiKey: 'secret-key-value',
    model: 'openai/gpt-oss-20b',
  };
  const built = context.buildJobOpsAiHttpRequest_(provider, semanticRequest(context));
  const payload = JSON.parse(built.options.payload);

  assert.equal(built.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(built.options.headers.Authorization, 'Bearer secret-key-value');
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(payload.response_format.json_schema.schema.properties.jobs.items.additionalProperties, false);
  assert.equal(built.options.payload.includes('secret-key-value'), false);
});
