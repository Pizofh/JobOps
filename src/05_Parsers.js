/**
 * Converts editable Sources rows to parser definitions.
 *
 * @param {*[][]} values
 * @returns {Object[]}
 */
function parseJobOpsSourceDefinitions_(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, 'Sources sheet is empty.');
  }

  const headers = values[0].map(normalizeJobOpsSingleLineText_);
  const required = ['SOURCE', 'SENDER_DOMAINS', 'SUBJECT_PATTERNS', 'PARSER_NAME', 'ENABLED'];
  const indexes = {};
  for (const header of required) {
    indexes[header] = headers.indexOf(header);
    if (indexes[header] === -1) {
      throw createJobOpsError_(
        JOBOPS_ERROR_CODES.CONFIGURATION,
        `Sources sheet is missing ${header}.`,
      );
    }
  }

  return values
    .slice(1)
    .map((row) => ({
      source: normalizeJobOpsSingleLineText_(row[indexes.SOURCE]),
      senderDomains: splitJobOpsList_(row[indexes.SENDER_DOMAINS]),
      subjectPatterns: splitJobOpsList_(row[indexes.SUBJECT_PATTERNS]),
      parserName: normalizeJobOpsSingleLineText_(row[indexes.PARSER_NAME]),
      enabled: parseJobOpsLooseBoolean_(row[indexes.ENABLED]),
    }))
    .filter((definition) => definition.source && definition.enabled);
}

/**
 * Splits comma-separated editable values.
 *
 * @param {*} value
 * @returns {string[]}
 */
function splitJobOpsList_(value) {
  return normalizeJobOpsSingleLineText_(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parses a permissive sheet boolean for optional source rows.
 *
 * @param {*} value
 * @returns {boolean}
 */
function parseJobOpsLooseBoolean_(value) {
  return value === true || foldJobOpsText_(value) === 'true';
}

/**
 * Resolves original metadata when a professional address forwarded the email.
 *
 * @param {Object} input
 * @returns {{body: string, from: string, subject: string, forwarded: boolean}}
 */
function getEffectiveJobOpsMessage_(input) {
  const plainBody = normalizeJobOpsMultilineText_(input.plainBody);
  const htmlBody = jobOpsHtmlToText_(input.htmlBody);
  const body = plainBody || htmlBody;
  const forwarded = extractJobOpsForwardedMetadata_(body);

  return {
    body,
    from: forwarded.forwarded && forwarded.from ? forwarded.from : input.from,
    subject:
      forwarded.forwarded && forwarded.subject
        ? forwarded.subject
        : normalizeJobOpsSingleLineText_(input.subject),
    forwarded: forwarded.forwarded,
  };
}

/**
 * Detects a configured platform or a conservative recruiter opportunity.
 *
 * @param {Object} input
 * @param {Object[]} sourceDefinitions
 * @returns {Object}
 */
function detectJobOpsSource_(input, sourceDefinitions) {
  const effective = getEffectiveJobOpsMessage_(input);
  const sender = parseJobOpsSender_(effective.from);
  const foldedSender = foldJobOpsText_(sender.email || effective.from);
  const senderDomain = foldedSender.includes('@') ? foldedSender.split('@').pop() : foldedSender;
  const foldedSubject = foldJobOpsText_(effective.subject);
  const foldedContent = foldJobOpsText_(`${effective.subject}\n${effective.body}`);

  for (const definition of sourceDefinitions) {
    if (['recruiter', 'generic'].includes(foldJobOpsText_(definition.source))) {
      continue;
    }

    const senderMatch = definition.senderDomains.some((domain) => {
      const foldedDomain = foldJobOpsText_(domain).replace(/^@/u, '');
      return senderDomain === foldedDomain || senderDomain.endsWith(`.${foldedDomain}`);
    });
    const subjectMatch = definition.subjectPatterns.some((pattern) =>
      foldedSubject.includes(foldJobOpsText_(pattern)),
    );

    if (senderMatch || (definition.senderDomains.length === 0 && subjectMatch)) {
      return {
        candidate: true,
        source: definition.source,
        parserName: definition.parserName || 'parseGenericJob',
        isRecruiter: false,
        effective,
      };
    }
  }

  const recruiterDefinition = sourceDefinitions.find(
    (definition) => foldJobOpsText_(definition.source) === 'recruiter',
  );
  const positiveSignals = recruiterDefinition
    ? recruiterDefinition.subjectPatterns.concat(['opening', 'hiring', 'job opportunity'])
    : ['vacancy', 'position', 'opportunity', 'role', 'vacante', 'oportunidad', 'cargo'];
  const hasPositiveSignal = positiveSignals.some((signal) =>
    containsJobOpsSignal_(foldedContent, signal),
  );
  const hasTechnicalSignal = JOBOPS_TECHNICAL_ROLE_SIGNALS.some((signal) =>
    containsJobOpsSignal_(foldedContent, signal),
  );
  const hasNegativeSignal = JOBOPS_RECRUITER_NEGATIVE_SIGNALS.some((signal) =>
    containsJobOpsSignal_(foldedContent, signal),
  );

  if (recruiterDefinition && hasPositiveSignal && hasTechnicalSignal && !hasNegativeSignal) {
    return {
      candidate: true,
      source: recruiterDefinition.source,
      parserName: 'parseRecruiterJob',
      isRecruiter: true,
      effective,
    };
  }

  return {
    candidate: false,
    source: 'Generic',
    parserName: 'parseGenericJob',
    isRecruiter: false,
    effective,
  };
}

/**
 * Matches editable signals on text boundaries to avoid substrings such as IAM in Miami.
 *
 * @param {string} foldedText
 * @param {*} signal
 * @returns {boolean}
 */
function containsJobOpsSignal_(foldedText, signal) {
  const foldedSignal = foldJobOpsText_(signal);
  if (!foldedSignal) {
    return false;
  }
  const escaped = foldedSignal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'u').test(foldedText);
}

/**
 * Parses one candidate through the currently supported Phase 2 parsers.
 *
 * @param {Object} input
 * @param {Object[]} sourceDefinitions
 * @returns {Object}
 */
function parseJobOpsMessage_(input, sourceDefinitions) {
  assertValidJobOpsParserInput_(input);
  const detection = detectJobOpsSource_(input, sourceDefinitions);

  if (!detection.candidate) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.SOURCE_NOT_DETECTED,
      'Message did not match a configured source or conservative recruiter signals.',
    );
  }

  const parsed = detection.isRecruiter
    ? parseRecruiterJob_(input, detection)
    : parseGenericJob_(input, detection);
  return { ...parsed, detection };
}

/**
 * Checks the shared parser contract.
 *
 * @param {Object} input
 */
function assertValidJobOpsParserInput_(input) {
  const missing = ['messageId', 'threadId', 'subject', 'from'].filter(
    (field) => !normalizeJobOpsSingleLineText_(input && input[field]),
  );
  if (missing.length > 0) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.MISSING_REQUIRED_FIELD,
      `Parser input is missing: ${missing.join(', ')}.`,
    );
  }
}

/**
 * Generic parser used by all platform sources until specific parsers arrive.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {Object}
 */
function parseGenericJob_(input, detection) {
  const effective = detection.effective || getEffectiveJobOpsMessage_(input);
  const subjectFields = inferJobOpsSubjectFields_(effective.subject);
  const body = effective.body;
  const urls = extractJobOpsUrls_(`${body}\n${input.htmlBody || ''}`);
  const jobUrl = chooseJobOpsJobUrl_(urls);
  const position =
    extractJobOpsLabeledValue_(body, ['Position', 'Role', 'Cargo', 'Puesto', 'Vacante']) ||
    subjectFields.position;
  const company =
    extractJobOpsLabeledValue_(body, [
      'Company',
      'Empresa',
      'Organization',
      'Compania',
      'Compañia',
    ]) || subjectFields.company;
  const location = extractJobOpsLabeledValue_(body, [
    'Location',
    'Ubicacion',
    'Ubicación',
    'Ciudad',
  ]);

  if (!position || (!company && !jobUrl)) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.MISSING_REQUIRED_FIELD,
      'A parsed job requires a position and either a company or job URL.',
    );
  }

  const configuredParser = normalizeJobOpsSingleLineText_(detection.parserName);
  const warnings = [];
  if (!['parseGenericJob', 'parseRecruiterJob'].includes(configuredParser)) {
    warnings.push(`Configured parser ${configuredParser} is deferred; generic fallback used.`);
  }
  if (!location) {
    warnings.push('Location was not detected.');
  }

  return {
    source: detection.source,
    sourceJobId: extractJobOpsSourceJobId_(jobUrl),
    company: cleanJobOpsParsedField_(company),
    position: cleanJobOpsParsedField_(position),
    location: cleanJobOpsParsedField_(location),
    workMode: detectJobOpsWorkMode_(`${effective.subject}\n${body}`),
    jobUrl,
    salary: extractJobOpsSalary_(body),
    experienceRequested: extractJobOpsExperience_(body),
    requiredTechnologies: extractJobOpsTechnologies_(`${effective.subject}\n${body}`),
    descriptionText: body.slice(0, 20000),
    recruiterName: '',
    recruiterEmail: '',
    parserName: 'parseGenericJob',
    parserVersion: JOBOPS_PARSER_VERSION,
    confidence: calculateJobOpsParserConfidence_(position, company, jobUrl, location),
    warnings,
  };
}

/**
 * Recruiter parser adds original sender data and permits an unknown company.
 *
 * @param {Object} input
 * @param {Object} detection
 * @returns {Object}
 */
function parseRecruiterJob_(input, detection) {
  const effective = detection.effective || getEffectiveJobOpsMessage_(input);
  const sender = parseJobOpsSender_(effective.from);
  let parsed;

  try {
    parsed = parseGenericJob_(input, detection);
  } catch (error) {
    const subjectFields = inferJobOpsSubjectFields_(effective.subject);
    const position =
      extractJobOpsLabeledValue_(effective.body, [
        'Position',
        'Role',
        'Cargo',
        'Puesto',
        'Vacante',
      ]) || subjectFields.position;
    if (!position || error.code !== JOBOPS_ERROR_CODES.MISSING_REQUIRED_FIELD) {
      throw error;
    }

    const urls = extractJobOpsUrls_(`${effective.body}\n${input.htmlBody || ''}`);
    const jobUrl = chooseJobOpsJobUrl_(urls);
    parsed = {
      source: detection.source,
      sourceJobId: extractJobOpsSourceJobId_(jobUrl),
      company: subjectFields.company || 'UNKNOWN',
      position: cleanJobOpsParsedField_(position),
      location: cleanJobOpsParsedField_(
        extractJobOpsLabeledValue_(effective.body, [
          'Location',
          'Ubicacion',
          'Ubicación',
          'Ciudad',
        ]),
      ),
      workMode: detectJobOpsWorkMode_(`${effective.subject}\n${effective.body}`),
      jobUrl,
      salary: extractJobOpsSalary_(effective.body),
      experienceRequested: extractJobOpsExperience_(effective.body),
      requiredTechnologies: extractJobOpsTechnologies_(`${effective.subject}\n${effective.body}`),
      descriptionText: effective.body.slice(0, 20000),
      recruiterName: '',
      recruiterEmail: '',
      parserName: 'parseRecruiterJob',
      parserVersion: JOBOPS_PARSER_VERSION,
      confidence: 0.55,
      warnings: ['Company was not detected.'],
    };
  }

  parsed.source = detection.source;
  parsed.recruiterName = sender.name;
  parsed.recruiterEmail = sender.email;
  parsed.parserName = 'parseRecruiterJob';
  if (effective.forwarded) {
    parsed.warnings.push('Parsed from forwarded original headers.');
  }
  return parsed;
}

/**
 * Infers position and company from common alert subject formats.
 *
 * @param {*} value
 * @returns {{position: string, company: string}}
 */
function inferJobOpsSubjectFields_(value) {
  let subject = normalizeJobOpsSingleLineText_(value)
    .replace(/^(?:(?:re|fw|fwd|rv)\s*:\s*)+/iu, '')
    .replace(/^(?:job alert|new job|new opportunity|vacante|oportunidad)\s*[:\-]\s*/iu, '');
  subject = subject.replace(/\s+(?:-|\|)\s+(?:linkedin|indeed)$/iu, '');

  let match = subject.match(/^(.+?)\s+(?:at|en|@)\s+(.+)$/iu);
  if (match) {
    return {
      position: cleanJobOpsParsedField_(match[1]),
      company: cleanJobOpsParsedField_(match[2]),
    };
  }

  match = subject.match(/^(.+?)\s+is hiring\s+(.+)$/iu);
  if (match) {
    return {
      company: cleanJobOpsParsedField_(match[1]),
      position: cleanJobOpsParsedField_(match[2]),
    };
  }

  const parts = subject
    .split(/\s+[|–—]\s+/u)
    .map(cleanJobOpsParsedField_)
    .filter(Boolean);
  if (parts.length >= 2) {
    return { position: parts[0], company: parts[1] };
  }

  return { position: cleanJobOpsParsedField_(subject), company: '' };
}

/**
 * Removes common label punctuation from a parsed short field.
 *
 * @param {*} value
 * @returns {string}
 */
function cleanJobOpsParsedField_(value) {
  return normalizeJobOpsSingleLineText_(value)
    .replace(/^[\s:|\-–—]+/u, '')
    .replace(/[\s|\-–—]+$/u, '')
    .slice(0, 500);
}

/**
 * Prefers links that look like job detail pages.
 *
 * @param {string[]} urls
 * @returns {string}
 */
function chooseJobOpsJobUrl_(urls) {
  return (
    urls.find((url) => /\b(job|jobs|vacan|career|position|opportunit)/iu.test(url)) || urls[0] || ''
  );
}

/**
 * Extracts an exact source identifier only when the URL exposes one.
 *
 * @param {*} value
 * @returns {string}
 */
function extractJobOpsSourceJobId_(value) {
  const url = canonicalizeJobOpsUrl_(value);
  if (!url) {
    return '';
  }

  const queryMatch = url.match(/[?&](?:currentJobId|jobId|jk)=([^&]+)/iu);
  if (queryMatch) {
    return decodeJobOpsUrlComponent_(queryMatch[1]).slice(0, 200);
  }
  const pathMatch = url.match(/\/(?:jobs?|positions?|vacantes?)\/(?:view\/)?([A-Za-z0-9_-]{4,})/iu);
  return pathMatch ? pathMatch[1] : '';
}

/**
 * Safely decodes a single URL component.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeJobOpsUrlComponent_(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Computes a simple parser confidence for diagnostics only.
 *
 * @param {*} position
 * @param {*} company
 * @param {*} jobUrl
 * @param {*} location
 * @returns {number}
 */
function calculateJobOpsParserConfidence_(position, company, jobUrl, location) {
  let confidence = 0.35;
  confidence += position ? 0.25 : 0;
  confidence += company ? 0.15 : 0;
  confidence += jobUrl ? 0.15 : 0;
  confidence += location ? 0.1 : 0;
  return Math.min(confidence, 1);
}
