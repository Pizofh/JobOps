/* exported setupJobOps, installJobOpsTriggers, ingestJobs, sendDailyDigest, handleStatusEdit, rescoreJobs, dryRunIngestion, validateJobOpsConfiguration */

/**
 * Initializes the Phase 1 Sheets environment and Gmail labels.
 *
 * @returns {Object}
 */
function setupJobOps() {
  return runJobOpsSetup_();
}

/** Reserved for the trigger phase. */
function installJobOpsTriggers() {}

/** Reserved for the ingestion phase. */
function ingestJobs() {}

/** Reserved for the digest phase. */
function sendDailyDigest() {}

/**
 * Reserved for the status workflow phase.
 *
 * @param {Object} event Future installable onEdit event.
 */
function handleStatusEdit(event) {
  void event;
}

/** Reserved for the scoring phase. */
function rescoreJobs() {}

/** Reserved for the ingestion phase. */
function dryRunIngestion() {}

/**
 * Validates Script Properties, required sheets and editable configuration.
 *
 * @returns {Object}
 */
function validateJobOpsConfiguration() {
  return runJobOpsConfigurationValidation_();
}
