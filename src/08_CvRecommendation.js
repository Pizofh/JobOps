/* global applyJobOpsFitToEvaluation_, applyJobOpsStoredFit_, applyJobOpsUnknownFit_ */
/**
 * Converts editable CVProfiles rows to enabled profile definitions.
 *
 * @param {*[][]} values
 * @returns {Object[]}
 */
function parseJobOpsCvProfiles_(values) {
  const indexes = getJobOpsRequiredHeaderIndexes_(values, [
    'CV_PROFILE',
    'DRIVE_URL',
    'TARGET_ROLE_FAMILIES',
    'ENABLED',
  ]);

  return values
    .slice(1)
    .map((row) => ({
      profile: normalizeJobOpsSingleLineText_(row[indexes.CV_PROFILE]),
      driveUrl: normalizeJobOpsSingleLineText_(row[indexes.DRIVE_URL]),
      targetRoleFamilies: splitJobOpsList_(row[indexes.TARGET_ROLE_FAMILIES]),
      enabled: parseJobOpsLooseBoolean_(row[indexes.ENABLED]),
    }))
    .filter((profile) => profile.profile && profile.enabled);
}

/**
 * Chooses an enabled CV profile for a classified role without changing Drive.
 *
 * @param {string} roleFamily
 * @param {Object[]} profiles
 * @param {string=} preferredProfile
 * @returns {{profile: string, driveUrl: string, reason: string}}
 */
function recommendJobOpsCv_(roleFamily, profiles, preferredProfile) {
  const preferred = normalizeJobOpsSingleLineText_(preferredProfile);
  const matching = profiles.find((profile) => profile.profile === preferred);
  const configured =
    matching || profiles.find((profile) => profile.targetRoleFamilies.includes(roleFamily));
  const fallback = profiles.find((profile) => profile.profile === 'CV_TO_CREATE');
  const selected = configured && configured.driveUrl ? configured : fallback;

  if (!selected) {
    return {
      profile: 'CV_TO_CREATE',
      driveUrl: '',
      reason: 'No enabled CV profile matches this role family.',
    };
  }

  return {
    profile: selected.profile,
    driveUrl: selected.driveUrl,
    reason:
      configured && configured.driveUrl
        ? `Configured for ${roleFamily}.`
        : 'The matching CV profile has no Drive link configured.',
  };
}

/**
 * Produces all system-managed Phase 4 fields for a parsed or stored job.
 *
 * @param {Object} job
 * @param {{roleFamilies: Object[], scoringRules: Object[], cvProfiles: Object[], config: Object}} context
 * @returns {Object<string, *>}
 */
function evaluateJobOpsJob_(job, context) {
  const classification = classifyJobOpsRole_(job, context.roleFamilies);
  const score = calculateJobOpsScore_(job, context.scoringRules, context.config);
  const strategicBonus = getJobOpsStrategicLevelScoreBonus_(classification.strategicLevel);
  const totalScore = score.score + strategicBonus;
  const strongMatches = score.strongMatches.slice();
  if (strategicBonus > 0) {
    strongMatches.unshift(`Strategic ${classification.strategicLevel} +${strategicBonus}`);
  }
  const recommendation = recommendJobOpsCv_(
    classification.roleFamily,
    context.cvProfiles,
    classification.recommendedCvProfile,
  );

  const evaluation = {
    ROLE_FAMILY: classification.roleFamily,
    MATCH_SCORE: totalScore,
    PRIORITY: getJobOpsPriorityForEvaluation_(totalScore, context.config, classification, job),
    RECOMMENDED_CV: recommendation.profile,
    CV_LINK: recommendation.driveUrl,
    STRONG_MATCHES: strongMatches.join('\n'),
    RISK_FLAGS: score.riskFlags.join('\n'),
  };

  if (job.fitEvidence) {
    return applyJobOpsFitToEvaluation_(
      evaluation,
      job.fitEvidence,
      context.config,
      classification,
      job.aiProvider,
      new Date(),
    );
  }

  if (job.storedFit) {
    return applyJobOpsStoredFit_(evaluation, job.storedFit, context.config, classification);
  }

  return applyJobOpsUnknownFit_(evaluation, context.config, classification);
}
