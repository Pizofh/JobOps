/**
 * Returns a deterministic short hash suitable for local identifiers.
 *
 * @param {*} value
 * @returns {string}
 */
function hashJobOpsText_(value) {
  const text = String(value === null || value === undefined ? '' : value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

/**
 * Builds a stable JOB_ID without exposing the Gmail message identifier.
 *
 * @param {*} messageId
 * @returns {string}
 */
function buildJobOpsJobId_(messageId) {
  const normalized = normalizeJobOpsSingleLineText_(messageId);
  if (!normalized) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.MISSING_REQUIRED_FIELD,
      'Cannot build JOB_ID without a Gmail message ID.',
    );
  }
  return `JOB-${hashJobOpsText_(normalized)}`;
}

/**
 * Prefers a canonical job URL and falls back to the exact Gmail message ID.
 *
 * @param {{jobUrl?: string, messageId?: string}} candidate
 * @returns {string}
 */
function buildJobOpsDeduplicationKey_(candidate) {
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
    'Cannot deduplicate a job without a URL or Gmail message ID.',
  );
}

/**
 * Creates exact-match indexes from existing Jobs rows.
 *
 * @param {string[]} headers
 * @param {*[][]} rows
 * @returns {{messageIds: Set<string>, keys: Set<string>, urls: Set<string>}}
 */
function buildJobOpsDeduplicationIndex_(headers, rows) {
  const messageIndex = headers.indexOf('GMAIL_MESSAGE_ID');
  const keyIndex = headers.indexOf('DEDUPLICATION_KEY');
  const urlIndex = headers.indexOf('JOB_URL');
  const index = { messageIds: new Set(), keys: new Set(), urls: new Set() };

  for (const row of rows) {
    const messageId = messageIndex === -1 ? '' : normalizeJobOpsSingleLineText_(row[messageIndex]);
    const key = keyIndex === -1 ? '' : normalizeJobOpsSingleLineText_(row[keyIndex]);
    const url = urlIndex === -1 ? '' : canonicalizeJobOpsUrl_(row[urlIndex]);

    if (messageId) {
      index.messageIds.add(messageId);
    }
    if (key) {
      index.keys.add(key);
    }
    if (url) {
      index.urls.add(url);
    }
  }

  return index;
}

/**
 * Checks only strong exact identifiers; fuzzy merging is deliberately excluded.
 *
 * @param {{messageId?: string, jobUrl?: string, deduplicationKey?: string}} candidate
 * @param {{messageIds: Set<string>, keys: Set<string>, urls: Set<string>}} index
 * @returns {boolean}
 */
function isDuplicateJobOpsCandidate_(candidate, index) {
  const messageId = normalizeJobOpsSingleLineText_(candidate.messageId);
  const jobUrl = canonicalizeJobOpsUrl_(candidate.jobUrl);
  const key = normalizeJobOpsSingleLineText_(candidate.deduplicationKey);

  return Boolean(
    (messageId && index.messageIds.has(messageId)) ||
    (jobUrl && index.urls.has(jobUrl)) ||
    (key && index.keys.has(key)),
  );
}

/**
 * Registers a candidate immediately so duplicates in the same batch are skipped.
 *
 * @param {{messageId?: string, jobUrl?: string, deduplicationKey?: string}} candidate
 * @param {{messageIds: Set<string>, keys: Set<string>, urls: Set<string>}} index
 */
function registerJobOpsCandidate_(candidate, index) {
  const messageId = normalizeJobOpsSingleLineText_(candidate.messageId);
  const jobUrl = canonicalizeJobOpsUrl_(candidate.jobUrl);
  const key = normalizeJobOpsSingleLineText_(candidate.deduplicationKey);

  if (messageId) {
    index.messageIds.add(messageId);
  }
  if (jobUrl) {
    index.urls.add(jobUrl);
  }
  if (key) {
    index.keys.add(key);
  }
}
