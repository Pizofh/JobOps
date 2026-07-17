/**
 * Converts editable RoleFamilies rows to enabled classification definitions.
 *
 * @param {*[][]} values
 * @returns {Object[]}
 */
function parseJobOpsRoleFamilies_(values) {
  const indexes = getJobOpsRequiredHeaderIndexes_(values, [
    'ROLE_FAMILY',
    'PATTERNS',
    'PRIORITY_ORDER',
    'RECOMMENDED_CV_PROFILE',
    'MINIMUM_REVIEW_SCORE',
    'ENABLED',
  ]);

  return values
    .slice(1)
    .map((row) => ({
      roleFamily: normalizeJobOpsSingleLineText_(row[indexes.ROLE_FAMILY]),
      patterns: splitJobOpsList_(row[indexes.PATTERNS]),
      priorityOrder: Number(row[indexes.PRIORITY_ORDER]),
      recommendedCvProfile: normalizeJobOpsSingleLineText_(row[indexes.RECOMMENDED_CV_PROFILE]),
      minimumReviewScore: Number(row[indexes.MINIMUM_REVIEW_SCORE]),
      enabled: parseJobOpsLooseBoolean_(row[indexes.ENABLED]),
    }))
    .filter((definition) => definition.roleFamily && definition.enabled)
    .map((definition) => ({
      ...definition,
      priorityOrder: Number.isFinite(definition.priorityOrder)
        ? definition.priorityOrder
        : Number.MAX_SAFE_INTEGER,
      minimumReviewScore: Number.isFinite(definition.minimumReviewScore)
        ? definition.minimumReviewScore
        : 0,
    }));
}

/**
 * Classifies a job using only editable role-family patterns.
 *
 * @param {Object} job
 * @param {Object[]} roleFamilies
 * @returns {{roleFamily: string, matchedPatterns: string[], confidence: number, recommendedCvProfile: string}}
 */
function classifyJobOpsRole_(job, roleFamilies) {
  const text = foldJobOpsText_(
    [job.position, job.descriptionText, ...(job.requiredTechnologies || [])]
      .filter(Boolean)
      .join('\n'),
  );
  const matches = roleFamilies
    .filter((definition) => definition.patterns.length > 0)
    .map((definition) => ({
      definition,
      matchedPatterns: definition.patterns.filter((pattern) =>
        matchesJobOpsRolePattern_(text, pattern),
      ),
    }))
    .filter((result) => result.matchedPatterns.length > 0)
    .sort((left, right) => {
      const matchDifference = right.matchedPatterns.length - left.matchedPatterns.length;
      return matchDifference || left.definition.priorityOrder - right.definition.priorityOrder;
    });

  if (matches.length > 0) {
    const selected = matches[0];
    return {
      roleFamily: selected.definition.roleFamily,
      matchedPatterns: selected.matchedPatterns,
      confidence: Math.min(1, 0.45 + selected.matchedPatterns.length * 0.2),
      recommendedCvProfile: selected.definition.recommendedCvProfile,
    };
  }

  const fallback = roleFamilies.find((definition) => definition.roleFamily === 'OTHER_TECHNICAL');
  return {
    roleFamily: fallback ? fallback.roleFamily : 'UNCLASSIFIED',
    matchedPatterns: [],
    confidence: 0,
    recommendedCvProfile: fallback ? fallback.recommendedCvProfile : 'CV_TO_CREATE',
  };
}

/**
 * Matches a configurable role pattern on text boundaries.
 *
 * @param {string} foldedText
 * @param {*} pattern
 * @returns {boolean}
 */
function matchesJobOpsRolePattern_(foldedText, pattern) {
  const foldedPattern = foldJobOpsText_(pattern);
  if (!foldedPattern) {
    return false;
  }
  const escaped = foldedPattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'u').test(foldedText);
}

/**
 * Resolves required columns in an editable configuration sheet.
 *
 * @param {*[][]} values
 * @param {string[]} requiredHeaders
 * @returns {Object<string, number>}
 */
function getJobOpsRequiredHeaderIndexes_(values, requiredHeaders) {
  if (!Array.isArray(values) || values.length === 0) {
    throw createJobOpsError_(JOBOPS_ERROR_CODES.CONFIGURATION, 'Configuration sheet is empty.');
  }

  const headers = values[0].map(normalizeJobOpsSingleLineText_);
  const indexes = {};
  for (const header of requiredHeaders) {
    indexes[header] = headers.indexOf(header);
    if (indexes[header] === -1) {
      throw createJobOpsError_(
        JOBOPS_ERROR_CODES.CONFIGURATION,
        `Configuration sheet is missing ${header}.`,
      );
    }
  }
  return indexes;
}
