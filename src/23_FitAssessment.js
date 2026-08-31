/* global JOBOPS_APPLICATION_STATUSES */

/**
 * Version marker for deterministic fit logic. Bump when rules change so stored
 * rows can be re-evaluated without deleting or re-ingesting Jobs.
 */
const JOBOPS_FIT_VERSION = '1.0.0';
const JOBOPS_FIT_LEVELS = Object.freeze(['STRONG', 'GOOD', 'STRETCH', 'POOR', 'UNKNOWN']);

/**
 * Normalizes AI-extracted requirement evidence. The model extracts facts only;
 * this function owns all scoring.
 *
 * @param {*} raw
 * @returns {{seniorityLevel: string, minimumYearsOverall: number, experienceRequirements: string[], hardRequirements: string[]}}
 */
function normalizeJobOpsFitEvidence_(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seniority = normalizeJobOpsSingleLineText_(source.seniorityLevel).toUpperCase();
  const allowedSeniority = [
    'ENTRY',
    'JUNIOR',
    'ASSOCIATE',
    'MID',
    'SENIOR',
    'LEAD',
    'STAFF',
    'PRINCIPAL',
    'MANAGER',
    'DIRECTOR',
    'UNKNOWN',
  ];
  const minimumYears = Number(source.minimumYearsOverall);
  const lists = (value) =>
    Array.isArray(value)
      ? value.map(normalizeJobOpsSingleLineText_).filter(Boolean).slice(0, 12)
      : [];

  return {
    seniorityLevel: allowedSeniority.includes(seniority) ? seniority : 'UNKNOWN',
    minimumYearsOverall:
      Number.isFinite(minimumYears) && minimumYears >= 0 && minimumYears <= 50
        ? minimumYears
        : 0,
    experienceRequirements: lists(source.experienceRequirements),
    hardRequirements: lists(source.hardRequirements),
  };
}

/**
 * Extracts the largest explicit years requirement from free-form requirement
 * strings such as "Terraform: 5 years" or "4+ years cloud".
 *
 * @param {string[]} requirements
 * @returns {{years: number, requirement: string}}
 */
function getJobOpsLargestSpecificYearsRequirement_(requirements) {
  let selected = { years: 0, requirement: '' };

  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const text = normalizeJobOpsSingleLineText_(requirement);
    const matches = Array.from(
      text.matchAll(/\b(\d{1,2})(?:\s*\+)?\s*(?:years?|yrs?|a[nñ]os?)\b/giu),
    );
    for (const match of matches) {
      const years = Number(match[1]);
      if (Number.isFinite(years) && years > selected.years && years <= 50) {
        selected = { years, requirement: text };
      }
    }
  }

  return selected;
}

/**
 * Converts requirement evidence into a deterministic adjustment. Seniority
 * penalties are skipped when the transparent base scoring already captured an
 * equivalent title risk, preventing accidental double punishment.
 *
 * @param {*} rawEvidence
 * @param {string=} existingRiskFlags
 * @returns {{level: string, adjustment: number, reasons: string[]}}
 */
function calculateJobOpsFitAssessment_(rawEvidence, existingRiskFlags) {
  const evidence = normalizeJobOpsFitEvidence_(rawEvidence);
  const riskFlags = normalizeJobOpsMultilineText_(existingRiskFlags).toUpperCase();
  const reasons = [];
  let adjustment = 0;

  const years = evidence.minimumYearsOverall;
  if (years > 0 && years <= 2) {
    adjustment += 2;
    reasons.push(`Experiencia general accesible: ${years} año(s)`);
  } else if (years === 3) {
    adjustment -= 1;
    reasons.push('Experiencia general requerida: 3 años');
  } else if (years === 4) {
    adjustment -= 4;
    reasons.push('Experiencia general alta: 4 años');
  } else if (years === 5) {
    adjustment -= 7;
    reasons.push('Experiencia general alta: 5 años');
  } else if (years >= 6) {
    adjustment -= 9;
    reasons.push(`Experiencia general muy alta: ${years} años`);
  }

  const specific = getJobOpsLargestSpecificYearsRequirement_(evidence.experienceRequirements);
  if (specific.years === 4) {
    adjustment -= 3;
    reasons.push(`Experiencia específica alta: ${specific.requirement}`);
  } else if (specific.years === 5) {
    adjustment -= 5;
    reasons.push(`Experiencia específica alta: ${specific.requirement}`);
  } else if (specific.years >= 6) {
    adjustment -= 7;
    reasons.push(`Experiencia específica muy alta: ${specific.requirement}`);
  }

  const titleAlreadyPenalized = /(?:SENIOR|LEAD|STAFF|PRINCIPAL|MANAGER|DIRECTOR)_TITLE/u.test(
    riskFlags,
  );
  if (!titleAlreadyPenalized) {
    const seniorityAdjustments = {
      ENTRY: 2,
      JUNIOR: 2,
      ASSOCIATE: 2,
      MID: -1,
      SENIOR: -4,
      LEAD: -7,
      STAFF: -7,
      PRINCIPAL: -9,
      MANAGER: -7,
      DIRECTOR: -9,
      UNKNOWN: 0,
    };
    const seniorityAdjustment = seniorityAdjustments[evidence.seniorityLevel] || 0;
    adjustment += seniorityAdjustment;
    if (seniorityAdjustment !== 0) {
      reasons.push(
        `Seniority explícito: ${evidence.seniorityLevel} ${seniorityAdjustment > 0 ? '+' : ''}${seniorityAdjustment}`,
      );
    }
  }

  // Keep AI-derived evidence influential but bounded. The transparent rules
  // remain the base score and cannot be completely replaced by one model call.
  adjustment = Math.max(-15, Math.min(4, adjustment));

  let level = 'UNKNOWN';
  const hasEvidence =
    years > 0 ||
    specific.years > 0 ||
    evidence.seniorityLevel !== 'UNKNOWN' ||
    evidence.hardRequirements.length > 0;
  if (hasEvidence) {
    if (adjustment <= -10) {
      level = 'POOR';
    } else if (adjustment <= -4) {
      level = 'STRETCH';
    } else if (adjustment >= 2) {
      level = 'STRONG';
    } else {
      level = 'GOOD';
    }
  }

  return { level, adjustment, reasons };
}

/**
 * Applies fit evidence to an already transparent role/technology score.
 *
 * @param {Object<string, *>} evaluation
 * @param {*} fitEvidence
 * @param {Object} config
 * @param {{strategicLevel: string, minimumReviewScore: number}} classification
 * @param {string=} providerName
 * @param {Date=} assessedAt
 * @returns {Object<string, *>}
 */
function applyJobOpsFitToEvaluation_(
  evaluation,
  fitEvidence,
  config,
  classification,
  providerName,
  assessedAt,
) {
  const fit = calculateJobOpsFitAssessment_(fitEvidence, evaluation.RISK_FLAGS);
  const matchScore = Number(evaluation.MATCH_SCORE) || 0;
  const finalScore = matchScore + fit.adjustment;

  return {
    ...evaluation,
    FINAL_SCORE: finalScore,
    PRIORITY: getJobOpsPriorityForEvaluation_(finalScore, config, classification),
    FIT_LEVEL: fit.level,
    FIT_ADJUSTMENT: fit.adjustment,
    FIT_REASONS: fit.reasons.join('\n'),
    FIT_PROVIDER: normalizeJobOpsSingleLineText_(providerName),
    FIT_VERSION: JOBOPS_FIT_VERSION,
    FIT_ASSESSED_AT: assessedAt || new Date(),
  };
}

/**
 * Provides a neutral final-score projection for rows without AI requirement
 * evidence. This keeps new columns useful for every job.
 *
 * @param {Object<string, *>} evaluation
 * @param {Object} config
 * @param {{strategicLevel: string, minimumReviewScore: number}} classification
 * @returns {Object<string, *>}
 */
function applyJobOpsUnknownFit_(evaluation, config, classification) {
  const matchScore = Number(evaluation.MATCH_SCORE) || 0;
  return {
    ...evaluation,
    FINAL_SCORE: matchScore,
    PRIORITY: getJobOpsPriorityForEvaluation_(matchScore, config, classification),
    FIT_LEVEL: 'UNKNOWN',
    FIT_ADJUSTMENT: 0,
    FIT_REASONS: '',
    FIT_PROVIDER: '',
    FIT_VERSION: '',
    FIT_ASSESSED_AT: '',
  };
}
