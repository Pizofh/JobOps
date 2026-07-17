/**
 * Converts editable ScoringRules rows to enabled, validated rule objects.
 *
 * @param {*[][]} values
 * @returns {Object[]}
 */
function parseJobOpsScoringRules_(values) {
  const indexes = getJobOpsRequiredHeaderIndexes_(values, [
    'RULE_ID',
    'PATTERN',
    'MATCH_TYPE',
    'CONTEXT',
    'SCORE',
    'RISK_FLAG',
    'ENABLED',
  ]);
  const groupIndex = getJobOpsOptionalHeaderIndex_(values, 'GROUP');

  return values
    .slice(1)
    .map((row) => ({
      ruleId: normalizeJobOpsSingleLineText_(row[indexes.RULE_ID]),
      pattern: normalizeJobOpsSingleLineText_(row[indexes.PATTERN]),
      matchType: normalizeJobOpsSingleLineText_(row[indexes.MATCH_TYPE]).toUpperCase(),
      context: normalizeJobOpsSingleLineText_(row[indexes.CONTEXT]).toUpperCase(),
      score: Number(row[indexes.SCORE]),
      riskFlag: normalizeJobOpsSingleLineText_(row[indexes.RISK_FLAG]),
      enabled: parseJobOpsLooseBoolean_(row[indexes.ENABLED]),
      group: groupIndex === -1 ? '' : normalizeJobOpsSingleLineText_(row[groupIndex]),
    }))
    .filter((rule) => rule.ruleId && rule.pattern && rule.enabled)
    .map((rule) => {
      if (
        !JOBOPS_MATCH_TYPES.includes(rule.matchType) ||
        !JOBOPS_SCORING_CONTEXTS.includes(rule.context)
      ) {
        throw createJobOpsError_(
          JOBOPS_ERROR_CODES.CONFIGURATION,
          `Scoring rule ${rule.ruleId} has an invalid match type or context.`,
        );
      }
      if (!Number.isFinite(rule.score)) {
        throw createJobOpsError_(
          JOBOPS_ERROR_CODES.CONFIGURATION,
          `Scoring rule ${rule.ruleId} has an invalid score.`,
        );
      }
      if (rule.matchType === 'REGEX') {
        try {
          new RegExp(rule.pattern, 'iu');
        } catch {
          throw createJobOpsError_(
            JOBOPS_ERROR_CODES.CONFIGURATION,
            `Scoring rule ${rule.ruleId} has an invalid regular expression.`,
          );
        }
      }
      return rule;
    });
}

/**
 * Calculates a transparent score from editable rules and optional recruiter
 * bonus. Returned explanations are suitable for direct storage in Sheets.
 *
 * @param {Object} job
 * @param {Object[]} rules
 * @param {Object} config
 * @returns {{score: number, priority: string, strongMatches: string[], riskFlags: string[], matches: Object[]}}
 */
function calculateJobOpsScore_(job, rules, config) {
  const contextText = buildJobOpsScoringContextText_(job);
  const matchedRules = [];
  const strongMatches = [];
  const riskFlags = [];
  let score = 0;

  for (const rule of rules) {
    if (!matchesJobOpsScoringRule_(rule, contextText[rule.context])) {
      continue;
    }

    matchedRules.push(rule);
  }

  const matches = selectJobOpsGroupedScoringRules_(matchedRules);
  for (const rule of matches) {
    score += rule.score;
    const explanation = `${rule.pattern} ${rule.score >= 0 ? '+' : ''}${rule.score}`;
    rule.explanation = explanation;
    if (rule.score >= 0) {
      strongMatches.push(explanation);
    } else {
      riskFlags.push(rule.riskFlag ? `${rule.riskFlag} ${rule.score}` : explanation);
    }
  }

  if (job.isRecruiter) {
    const bonus = Number(config.RECRUITER_SCORE_BONUS) || 0;
    score += bonus;
    strongMatches.push(`Recruiter ${bonus >= 0 ? '+' : ''}${bonus}`);
  }

  return {
    score,
    priority: getJobOpsPriorityForScore_(score, config),
    strongMatches,
    riskFlags,
    matches,
  };
}

/**
 * Limits equivalent configured rules to their strongest matching member while
 * leaving ungrouped rules independent and fully editable.
 *
 * @param {Object[]} rules
 * @returns {Object[]}
 */
function selectJobOpsGroupedScoringRules_(rules) {
  const selected = [];
  const groupedIndexes = new Map();
  for (const rule of rules) {
    if (!rule.group) {
      selected.push({ ...rule });
      continue;
    }
    const existingIndex = groupedIndexes.get(rule.group);
    if (existingIndex === undefined) {
      groupedIndexes.set(rule.group, selected.length);
      selected.push({ ...rule });
      continue;
    }
    const existing = selected[existingIndex];
    if (Math.abs(rule.score) > Math.abs(existing.score)) {
      selected[existingIndex] = { ...rule };
    }
  }
  return selected;
}

/**
 * Produces text scopes for ANY, REQUIRED, PREFERRED and NEGATIVE rules.
 *
 * @param {Object} job
 * @returns {Object<string, string>}
 */
function buildJobOpsScoringContextText_(job) {
  const title = normalizeJobOpsSingleLineText_(job.position);
  const description = normalizeJobOpsMultilineText_(job.descriptionText);
  const technologies = (job.requiredTechnologies || []).join(' ');
  const all = foldJobOpsText_(`${title}\n${description}\n${technologies}`);
  const lines = description.split('\n');
  const required = lines
    .filter((line) =>
      /\b(required|requirements?|must|requisitos?|obligatorio|experiencia)\b/iu.test(line),
    )
    .join('\n');
  const preferred = lines
    .filter((line) => /\b(preferred|nice to have|desired|deseable|plus)\b/iu.test(line))
    .join('\n');

  return {
    ANY: all,
    TITLE: foldJobOpsText_(title),
    NEGATIVE: all,
    REQUIRED: foldJobOpsText_(required),
    PREFERRED: foldJobOpsText_(preferred),
  };
}

/**
 * Evaluates one rule against the text scope selected by its context.
 *
 * @param {Object} rule
 * @param {string} foldedText
 * @returns {boolean}
 */
function matchesJobOpsScoringRule_(rule, foldedText) {
  if (!foldedText) {
    return false;
  }
  if (rule.matchType === 'REGEX') {
    return new RegExp(rule.pattern, 'iu').test(foldedText);
  }

  if (rule.matchType === 'ALL_KEYWORDS') {
    return rule.pattern
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean)
      .every((pattern) => matchesJobOpsScoringKeyword_(pattern, foldedText));
  }

  return matchesJobOpsScoringKeyword_(rule.pattern, foldedText);
}

/**
 * Matches a single configured keyword or phrase against text boundaries.
 *
 * @param {string} value
 * @param {string} foldedText
 * @returns {boolean}
 */
function matchesJobOpsScoringKeyword_(value, foldedText) {
  const pattern = foldJobOpsText_(value);
  if (!pattern) {
    return false;
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'u').test(foldedText);
}
