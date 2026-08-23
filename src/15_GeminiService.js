const JOBOPS_GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const JOBOPS_GEMINI_MAX_INPUT_CHARS = 30000;

/**
 * Parses one candidate email into one or more normalized jobs.
 * Indeed alert digests use Gemini when GEMINI_API_KEY is configured; all other
 * sources keep the deterministic parser path.
 *
 * @param {Object} input
 * @param {Object[]} sourceDefinitions
 * @returns {Object[]}
 */
function parseJobOpsMessageBatch_(input, sourceDefinitions) {
  assertValidJobOpsParserInput_(input);
  const detection = detectJobOpsSource_(input, sourceDefinitions);

  if (!detection.candidate) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.SOURCE_NOT_DETECTED,
      'Message did not match a configured source or conservative recruiter signals.',
    );
  }

  if (foldJobOpsText_(detection.source) === 'indeed' && isJobOpsGeminiConfigured_()) {
    return extractJobOpsIndeedJobsWithGemini_(input, detection).map((parsed) => ({
      ...parsed,
      detection,
    }));
  }

  const parsed = parseJobOpsDetectedSource_(input, detection);
  return [{ ...parsed, detection }];
}

/**
 * Returns true only when an API key exists. Gemini is therefore opt-in without
 * adding another required spreadsheet setting.
 *
 * @returns {boolean}
 */
function isJobOpsGeminiConfigured_() {
  return Boolean(
    normalizeJobOpsSingleLineText_(
      PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
    ),
  );
}

/**
 * Reads optional Gemini settings from Script Properties without logging them.
 * The retired 2.5 Flash Lite model is migrated in runtime so an old property
 * does not break users who cannot edit Script Properties immediately.
 *
 * @returns {{apiKey: string, model: string}}
 */
function readJobOpsGeminiSettings_() {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = normalizeJobOpsSingleLineText_(properties.getProperty('GEMINI_API_KEY'));
  const configuredModel = normalizeJobOpsSingleLineText_(properties.getProperty('GEMINI_MODEL'));
  const model =
    !configuredModel || configuredModel === 'gemini-2.5-flash-lite'
      ? JOBOPS_GEMINI_DEFAULT_MODEL
      : configuredModel;

  if (!apiKey) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, 'GEMINI_API_KEY is not configured.');
  }

  if (!/^[A-Za-z0-9._-]{3,100}$/u.test(model)) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, 'GEMINI_MODEL is invalid.');
  }

  return { apiKey, model };
}

/**
 * Uses Gemini structured output to fan one Indeed digest out into separate jobs.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {Object[]}
 */
function extractJobOpsIndeedJobsWithGemini_(input, detection) {
  const settings = readJobOpsGeminiSettings_();
  const evidence = buildJobOpsAiEmailEvidence_(input, detection);
  const request = buildJobOpsGeminiRequest_(evidence);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    settings.model,
  )}:generateContent`;

  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': settings.apiKey },
      payload: JSON.stringify(request),
      muteHttpExceptions: true,
    });
  } catch (error) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.PARSER,
      `Gemini request failed: ${error && error.message ? error.message : 'Unknown error'}`,
    );
  }

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.PARSER, `Gemini returned HTTP ${status}.`);
  }

  let payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.PARSER, 'Gemini returned invalid JSON.');
  }

  const text = extractJobOpsGeminiResponseText_(payload);
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.PARSER,
      'Gemini structured output was invalid JSON.',
    );
  }

  const validated = validateJobOpsAiJobs_(result, evidence);
  if (validated.length === 0) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.PARSER,
      'Gemini did not extract any valid Indeed jobs.',
    );
  }

  return validated.map((job) => normalizeJobOpsAiJob_(job, detection));
}

/**
 * Creates privacy-limited evidence for Gemini. Personalized Indeed URLs remain
 * local and are represented to the model only by opaque JOB_LINK_n references.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {{source: string, subject: string, body: string, jobLinks: Object[]}}
 */
function buildJobOpsAiEmailEvidence_(input, detection) {
  const effective = detection.effective || getEffectiveJobOpsMessage_(input);
  const urls = extractJobOpsUrls_(`${effective.body}\n${input.htmlBody || ''}`);
  const jobLinks = buildJobOpsIndeedJobLinks_(urls);
  const body = redactJobOpsAiUrls_(stripJobOpsAiNoise_(effective.body), jobLinks).slice(
    0,
    JOBOPS_GEMINI_MAX_INPUT_CHARS,
  );

  return {
    source: detection.source,
    subject: normalizeJobOpsSingleLineText_(effective.subject).slice(0, 1000),
    body,
    jobLinks,
  };
}

/**
 * Keeps only Indeed links that look like individual job cards and assigns an
 * opaque reference. The original URL is retained locally for later storage.
 *
 * @param {string[]} urls
 * @returns {{ref: string, url: string, sourceJobId: string}[]}
 */
function buildJobOpsIndeedJobLinks_(urls) {
  const links = [];
  const seen = new Set();

  for (const url of urls) {
    const canonicalUrl = canonicalizeJobOpsUrl_(url);
    const host = getJobOpsUrlHost_(canonicalUrl);
    const sourceJobId = extractJobOpsSourceJobId_(canonicalUrl);
    const looksLikeJobCard =
      sourceJobId || /\/rc\/clk\/dl(?:\?|$)|\/pagead\/clk\/dl(?:\?|$)/iu.test(canonicalUrl);

    if (!/(?:^|\.)indeed\.com$/iu.test(host) || !looksLikeJobCard || seen.has(canonicalUrl)) {
      continue;
    }

    seen.add(canonicalUrl);
    links.push({
      ref: `JOB_LINK_${links.length + 1}`,
      url: canonicalUrl,
      sourceJobId,
    });
  }

  return links;
}

/**
 * Removes common footer and account-management noise before an email is sent to
 * Gemini. Email addresses are removed as well.
 *
 * @param {*} value
 * @returns {string}
 */
function stripJobOpsAiNoise_(value) {
  return normalizeJobOpsMultilineText_(value)
    .replace(/\n(?:No compartas este email|Do not share this email)[\s\S]*$/iu, '')
    .replace(/\n(?:Administrar esta alerta de empleo|Manage this job alert)[\s\S]*$/iu, '')
    .replace(/\n(?:Cancelar suscripci[oó]n|Unsubscribe)[\s\S]*$/iu, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email removed]')
    .trim();
}

/**
 * Replaces URLs with opaque job-link references or a generic removed marker.
 * Personalized tracking/query values therefore never enter the Gemini prompt.
 *
 * @param {*} value
 * @param {{ref: string, url: string, sourceJobId: string}[]} jobLinks
 * @returns {string}
 */
function redactJobOpsAiUrls_(value, jobLinks) {
  const references = new Map(jobLinks.map((link) => [canonicalizeJobOpsUrl_(link.url), link]));

  return normalizeJobOpsMultilineText_(value).replace(/https?:\/\/[^\s<>"']+/giu, (rawUrl) => {
    const canonicalUrl = canonicalizeJobOpsUrl_(rawUrl);
    const link = references.get(canonicalUrl);
    if (!link) {
      return '[link removed]';
    }
    return link.sourceJobId ? `[${link.ref} sourceJobId=${link.sourceJobId}]` : `[${link.ref}]`;
  });
}

/**
 * Extracts a hostname without depending on the URL class in Apps Script tests.
 *
 * @param {*} value
 * @returns {string}
 */
function getJobOpsUrlHost_(value) {
  const match = canonicalizeJobOpsUrl_(value).match(/^https?:\/\/([^/]+)/iu);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Builds the Gemini generateContent request with strict structured output using
 * the responseFormat shape required by current Gemini 3.5+ REST models.
 *
 * @param {Object} evidence
 * @returns {Object}
 */
function buildJobOpsGeminiRequest_(evidence) {
  const allowedLinks = evidence.jobLinks
    .map((link) => `${link.ref}${link.sourceJobId ? ` sourceJobId=${link.sourceJobId}` : ''}`)
    .join('\n');
  const prompt = [
    'Extract every distinct job vacancy explicitly present in this Indeed job-alert email.',
    'Do not invent vacancies, companies, technologies, salary, experience, work mode, or link references.',
    'One email can contain many independent job cards. Return one array item per vacancy.',
    'Use an empty string or empty array when a field is absent.',
    'jobLinkRef must be one of the allowed JOB_LINK_n references associated with that vacancy.',
    'sourceJobId must match the identifier shown beside that JOB_LINK_n when one is present.',
    '',
    `SUBJECT:\n${evidence.subject}`,
    '',
    `BODY:\n${evidence.body}`,
    '',
    `ALLOWED_JOB_LINKS:\n${allowedLinks}`,
  ].join('\n');

  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: 'APPLICATION_JSON',
          schema: getJobOpsGeminiJobSchema_(),
        },
      },
    },
  };
}

/**
 * JSON Schema for Gemini structured output.
 *
 * @returns {Object}
 */
function getJobOpsGeminiJobSchema_() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      jobs: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            position: { type: 'string' },
            company: { type: 'string' },
            location: { type: 'string' },
            salary: { type: 'string' },
            experienceRequested: { type: 'string' },
            workMode: { type: 'string', enum: ['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'] },
            jobLinkRef: { type: 'string' },
            sourceJobId: { type: 'string' },
            requiredTechnologies: { type: 'array', items: { type: 'string' }, maxItems: 30 },
            descriptionText: { type: 'string' },
          },
          required: [
            'position',
            'company',
            'location',
            'salary',
            'experienceRequested',
            'workMode',
            'jobLinkRef',
            'sourceJobId',
            'requiredTechnologies',
            'descriptionText',
          ],
        },
      },
    },
    required: ['jobs'],
  };
}

/**
 * Extracts all text parts from a Gemini generateContent response.
 *
 * @param {Object} payload
 * @returns {string}
 */
function extractJobOpsGeminiResponseText_(payload) {
  const parts =
    payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content
      ? payload.candidates[0].content.parts || []
      : [];
  const text = parts
    .map((part) => normalizeJobOpsMultilineText_(part.text))
    .filter(Boolean)
    .join('\n');

  if (!text) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.PARSER, 'Gemini returned no structured content.');
  }
  return text;
}

/**
 * Validates model output against local evidence. The model never supplies the
 * stored URL; JobOps reconstructs it from the opaque jobLinkRef.
 *
 * @param {*} result
 * @param {Object} evidence
 * @returns {Object[]}
 */
function validateJobOpsAiJobs_(result, evidence) {
  if (!result || !Array.isArray(result.jobs)) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.PARSER, 'Gemini output is missing jobs[].');
  }

  const linksByRef = new Map(evidence.jobLinks.map((link) => [link.ref, link]));
  const seen = new Set();
  const jobs = [];

  for (const rawJob of result.jobs) {
    const position = cleanJobOpsParsedField_(rawJob && rawJob.position);
    const company = cleanJobOpsParsedField_(rawJob && rawJob.company);
    const jobLinkRef = normalizeJobOpsSingleLineText_(rawJob && rawJob.jobLinkRef);
    const link = linksByRef.get(jobLinkRef);

    if (!position || !company || !link) {
      continue;
    }

    const modelSourceJobId = normalizeJobOpsSingleLineText_(rawJob && rawJob.sourceJobId).slice(
      0,
      200,
    );
    if (modelSourceJobId && link.sourceJobId && modelSourceJobId !== link.sourceJobId) {
      continue;
    }

    const sourceJobId = link.sourceJobId || modelSourceJobId;
    const jobUrl = link.url;
    const identity = sourceJobId ? `ID:${sourceJobId}` : `URL:${jobUrl}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);

    jobs.push({ ...rawJob, position, company, sourceJobId, jobUrl });
  }

  return jobs;
}

/**
 * Maps validated AI output to the same parser contract used by JobOps.
 *
 * @param {Object} job
 * @param {Object} detection
 * @returns {Object}
 */
function normalizeJobOpsAiJob_(job, detection) {
  const descriptionText = normalizeJobOpsMultilineText_(job.descriptionText).slice(0, 20000);
  const technologies = Array.isArray(job.requiredTechnologies)
    ? job.requiredTechnologies.map(cleanJobOpsParsedField_).filter(Boolean)
    : [];
  const normalizedWorkMode = normalizeJobOpsSingleLineText_(job.workMode).toUpperCase();

  return {
    source: detection.source,
    sourceJobId: job.sourceJobId,
    company: job.company,
    position: job.position,
    location: cleanJobOpsParsedField_(job.location),
    workMode: JOBOPS_WORK_MODES.includes(normalizedWorkMode) ? normalizedWorkMode : 'UNKNOWN',
    jobUrl: job.jobUrl,
    salary: cleanJobOpsParsedField_(job.salary),
    experienceRequested: cleanJobOpsParsedField_(job.experienceRequested),
    requiredTechnologies: Array.from(new Set(technologies)).slice(0, 30),
    descriptionText,
    recruiterName: '',
    recruiterEmail: '',
    parserName: 'parseIndeedJob+Gemini',
    parserVersion: JOBOPS_PARSER_VERSION,
    confidence: job.sourceJobId && job.jobUrl ? 0.95 : 0.8,
    warnings: ['Extracted from a multi-job Indeed alert with Gemini structured output.'],
  };
}

/**
 * Creates a per-vacancy identity while retaining the original Gmail message ID
 * in the spreadsheet. This prevents jobs from the same digest from colliding.
 *
 * @param {Object} input
 * @param {Object} parsed
 * @returns {string}
 */
function buildJobOpsCandidateMessageIdentity_(input, parsed) {
  const messageId = normalizeJobOpsSingleLineText_(input.messageId);
  const sourceJobId = normalizeJobOpsSingleLineText_(parsed.sourceJobId);
  const jobUrl = canonicalizeJobOpsUrl_(parsed.jobUrl);
  const suffix = sourceJobId || jobUrl || normalizeJobOpsSingleLineText_(parsed.position);
  return suffix ? `${messageId}#${hashJobOpsText_(suffix)}` : messageId;
}

/**
 * Creates a unique JOB_ID for each vacancy inside one digest.
 *
 * @param {Object} input
 * @param {Object} parsed
 * @returns {string}
 */
function buildJobOpsBatchJobId_(input, parsed) {
  return buildJobOpsJobId_(buildJobOpsCandidateMessageIdentity_(input, parsed));
}
