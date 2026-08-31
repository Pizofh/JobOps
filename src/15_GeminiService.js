const JOBOPS_GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const JOBOPS_GEMINI_MAX_INPUT_CHARS = 30000;
const JOBOPS_GEMINI_MULTI_JOB_SOURCES = Object.freeze(['indeed', 'linkedin']);

/**
 * Legacy two-argument batch parser retained for diagnostics and backwards
 * compatibility. The canonical ingestion entrypoint lives in
 * 20_SemanticClassification.js.
 *
 * @param {Object} input
 * @param {Object[]} sourceDefinitions
 * @returns {Object[]}
 */
function parseJobOpsMessageBatchLegacy_(input, sourceDefinitions) {
  assertValidJobOpsParserInput_(input);
  const detection = detectJobOpsSource_(input, sourceDefinitions);

  if (!detection.candidate) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.SOURCE_NOT_DETECTED,
      'Message did not match a configured source or conservative recruiter signals.',
    );
  }

  const source = foldJobOpsText_(detection.source);
  if (JOBOPS_GEMINI_MULTI_JOB_SOURCES.includes(source) && isJobOpsGeminiConfigured_()) {
    return extractJobOpsPlatformJobsWithGemini_(input, detection).map((parsed) => ({
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
 * Uses Gemini structured output to fan one supported platform digest out into
 * separate jobs.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {Object[]}
 */
function extractJobOpsPlatformJobsWithGemini_(input, detection) {
  const settings = readJobOpsGeminiSettings_();
  const evidence = buildJobOpsAiEmailEvidence_(input, detection);
  const sourceName = normalizeJobOpsSingleLineText_(detection.source) || 'platform';
  if (evidence.jobLinks.length === 0) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.PARSER,
      `No individual ${sourceName} job links were extracted locally.`,
    );
  }

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
      `Gemini did not extract any valid ${sourceName} jobs.`,
    );
  }

  return validated.map((job) => normalizeJobOpsAiJob_(job, detection));
}

/**
 * Backwards-compatible Indeed wrapper used by diagnostics and older callers.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {Object[]}
 */
function extractJobOpsIndeedJobsWithGemini_(input, detection) {
  return extractJobOpsPlatformJobsWithGemini_(input, detection);
}

/**
 * LinkedIn wrapper kept explicit for diagnostics and tests.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {Object[]}
 */
function extractJobOpsLinkedInJobsWithGemini_(input, detection) {
  return extractJobOpsPlatformJobsWithGemini_(input, detection);
}

/**
 * Creates privacy-limited evidence for Gemini. Personalized platform URLs
 * remain local and are represented to the model only by opaque JOB_LINK_n
 * references.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {{source: string, subject: string, body: string, jobLinks: Object[]}}
 */
function buildJobOpsAiEmailEvidence_(input, detection) {
  const effective = detection.effective || getEffectiveJobOpsMessage_(input);
  const urls = extractJobOpsUrls_(`${effective.body}\n${input.htmlBody || ''}`);
  const source = foldJobOpsText_(detection.source);
  const jobLinks =
    source === 'linkedin' ? buildJobOpsLinkedInJobLinks_(urls) : buildJobOpsIndeedJobLinks_(urls);
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
 * Keeps individual LinkedIn job-detail links only. Personalized query strings
 * remain as a local match URL, while the stored URL is reconstructed from the
 * public numeric job identifier and contains no tracking tokens.
 *
 * @param {string[]} urls
 * @returns {{ref: string, url: string, matchUrl: string, sourceJobId: string}[]}
 */
function buildJobOpsLinkedInJobLinks_(urls) {
  const links = [];
  const seen = new Set();

  for (const url of urls) {
    const canonicalUrl = canonicalizeJobOpsUrl_(url);
    const host = getJobOpsUrlHost_(canonicalUrl);
    const sourceJobId = extractJobOpsSourceJobId_(canonicalUrl);
    const looksLikeJobCard = /\/jobs\/view\/[A-Za-z0-9_-]{4,}/iu.test(canonicalUrl);

    if (
      !/(?:^|\.)linkedin\.com$/iu.test(host) ||
      !sourceJobId ||
      !looksLikeJobCard ||
      seen.has(sourceJobId)
    ) {
      continue;
    }

    seen.add(sourceJobId);
    links.push({
      ref: `JOB_LINK_${links.length + 1}`,
      url: `https://www.linkedin.com/jobs/view/${encodeURIComponent(sourceJobId)}/`,
      matchUrl: canonicalUrl,
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
    .replace(/\n(?:Administrar tus alertas de empleo|Manage your job alerts)[\s\S]*$/iu, '')
    .replace(/\n(?:Cancelar suscripci[oó]n|Unsubscribe)[\s\S]*$/iu, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email removed]')
    .trim();
}

/**
 * Replaces URLs with opaque job-link references or a generic removed marker.
 * Personalized tracking/query values therefore never enter the Gemini prompt.
 *
 * @param {*} value
 * @param {{ref: string, url: string, matchUrl?: string, sourceJobId: string}[]} jobLinks
 * @returns {string}
 */
function redactJobOpsAiUrls_(value, jobLinks) {
  const references = new Map();
  for (const link of jobLinks) {
    references.set(canonicalizeJobOpsUrl_(link.matchUrl || link.url), link);
    references.set(canonicalizeJobOpsUrl_(link.url), link);
  }

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
  const sourceName = normalizeJobOpsSingleLineText_(evidence.source) || 'job-platform';
  const prompt = [
    `Extract every distinct job vacancy explicitly present in this ${sourceName} job-alert email.`,
    'Do not invent vacancies, companies, technologies, salary, experience, work mode, or link references.',
    'One email can contain many independent job cards. Return one array item per vacancy.',
    'Use an empty string or empty array when a field is absent.',
    'For fit evidence, extract facts only. Do not judge the candidate or invent missing requirements.',
    'seniorityLevel must be ENTRY, JUNIOR, ASSOCIATE, MID, SENIOR, LEAD, STAFF, PRINCIPAL, MANAGER, DIRECTOR, or UNKNOWN.',
    'minimumYearsOverall must be the explicit general minimum years requested, or 0 when absent.',
    'experienceRequirements must contain explicit technology/domain years such as "Terraform: 5 years" only when stated.',
    'hardRequirements must contain explicit must-have requirements only.',
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
 * Conservative JSON Schema for Gemini structured output. Validation constraints
 * such as enums, maxItems and additionalProperties are enforced locally instead
 * of being sent to the model because some Gemini 3.5 Flash-Lite REST backends
 * reject richer schema keywords with a generic INVALID_ARGUMENT.
 *
 * @returns {Object}
 */
function getJobOpsGeminiJobSchema_() {
  return {
    type: 'object',
    properties: {
      jobs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'string' },
            company: { type: 'string' },
            location: { type: 'string' },
            salary: { type: 'string' },
            experienceRequested: { type: 'string' },
            workMode: { type: 'string' },
            jobLinkRef: { type: 'string' },
            sourceJobId: { type: 'string' },
            requiredTechnologies: { type: 'array', items: { type: 'string' } },
            descriptionText: { type: 'string' },
            seniorityLevel: { type: 'string' },
            minimumYearsOverall: { type: 'number' },
            experienceRequirements: { type: 'array', items: { type: 'string' } },
            hardRequirements: { type: 'array', items: { type: 'string' } },
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
            'seniorityLevel',
            'minimumYearsOverall',
            'experienceRequirements',
            'hardRequirements',
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
    throw createJobOpsError_(JOBOPS_ERROR_CODES.AI_OUTPUT, 'AI output is missing jobs[].');
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
  const sourceName = normalizeJobOpsSingleLineText_(detection.source) || 'Platform';
  const parserSource = sourceName.replace(/[^A-Za-z0-9]/gu, '') || 'Platform';

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
    fitEvidence: {
      seniorityLevel: cleanJobOpsParsedField_(job.seniorityLevel) || 'UNKNOWN',
      minimumYearsOverall: Number(job.minimumYearsOverall) || 0,
      experienceRequirements: Array.isArray(job.experienceRequirements)
        ? job.experienceRequirements.map(cleanJobOpsParsedField_).filter(Boolean).slice(0, 12)
        : [],
      hardRequirements: Array.isArray(job.hardRequirements)
        ? job.hardRequirements.map(cleanJobOpsParsedField_).filter(Boolean).slice(0, 12)
        : [],
    },
    recruiterName: '',
    recruiterEmail: '',
    parserName: `parse${parserSource}Job+Gemini`,
    parserVersion: JOBOPS_PARSER_VERSION,
    confidence: job.sourceJobId && job.jobUrl ? 0.95 : 0.8,
    warnings: [`Extracted from a multi-job ${sourceName} alert with Gemini structured output.`],
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
