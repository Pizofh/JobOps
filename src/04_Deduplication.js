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
 * Prefers a source-specific job ID, then a canonical URL, and finally the
 * exact Gmail message ID. This keeps two different openings at the same
 * company separate while allowing one opening received from two sources to
 * merge through its shared URL.
 *
 * @param {{source?: string, sourceJobId?: string, jobUrl?: string, messageId?: string}} candidate
 * @returns {string}
 */
function buildJobOpsDeduplicationKey_(candidate) {
  const sourceJobKey = buildJobOpsSourceJobKey_(candidate.source, candidate.sourceJobId);
  if (sourceJobKey) {
    return sourceJobKey;
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
 * Builds an exact source-and-job identifier without depending on URL shape.
 *
 * @param {*} source
 * @param {*} sourceJobId
 * @returns {string}
 */
function buildJobOpsSourceJobKey_(source, sourceJobId) {
  const normalizedSource = foldJobOpsText_(source);
  const normalizedJobId = normalizeJobOpsSingleLineText_(sourceJobId);

  return normalizedSource && normalizedJobId ? `SOURCE:${normalizedSource}|${normalizedJobId}` : '';
}

/**
 * Creates exact-match indexes from existing Jobs rows.
 *
 * @param {string[]} headers
 * @param {*[][]} rows
 * @returns {Object}
 */
function buildJobOpsDeduplicationIndex_(headers, rows) {
  const messageIndex = headers.indexOf('GMAIL_MESSAGE_ID');
  const keyIndex = headers.indexOf('DEDUPLICATION_KEY');
  const urlIndex = headers.indexOf('JOB_URL');
  const sourceIndex = headers.indexOf('SOURCE');
  const sourceJobIdIndex = headers.indexOf('SOURCE_JOB_ID');
  const index = createJobOpsDeduplicationIndex_();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const target = {
      kind: 'existing',
      rowNumber: rowIndex + 2,
      record: createJobOpsRecordFromRow_(headers, row),
      dirty: false,
    };
    registerJobOpsCandidate_(
      {
        messageId: messageIndex === -1 ? '' : row[messageIndex],
        deduplicationKey: keyIndex === -1 ? '' : row[keyIndex],
        jobUrl: urlIndex === -1 ? '' : row[urlIndex],
        source: sourceIndex === -1 ? '' : row[sourceIndex],
        sourceJobId: sourceJobIdIndex === -1 ? '' : row[sourceJobIdIndex],
      },
      index,
      target,
    );
  }

  return index;
}

/**
 * Creates the exact-match sets and target lookups used during one ingestion.
 *
 * @returns {Object}
 */
function createJobOpsDeduplicationIndex_() {
  return {
    messageIds: new Set(),
    keys: new Set(),
    urls: new Set(),
    sourceJobKeys: new Set(),
    byMessageId: new Map(),
    byKey: new Map(),
    byUrl: new Map(),
    bySourceJobKey: new Map(),
  };
}

/**
 * Maps one Jobs row to its named fields so a duplicate can be updated without
 * relying on a fixed column position.
 *
 * @param {string[]} headers
 * @param {*[]} row
 * @returns {Object<string, *>}
 */
function createJobOpsRecordFromRow_(headers, row) {
  const record = {};
  for (let index = 0; index < headers.length; index += 1) {
    record[headers[index]] = row[index] === undefined ? '' : row[index];
  }
  return record;
}

/**
 * Checks only strong exact identifiers; fuzzy merging is deliberately excluded.
 *
 * @param {{messageId?: string, jobUrl?: string, deduplicationKey?: string, source?: string, sourceJobId?: string}} candidate
 * @param {Object} index
 * @returns {boolean}
 */
function isDuplicateJobOpsCandidate_(candidate, index) {
  return Boolean(findJobOpsDuplicateMatch_(candidate, index));
}

/**
 * Finds the target row or in-memory record for a strong exact duplicate.
 *
 * @param {{messageId?: string, jobUrl?: string, deduplicationKey?: string, source?: string, sourceJobId?: string}} candidate
 * @param {Object} index
 * @returns {{type: string, target: Object|undefined}|null}
 */
function findJobOpsDuplicateMatch_(candidate, index) {
  const values = getJobOpsDeduplicationValues_(candidate);
  const checks = [
    ['messageId', values.messageId, index.messageIds, index.byMessageId],
    ['jobUrl', values.jobUrl, index.urls, index.byUrl],
    ['sourceJobKey', values.sourceJobKey, index.sourceJobKeys, index.bySourceJobKey],
    ['deduplicationKey', values.deduplicationKey, index.keys, index.byKey],
  ];

  for (const [type, value, valuesSet, targets] of checks) {
    if (value && valuesSet && valuesSet.has(value)) {
      return { type, target: targets && targets.get(value) };
    }
  }

  return null;
}

/**
 * Registers a candidate immediately so duplicates in the same batch can merge.
 *
 * @param {{messageId?: string, jobUrl?: string, deduplicationKey?: string, source?: string, sourceJobId?: string}} candidate
 * @param {Object} index
 * @param {Object=} target
 */
function registerJobOpsCandidate_(candidate, index, target) {
  const values = getJobOpsDeduplicationValues_(candidate);

  registerJobOpsDeduplicationValue_(values.messageId, index.messageIds, index.byMessageId, target);
  registerJobOpsDeduplicationValue_(values.jobUrl, index.urls, index.byUrl, target);
  registerJobOpsDeduplicationValue_(
    values.sourceJobKey,
    index.sourceJobKeys,
    index.bySourceJobKey,
    target,
  );
  registerJobOpsDeduplicationValue_(values.deduplicationKey, index.keys, index.byKey, target);
}

/**
 * Normalizes all exact identifiers for reuse by index and lookup operations.
 *
 * @param {Object} candidate
 * @returns {{messageId: string, jobUrl: string, sourceJobKey: string, deduplicationKey: string}}
 */
function getJobOpsDeduplicationValues_(candidate) {
  return {
    messageId: normalizeJobOpsSingleLineText_(candidate.messageId),
    jobUrl: canonicalizeJobOpsUrl_(candidate.jobUrl),
    sourceJobKey: buildJobOpsSourceJobKey_(candidate.source, candidate.sourceJobId),
    deduplicationKey: normalizeJobOpsSingleLineText_(candidate.deduplicationKey),
  };
}

/**
 * Adds a normalized identifier and optionally maps it to its stored target.
 *
 * @param {string} value
 * @param {Set<string>} valuesSet
 * @param {Map<string, Object>} targets
 * @param {Object=} target
 */
function registerJobOpsDeduplicationValue_(value, valuesSet, targets, target) {
  if (!value) {
    return;
  }

  valuesSet.add(value);
  if (target) {
    targets.set(value, target);
  }
}

/**
 * Merges a second exact-source record without touching spreadsheet fields that
 * the user manages. The first source and immutable message identifiers remain
 * stable; ALL_SOURCES and useful missing system data are enriched.
 *
 * @param {Object<string, *>} existing
 * @param {Object<string, *>} incoming
 * @returns {Object<string, *>}
 */
function mergeJobOpsDuplicateRecord_(existing, incoming) {
  const merged = { ...existing };
  const enrichableFields = [
    'COMPANY',
    'POSITION',
    'LOCATION',
    'WORK_MODE',
    'JOB_URL',
    'SOURCE_JOB_ID',
    'SALARY',
    'EXPERIENCE_REQUESTED',
    'RECRUITER_NAME',
    'RECRUITER_EMAIL',
    'PARSER',
    'PARSER_VERSION',
  ];

  for (const field of enrichableFields) {
    merged[field] = preferJobOpsKnownValue_(existing[field], incoming[field]);
  }

  merged.ALL_SOURCES = mergeJobOpsSources_(
    existing.ALL_SOURCES || existing.SOURCE,
    incoming.ALL_SOURCES || incoming.SOURCE,
  );
  merged.REQUIRED_TECHNOLOGIES = mergeJobOpsCommaSeparatedValues_(
    existing.REQUIRED_TECHNOLOGIES,
    incoming.REQUIRED_TECHNOLOGIES,
  );
  merged.LAST_UPDATED_AT = selectJobOpsLatestTimestamp_(
    existing.LAST_UPDATED_AT,
    incoming.LAST_UPDATED_AT,
  );

  return merged;
}

/**
 * Uses the incoming value only when the stored value is absent or unknown.
 *
 * @param {*} existing
 * @param {*} incoming
 * @returns {*}
 */
function preferJobOpsKnownValue_(existing, incoming) {
  const current = normalizeJobOpsSingleLineText_(existing);
  const candidate = normalizeJobOpsSingleLineText_(incoming);
  if (!candidate) {
    return existing;
  }
  return !current || ['UNKNOWN', 'UNCLASSIFIED'].includes(current.toUpperCase())
    ? incoming
    : existing;
}

/**
 * Combines comma-separated sources or technologies while preserving first-seen
 * display spelling.
 *
 * @param {*} first
 * @param {*} second
 * @returns {string}
 */
function mergeJobOpsCommaSeparatedValues_(first, second) {
  const values = [];
  const keys = new Set();

  for (const value of [first, second]) {
    for (const item of normalizeJobOpsSingleLineText_(value).split(',')) {
      const display = normalizeJobOpsSingleLineText_(item);
      const key = foldJobOpsText_(display);
      if (display && !keys.has(key)) {
        keys.add(key);
        values.push(display);
      }
    }
  }

  return values.join(', ');
}

/**
 * Combines source names from the primary SOURCE and ALL_SOURCES fields.
 *
 * @param {*} first
 * @param {*} second
 * @returns {string}
 */
function mergeJobOpsSources_(first, second) {
  return mergeJobOpsCommaSeparatedValues_(first, second);
}

/**
 * Retains the later valid timestamp without changing malformed stored values.
 *
 * @param {*} first
 * @param {*} second
 * @returns {*}
 */
function selectJobOpsLatestTimestamp_(first, second) {
  const firstDate = new Date(first);
  const secondDate = new Date(second);
  const firstValid = !Number.isNaN(firstDate.getTime());
  const secondValid = !Number.isNaN(secondDate.getTime());

  if (!firstValid) {
    return second;
  }
  if (!secondValid || firstDate.getTime() >= secondDate.getTime()) {
    return first;
  }
  return second;
}
