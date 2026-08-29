/* global JOBOPS_ERROR_CODES, buildJobOpsSourceJobKey_, normalizeJobOpsDate_ */

/**
 * Builds a stable content fingerprint only for sponsored Indeed links that do
 * not expose a source job ID. Their tracking URLs change between alerts, so a
 * canonical URL is not a stable vacancy identity.
 *
 * @param {Object} candidate
 * @returns {string}
 */
function buildJobOpsSponsoredContentKey_(candidate) {
  const source = foldJobOpsText_(candidate.source);
  const sourceJobId = normalizeJobOpsSingleLineText_(candidate.sourceJobId);
  const jobUrl = canonicalizeJobOpsUrl_(candidate.jobUrl);
  if (source !== 'indeed' || sourceJobId || !/\/pagead\/clk\/dl(?:\?|$)/iu.test(jobUrl)) {
    return '';
  }

  const company = foldJobOpsText_(candidate.company);
  const position = foldJobOpsText_(candidate.position);
  const location = foldJobOpsText_(candidate.location);
  if (!company || !position) {
    return '';
  }

  return `CONTENT:indeed|${hashJobOpsText_(`${company}|${position}|${location}`)}`;
}

/**
 * Prefers a source-specific job ID, then a stable sponsored-content fingerprint,
 * then a canonical URL, and finally the Gmail message ID.
 *
 * @param {Object} candidate
 * @returns {string}
 */
function buildJobOpsDeduplicationKey_(candidate) {
  const sourceJobKey = buildJobOpsSourceJobKey_(candidate.source, candidate.sourceJobId);
  if (sourceJobKey) {
    return sourceJobKey;
  }

  const sponsoredContentKey = buildJobOpsSponsoredContentKey_(candidate);
  if (sponsoredContentKey) {
    return sponsoredContentKey;
  }

  const jobUrl = canonicalizeJobOpsUrl_(candidate.jobUrl);
  if (jobUrl) {
    return `URL:${jobUrl}`;
  }

  const messageId = normalizeJobOpsSingleLineText_(candidate.messageId);
  if (messageId) {
    return `MESSAGE:${messageId}`;
  }

  throw createJobOpsError_(
    JOBOPS_ERROR_CODES.MISSING_REQUIRED_FIELD,
    'Cannot deduplicate a job without a source job ID, URL, or Gmail message ID.',
  );
}

/**
 * Maps a parsed candidate to the immutable initial Jobs row while feeding the
 * sponsored-content fallback with company/title/location evidence.
 *
 * @param {Object} input
 * @param {Object} parsed
 * @param {Object} config
 * @returns {Object<string, *>}
 */
function buildJobOpsJobRecord_(input, parsed, config) {
  const messageId = normalizeJobOpsSingleLineText_(input.messageId);
  const discoveredAt = normalizeJobOpsDate_(input.date);
  const score = parsed.detection.isRecruiter ? config.RECRUITER_SCORE_BONUS : 0;
  const deduplicationKey = buildJobOpsDeduplicationKey_({
    source: parsed.source,
    sourceJobId: parsed.sourceJobId,
    jobUrl: parsed.jobUrl,
    messageId,
    company: parsed.company,
    position: parsed.position,
    location: parsed.location,
  });

  return {
    JOB_ID: buildJobOpsJobId_(messageId),
    DISCOVERED_AT: discoveredAt,
    LAST_UPDATED_AT: discoveredAt,
    SOURCE: parsed.source,
    ALL_SOURCES: parsed.source,
    SOURCE_JOB_ID: parsed.sourceJobId,
    COMPANY: parsed.company,
    POSITION: parsed.position,
    LOCATION: parsed.location,
    WORK_MODE: parsed.workMode,
    JOB_URL: parsed.jobUrl,
    ROLE_FAMILY: 'UNCLASSIFIED',
    MATCH_SCORE: score,
    PRIORITY: getJobOpsPriorityForScore_(score, config),
    RECOMMENDED_CV: 'CV_TO_CREATE',
    CV_LINK: '',
    SALARY: parsed.salary,
    EXPERIENCE_REQUESTED: parsed.experienceRequested,
    REQUIRED_TECHNOLOGIES: parsed.requiredTechnologies.join(', '),
    STRONG_MATCHES: parsed.detection.isRecruiter
      ? `Recruiter ${score >= 0 ? '+' : ''}${score}`
      : '',
    RISK_FLAGS: '',
    RECRUITER_NAME: parsed.recruiterName,
    RECRUITER_EMAIL: parsed.recruiterEmail,
    GMAIL_MESSAGE_ID: messageId,
    GMAIL_THREAD_ID: normalizeJobOpsSingleLineText_(input.threadId),
    DEDUPLICATION_KEY: deduplicationKey,
    PARSER: parsed.parserName,
    PARSER_VERSION: parsed.parserVersion,
    STATUS: 'NEW',
    APPLIED_DATE: '',
    FOLLOW_UP_DATE: '',
    NOTES: parsed.warnings.length > 0 ? `Parser: ${parsed.warnings.join(' ')}`.slice(0, 500) : '',
  };
}
