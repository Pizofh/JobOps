/* global JOBOPS_ERROR_CODES, JOBOPS_GEMINI_MULTI_JOB_SOURCES, JOBOPS_STRATEGY_ROLE_FAMILY_ROWS */
/* global UrlFetchApp, assertValidJobOpsParserInput_, buildJobOpsAiEmailEvidence_ */
/* global buildJobOpsGeminiRequest_, createJobOpsError_, detectJobOpsSource_ */
/* global extractJobOpsGeminiResponseText_, foldJobOpsText_, isJobOpsGeminiConfigured_ */
/* global normalizeJobOpsAiJob_, normalizeJobOpsSingleLineText_, parseJobOpsDetectedSource_ */
/* global parseJobOpsRoleFamilies_, readJobOpsGeminiSettings_, validateJobOpsAiJobs_ */

/**
 * Parses one candidate email and lets the same Gemini extraction request also
 * classify each platform vacancy into a target role family. Non-Gemini sources
 * keep the deterministic parser path.
 *
 * The optional roleFamilies argument is used by callers that already loaded the
 * editable sheet configuration. Existing callers fall back to the current
 * strategy definitions so this remains backwards compatible.
 *
 * @param {Object} input
 * @param {Object[]} sourceDefinitions
 * @param {Object[]=} roleFamilies
 * @returns {Object[]}
 */
function parseJobOpsMessageBatch_(input, sourceDefinitions, roleFamilies) {
  assertValidJobOpsParserInput_(input);
  const detection = detectJobOpsSource_(input, sourceDefinitions);

  if (!detection.candidate) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.SOURCE_NOT_DETECTED,
      'Message did not match a configured source or conservative recruiter signals.',
    );
  }

  const source = foldJobOpsText_(detection.source);
  const semanticFamilies = resolveJobOpsSemanticRoleFamilies_(roleFamilies);
  if (
    JOBOPS_GEMINI_MULTI_JOB_SOURCES.includes(source) &&
    isJobOpsGeminiConfigured_() &&
    semanticFamilies.length > 0
  ) {
    return extractJobOpsPlatformJobsWithSemanticGemini_(input, detection, semanticFamilies).map(
      (parsed) => ({ ...parsed, detection }),
    );
  }

  const parsed = parseJobOpsDetectedSource_(input, detection);
  return [{ ...parsed, detection }];
}

/**
 * Resolves semantic-classification families. The standard strategy definitions
 * are a compatibility fallback for the existing two-argument ingestion call.
 *
 * @param {Object[]=} roleFamilies
 * @returns {Object[]}
 */
function resolveJobOpsSemanticRoleFamilies_(roleFamilies) {
  if (Array.isArray(roleFamilies) && roleFamilies.length > 0) {
    return roleFamilies;
  }

  const headers = [
    'ROLE_FAMILY',
    'PATTERNS',
    'PRIORITY_ORDER',
    'RECOMMENDED_CV_PROFILE',
    'MINIMUM_REVIEW_SCORE',
    'ENABLED',
    'NOTES',
    'STRATEGIC_LEVEL',
  ];
  return parseJobOpsRoleFamilies_([headers, ...JOBOPS_STRATEGY_ROLE_FAMILY_ROWS]);
}

/**
 * Executes one structured Gemini request that performs both safe extraction and
 * semantic role-family classification. The model never controls scoring.
 *
 * @param {Object} input
 * @param {Object} detection
 * @param {Object[]} roleFamilies
 * @returns {Object[]}
 */
function extractJobOpsPlatformJobsWithSemanticGemini_(input, detection, roleFamilies) {
  const settings = readJobOpsGeminiSettings_();
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

  const request = buildJobOpsSemanticGeminiRequest_(evidence);
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

  return validated.map((job) => {
    const normalized = normalizeJobOpsAiJob_(job, detection);
    const semanticRoleFamily = validateJobOpsSemanticRoleFamily_(job.roleFamily, roleFamilies);
    return applyJobOpsSemanticRoleEvidence_(normalized, semanticRoleFamily);
  });
}

/**
 * Sends only role-family definitions, not CV links or personal data. Patterns
 * are semantic examples rather than literal matching requirements.
 *
 * @param {Object[]} roleFamilies
 * @returns {{roleFamily: string, strategicLevel: string, examples: string[]}[]}
 */
function buildJobOpsAiRoleFamilyEvidence_(roleFamilies) {
  return (Array.isArray(roleFamilies) ? roleFamilies : [])
    .map((definition) => ({
      roleFamily: normalizeJobOpsSingleLineText_(definition.roleFamily),
      strategicLevel: normalizeJobOpsSingleLineText_(definition.strategicLevel).toUpperCase(),
      examples: Array.isArray(definition.patterns)
        ? definition.patterns.map(normalizeJobOpsSingleLineText_).filter(Boolean).slice(0, 12)
        : [],
    }))
    .filter((definition) => definition.roleFamily);
}

/**
 * Extends the existing extraction request with one semantic roleFamily field.
 * Scoring values are deliberately absent from the prompt.
 *
 * @param {Object} evidence
 * @returns {Object}
 */
function buildJobOpsSemanticGeminiRequest_(evidence) {
  const request = buildJobOpsGeminiRequest_(evidence);
  const jobSchema = request.generationConfig.responseFormat.text.schema.properties.jobs.items;
  jobSchema.properties.roleFamily = { type: 'string' };
  if (!jobSchema.required.includes('roleFamily')) {
    jobSchema.required.push('roleFamily');
  }

  const roleFamilyText = evidence.roleFamilies
    .map(
      (definition) =>
        `${definition.roleFamily} | ${definition.strategicLevel} | examples: ${definition.examples.join(', ')}`,
    )
    .join('\n');

  request.contents[0].parts[0].text += [
    '',
    'SEMANTIC_ROLE_CLASSIFICATION:',
    'For every extracted vacancy, set roleFamily to exactly one enabled family listed below.',
    'Classify by the meaning and responsibilities of the vacancy, not only by exact title keywords.',
    'The examples describe each family but are not exhaustive literal patterns.',
    'Use UNRELATED when the vacancy is outside the listed technical target families.',
    'Do not infer technologies, experience, salary, work mode, or responsibilities that are absent from the email.',
    roleFamilyText,
  ].join('\n');

  return request;
}

/**
 * Accepts only an exact enabled role-family identifier from local configuration.
 * Invalid model output is discarded so deterministic classification can take over.
 *
 * @param {*} value
 * @param {Object[]} roleFamilies
 * @returns {string}
 */
function validateJobOpsSemanticRoleFamily_(value, roleFamilies) {
  const requested = normalizeJobOpsSingleLineText_(value);
  if (!requested) {
    return '';
  }

  const definition = (Array.isArray(roleFamilies) ? roleFamilies : []).find(
    (candidate) => normalizeJobOpsSingleLineText_(candidate.roleFamily) === requested,
  );
  return definition ? normalizeJobOpsSingleLineText_(definition.roleFamily) : '';
}

/**
 * Adds only the locally validated semantic family to the parser result. It does
 * not inject synthetic role keywords into descriptionText, so ScoringRules keep
 * evaluating only evidence that was actually present in the alert.
 *
 * @param {Object} job
 * @param {string} semanticRoleFamily
 * @returns {Object}
 */
function applyJobOpsSemanticRoleEvidence_(job, semanticRoleFamily) {
  if (!semanticRoleFamily) {
    return {
      ...job,
      semanticRoleFamily: '',
      warnings: job.warnings.concat(
        'Gemini role-family classification was invalid; deterministic fallback will be used.',
      ),
    };
  }

  return {
    ...job,
    semanticRoleFamily,
    parserName: job.parserName.replace(/\+Gemini$/u, '+GeminiSemantic'),
    warnings: job.warnings.concat('Role family classified semantically with Gemini.'),
  };
}
