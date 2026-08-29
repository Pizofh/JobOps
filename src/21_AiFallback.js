/* global JOBOPS_ERROR_CODES, JOBOPS_GEMINI_DEFAULT_MODEL, PropertiesService */
/* global UrlFetchApp, Utilities */
/* global applyJobOpsSemanticRoleEvidence_, buildJobOpsAiEmailEvidence_ */
/* global buildJobOpsAiRoleFamilyEvidence_, buildJobOpsSemanticGeminiRequest_ */
/* global createJobOpsError_, extractJobOpsGeminiResponseText_, foldJobOpsText_ */
/* global normalizeJobOpsAiJob_, normalizeJobOpsMultilineText_, normalizeJobOpsSingleLineText_ */
/* global validateJobOpsAiJobs_, validateJobOpsSemanticRoleFamily_ */

const JOBOPS_GROQ_DEFAULT_MODEL = 'openai/gpt-oss-20b';
const JOBOPS_OPENROUTER_DEFAULT_MODEL = 'openrouter/free';
const JOBOPS_AI_RETRYABLE_STATUSES = Object.freeze([0, 429, 500, 502, 503, 504]);
const JOBOPS_AI_BACKOFF_MS = Object.freeze([750, 1500]);
const JOBOPS_AI_MAX_RETRY_AFTER_MS = 5000;
const JOBOPS_GROQ_MAX_PROMPT_CHARS = 22000;

/**
 * Returns true when at least one optional AI provider key is configured.
 *
 * @returns {boolean}
 */
function isJobOpsAiConfigured_() {
  const properties = PropertiesService.getScriptProperties();
  return ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'].some((key) =>
    Boolean(normalizeJobOpsSingleLineText_(properties.getProperty(key))),
  );
}

/**
 * Reads the configured provider chain without exposing keys.
 *
 * @param {string[]=} providerNames
 * @returns {Object[]}
 */
function readJobOpsAiProviderSettings_(providerNames) {
  const properties = PropertiesService.getScriptProperties();
  const allowedNames = Array.isArray(providerNames)
    ? new Set(providerNames.map(foldJobOpsText_))
    : null;
  const definitions = [
    {
      name: 'gemini',
      displayName: 'Gemini',
      apiKeyProperty: 'GEMINI_API_KEY',
      modelProperty: 'GEMINI_MODEL',
      defaultModel: JOBOPS_GEMINI_DEFAULT_MODEL,
    },
    {
      name: 'groq',
      displayName: 'Groq',
      apiKeyProperty: 'GROQ_API_KEY',
      modelProperty: 'GROQ_MODEL',
      defaultModel: JOBOPS_GROQ_DEFAULT_MODEL,
    },
    {
      name: 'openrouter',
      displayName: 'OpenRouter',
      apiKeyProperty: 'OPENROUTER_API_KEY',
      modelProperty: 'OPENROUTER_MODEL',
      defaultModel: JOBOPS_OPENROUTER_DEFAULT_MODEL,
    },
  ];

  return definitions
    .filter((definition) => !allowedNames || allowedNames.has(definition.name))
    .map((definition) => {
      const apiKey = normalizeJobOpsSingleLineText_(
        properties.getProperty(definition.apiKeyProperty),
      );
      let model = normalizeJobOpsSingleLineText_(properties.getProperty(definition.modelProperty));
      if (definition.name === 'gemini' && (!model || model === 'gemini-2.5-flash-lite')) {
        model = JOBOPS_GEMINI_DEFAULT_MODEL;
      }
      model = model || definition.defaultModel;

      if (apiKey && !/^[A-Za-z0-9._:/-]{3,120}$/u.test(model)) {
        throw createJobOpsError_(
          JOBOPS_ERROR_CODES.CONFIGURATION,
          `${definition.modelProperty} is invalid.`,
        );
      }

      return apiKey ? { ...definition, apiKey, model } : null;
    })
    .filter(Boolean);
}

/**
 * Extracts jobs and semantic role families using the first healthy configured
 * provider. Provider order is Gemini -> Groq -> OpenRouter.
 *
 * @param {Object} input
 * @param {Object} detection
 * @param {Object[]} roleFamilies
 * @param {string[]=} providerNames
 * @returns {Object[]}
 */
function extractJobOpsPlatformJobsWithSemanticAi_(input, detection, roleFamilies, providerNames) {
  const evidence = {
    ...buildJobOpsAiEmailEvidence_(input, detection),
    roleFamilies: buildJobOpsAiRoleFamilyEvidence_(roleFamilies),
  };
  const sourceName = normalizeJobOpsSingleLineText_(detection.source) || 'platform';

  if (evidence.jobLinks.length === 0) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.PARSER,
      `No individual ${sourceName} job links were extracted locally.`,
    );
  }

  const providers = readJobOpsAiProviderSettings_(providerNames);
  if (providers.length === 0) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.CONFIGURATION,
      'No AI provider API key is configured.',
    );
  }

  const semanticRequest = buildJobOpsSemanticGeminiRequest_(evidence);
  const execution = executeJobOpsAiProviderChain_(
    providers,
    semanticRequest,
    (provider, responseText) => {
      const structuredText = extractJobOpsAiProviderResponseText_(provider, responseText);
      let result;
      try {
        result = JSON.parse(structuredText);
      } catch {
        throw createJobOpsError_(
          JOBOPS_ERROR_CODES.AI_OUTPUT,
          `${provider.displayName} structured output was invalid JSON.`,
        );
      }

      const validated = validateJobOpsAiJobs_(result, evidence);
      if (validated.length === 0) {
        throw createJobOpsError_(
          JOBOPS_ERROR_CODES.AI_OUTPUT,
          `${provider.displayName} did not extract any valid ${sourceName} jobs.`,
        );
      }
      return validated;
    },
  );

  return execution.value.map((job) => {
    let normalized = tagJobOpsAiProvider_(
      normalizeJobOpsAiJob_(job, detection),
      execution.provider,
    );
    if (execution.failures.length > 0) {
      const previousProviders = execution.failures
        .map((failure) => failure.displayName)
        .join(' -> ');
      normalized = {
        ...normalized,
        warnings: normalized.warnings.concat(`AI fallback used after ${previousProviders} failed.`),
      };
    }
    const semanticRoleFamily = validateJobOpsSemanticRoleFamily_(job.roleFamily, roleFamilies);
    return applyJobOpsSemanticRoleEvidence_(
      normalized,
      semanticRoleFamily,
      execution.provider.displayName,
    );
  });
}

/**
 * Executes providers in order and falls through on HTTP, network or output
 * failures. A provider may retry transient statuses before the fallback.
 *
 * @param {Object[]} providers
 * @param {Object} semanticRequest
 * @param {Function} onSuccess
 * @param {Function=} fetcher
 * @param {Function=} sleeper
 * @returns {{provider: Object, value: *, failures: Object[], retryCount: number}}
 */
function executeJobOpsAiProviderChain_(providers, semanticRequest, onSuccess, fetcher, sleeper) {
  const failures = [];
  let retryCount = 0;

  for (const provider of providers) {
    const result = requestJobOpsAiProviderWithRetry_(provider, semanticRequest, fetcher, sleeper);
    retryCount += result.retryCount;

    if (!result.ok) {
      failures.push({
        name: provider.name,
        displayName: provider.displayName,
        model: provider.model,
        status: result.status,
        attempts: result.attempts,
        detail: result.detail,
      });
      continue;
    }

    try {
      return {
        provider,
        value: onSuccess(provider, result.responseText),
        failures,
        retryCount,
      };
    } catch (error) {
      failures.push({
        name: provider.name,
        displayName: provider.displayName,
        model: provider.model,
        status: result.status,
        attempts: result.attempts,
        detail: sanitizeJobOpsAiDetail_(error && error.message, provider.apiKey),
      });
    }
  }

  throw buildJobOpsAiAggregateError_(failures, retryCount);
}

/**
 * Performs one provider request with bounded retry/backoff.
 *
 * @param {Object} provider
 * @param {Object} semanticRequest
 * @param {Function=} fetcher
 * @param {Function=} sleeper
 * @returns {{ok: boolean, status: number, attempts: number, retryCount: number, responseText: string, detail: string}}
 */
function requestJobOpsAiProviderWithRetry_(provider, semanticRequest, fetcher, sleeper) {
  const request = buildJobOpsAiHttpRequest_(provider, semanticRequest);
  const fetchFunction =
    fetcher ||
    ((url, options) => {
      return UrlFetchApp.fetch(url, options);
    });
  const sleepFunction =
    sleeper ||
    ((milliseconds) => {
      Utilities.sleep(milliseconds);
    });

  let attempts = 0;
  let status = 0;
  let detail = '';

  while (true) {
    attempts += 1;
    let response = null;
    let responseText = '';

    try {
      response = fetchFunction(request.url, request.options);
      status = Number(response.getResponseCode()) || 0;
      responseText = String(response.getContentText() || '');
    } catch (error) {
      status = 0;
      detail = sanitizeJobOpsAiDetail_(
        error && error.message ? error.message : 'Request failed before an HTTP response.',
        provider.apiKey,
      );
    }

    if (response && status >= 200 && status < 300) {
      return {
        ok: true,
        status,
        attempts,
        retryCount: attempts - 1,
        responseText,
        detail: '',
      };
    }

    if (response) {
      detail = extractJobOpsAiErrorDetail_(responseText, provider.apiKey);
    }

    const maximumAttempts = status === 429 ? 2 : isJobOpsAiRetryableStatus_(status) ? 3 : 1;
    if (attempts >= maximumAttempts) {
      return {
        ok: false,
        status,
        attempts,
        retryCount: attempts - 1,
        responseText,
        detail,
      };
    }

    const delay = getJobOpsAiRetryDelayMs_(response, attempts);
    if (delay > 0) {
      sleepFunction(delay);
    }
  }
}

/**
 * Builds one HTTP request for Gemini or an OpenAI-compatible provider.
 *
 * @param {Object} provider
 * @param {Object} semanticRequest
 * @returns {{url: string, options: Object}}
 */
function buildJobOpsAiHttpRequest_(provider, semanticRequest) {
  if (provider.name === 'gemini') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        provider.model,
      )}:generateContent`,
      options: {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': provider.apiKey },
        payload: JSON.stringify(semanticRequest),
        muteHttpExceptions: true,
      },
    };
  }

  const payload = buildJobOpsOpenAiSemanticRequest_(semanticRequest, provider);
  const isGroq = provider.name === 'groq';
  const headers = {
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.name === 'openrouter') {
    headers['X-Title'] = 'JobOps';
  }

  return {
    url: isGroq
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions',
    options: {
      method: 'post',
      contentType: 'application/json',
      headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    },
  };
}

/**
 * Converts the existing Gemini semantic request to OpenAI chat-completions
 * structured output without duplicating the extraction prompt.
 *
 * @param {Object} semanticRequest
 * @param {Object} provider
 * @returns {Object}
 */
function buildJobOpsOpenAiSemanticRequest_(semanticRequest, provider) {
  const prompt =
    semanticRequest &&
    semanticRequest.contents &&
    semanticRequest.contents[0] &&
    semanticRequest.contents[0].parts &&
    semanticRequest.contents[0].parts[0]
      ? normalizeJobOpsMultilineText_(semanticRequest.contents[0].parts[0].text)
      : '';
  const schema =
    semanticRequest &&
    semanticRequest.generationConfig &&
    semanticRequest.generationConfig.responseFormat &&
    semanticRequest.generationConfig.responseFormat.text
      ? semanticRequest.generationConfig.responseFormat.text.schema
      : {};

  const payload = {
    model: provider.model,
    messages: [
      {
        role: 'user',
        content:
          provider.name === 'groq'
            ? compactJobOpsAiPrompt_(prompt, JOBOPS_GROQ_MAX_PROMPT_CHARS)
            : prompt,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'jobops_jobs',
        schema: hardenJobOpsAiJsonSchema_(schema),
      },
    },
    stream: false,
  };

  if (provider.name === 'groq') {
    payload.max_completion_tokens = 2200;
  } else {
    payload.max_tokens = 2200;
  }

  return payload;
}

/**
 * Adds additionalProperties=false for strict OpenAI-compatible structured
 * outputs while keeping Gemini's intentionally simpler schema unchanged.
 *
 * @param {*} schema
 * @returns {*}
 */
function hardenJobOpsAiJsonSchema_(schema) {
  if (Array.isArray(schema)) {
    return schema.map(hardenJobOpsAiJsonSchema_);
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const copy = {};
  for (const key of Object.keys(schema)) {
    copy[key] = hardenJobOpsAiJsonSchema_(schema[key]);
  }
  if (copy.type === 'object') {
    copy.additionalProperties = false;
  }
  return copy;
}

/**
 * Extracts JSON text from a provider-specific success response.
 *
 * @param {Object} provider
 * @param {*} responseText
 * @returns {string}
 */
function extractJobOpsAiProviderResponseText_(provider, responseText) {
  let payload;
  try {
    payload = JSON.parse(String(responseText || ''));
  } catch {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.AI_OUTPUT,
      `${provider.displayName} returned invalid JSON.`,
    );
  }

  if (provider.name === 'gemini') {
    return extractJobOpsGeminiResponseText_(payload);
  }

  const content =
    payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : '';
  const text = Array.isArray(content)
    ? content
        .map((part) => normalizeJobOpsMultilineText_(part && (part.text || part.content)))
        .filter(Boolean)
        .join('\n')
    : normalizeJobOpsMultilineText_(content);

  if (!text) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.AI_OUTPUT,
      `${provider.displayName} returned no structured content.`,
    );
  }
  return text;
}

/**
 * Re-tags the legacy Gemini parser metadata for the provider that actually
 * produced the successful response.
 *
 * @param {Object} job
 * @param {Object} provider
 * @returns {Object}
 */
function tagJobOpsAiProvider_(job, provider) {
  const token = provider.displayName.replace(/[^A-Za-z0-9]/gu, '') || 'AI';
  return {
    ...job,
    parserName: job.parserName.replace(/\+Gemini$/u, `+${token}`),
    warnings: job.warnings.map((warning) =>
      warning.replace(/Gemini structured output/gu, `${provider.displayName} structured output`),
    ),
  };
}

/**
 * Returns true for transient HTTP/network statuses.
 *
 * @param {*} status
 * @returns {boolean}
 */
function isJobOpsAiRetryableStatus_(status) {
  return JOBOPS_AI_RETRYABLE_STATUSES.includes(Number(status) || 0);
}

/**
 * Uses Retry-After when short enough; otherwise applies bounded exponential
 * backoff so one bad provider cannot consume the Apps Script runtime.
 *
 * @param {Object|null} response
 * @param {number} attempt
 * @returns {number}
 */
function getJobOpsAiRetryDelayMs_(response, attempt) {
  let retryAfterMs = 0;
  try {
    const headers = response && response.getAllHeaders ? response.getAllHeaders() : {};
    const raw = headers['Retry-After'] || headers['retry-after'] || '';
    const seconds = Number(raw);
    retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  } catch {
    retryAfterMs = 0;
  }

  const backoff =
    JOBOPS_AI_BACKOFF_MS[Math.min(Math.max(attempt - 1, 0), JOBOPS_AI_BACKOFF_MS.length - 1)];
  const delay = Math.max(retryAfterMs || 0, backoff || 0);
  return Math.min(JOBOPS_AI_MAX_RETRY_AFTER_MS, delay);
}

/**
 * Extracts only a safe upstream error message.
 *
 * @param {*} responseText
 * @param {string} apiKey
 * @returns {string}
 */
function extractJobOpsAiErrorDetail_(responseText, apiKey) {
  let detail = '';
  try {
    const payload = JSON.parse(String(responseText || ''));
    detail =
      (payload && payload.error && (payload.error.message || payload.error.status)) ||
      (payload && payload.message) ||
      '';
  } catch {
    detail = '';
  }

  return sanitizeJobOpsAiDetail_(
    detail || 'Provider returned an error response without a readable message.',
    apiKey,
  );
}

/**
 * Removes secrets and incidental personal data from provider diagnostics.
 *
 * @param {*} value
 * @param {string=} apiKey
 * @returns {string}
 */
function sanitizeJobOpsAiDetail_(value, apiKey) {
  let detail = String(value || '')
    .replace(/https?:\/\/\S+/giu, '[url removed]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email removed]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);

  if (apiKey) {
    detail = detail.split(apiKey).join('[redacted]');
  }
  return detail;
}

/**
 * Produces a stable aggregate error that ParsingErrors can store directly.
 *
 * @param {Object[]} failures
 * @param {number} retryCount
 * @returns {Error}
 */
function buildJobOpsAiAggregateError_(failures, retryCount) {
  const statuses = failures.map((failure) => Number(failure.status) || 0);
  const hasUnavailable = statuses.some((status) => [0, 500, 502, 503, 504].includes(status));
  const hasRateLimit = statuses.some((status) => status === 429);
  const code = hasUnavailable
    ? JOBOPS_ERROR_CODES.AI_UNAVAILABLE
    : hasRateLimit
      ? JOBOPS_ERROR_CODES.AI_RATE_LIMIT
      : JOBOPS_ERROR_CODES.AI_PROVIDER;
  const providerTrace = failures
    .map((failure) => {
      const status = failure.status ? `HTTP ${failure.status}` : 'network error';
      const detail = failure.detail ? `: ${failure.detail}` : '';
      return `${failure.displayName}(${failure.model}) ${status} x${failure.attempts}${detail}`;
    })
    .join(' -> ')
    .slice(0, 500);

  return createJobOpsError_(code, `All configured AI providers failed. ${providerTrace}`, {
    retryCount: Math.max(0, Number(retryCount) || 0),
    providerTrace,
  });
}

/**
 * Keeps fallback prompts below Groq free-tier token pressure while preserving
 * the beginning (job cards) and end (allowed links + role families).
 *
 * @param {*} prompt
 * @param {number} maximumCharacters
 * @returns {string}
 */
function compactJobOpsAiPrompt_(prompt, maximumCharacters) {
  const text = normalizeJobOpsMultilineText_(prompt);
  const maximum = Math.max(2000, Number(maximumCharacters) || 0);
  if (text.length <= maximum) {
    return text;
  }

  const tailLength = Math.min(6000, Math.floor(maximum / 3));
  const headLength = maximum - tailLength;
  const head = text.slice(0, headLength);
  const tail = text.slice(-tailLength);
  return `${head}\n[...middle omitted for provider token limit...]\n${tail}`;
}