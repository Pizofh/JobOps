/**
 * Searches recent, unlabeled Gmail threads and returns detected candidates.
 *
 * @param {Object} config
 * @param {Object[]} sourceDefinitions
 * @returns {{candidates: Object[], scannedMessages: number, ignoredMessages: number}}
 */
function readJobOpsGmailCandidates_(config, sourceDefinitions) {
  const query = buildJobOpsGmailSearchQuery_(config.LOOKBACK_DAYS);
  const scanLimit = Math.min(Math.max(config.MAX_MESSAGES_PER_RUN * 5, 50), 500);
  const threads = GmailApp.search(query, 0, scanLimit);
  const messageGroups = threads.length > 0 ? GmailApp.getMessagesForThreads(threads) : [];
  const rawMessages = [];

  for (let threadIndex = 0; threadIndex < messageGroups.length; threadIndex += 1) {
    const thread = threads[threadIndex];
    for (const message of messageGroups[threadIndex]) {
      rawMessages.push({ message, thread, date: message.getDate() });
    }
  }

  rawMessages.sort((left, right) => right.date.getTime() - left.date.getTime());
  const candidates = [];
  let ignoredMessages = 0;
  let scannedMessages = 0;

  for (const item of rawMessages.slice(0, scanLimit)) {
    const envelope = createJobOpsGmailEnvelope_(item.message, item.thread);
    scannedMessages += 1;
    const detection = detectJobOpsSource_(envelope.input, sourceDefinitions);
    if (detection.candidate) {
      envelope.detection = detection;
      candidates.push(envelope);
      if (candidates.length >= config.MAX_MESSAGES_PER_RUN) {
        break;
      }
    } else {
      ignoredMessages += 1;
    }
  }

  return {
    candidates,
    scannedMessages,
    ignoredMessages,
  };
}

/**
 * Builds a bounded Gmail query. Labels are thread-scoped in GmailApp.
 *
 * @param {number} lookbackDays
 * @returns {string}
 */
function buildJobOpsGmailSearchQuery_(lookbackDays) {
  const days = Math.max(1, Math.min(Number(lookbackDays) || 7, 90));
  return [
    `newer_than:${days}d`,
    '-in:chats',
    '-in:drafts',
    '-label:"Jobs/Processed"',
    '-label:"Jobs/Failed"',
    '-label:"Jobs/Processing"',
  ].join(' ');
}

/**
 * Converts a GmailMessage to the parser's provider-neutral contract.
 *
 * @param {GoogleAppsScript.Gmail.GmailMessage} message
 * @param {GoogleAppsScript.Gmail.GmailThread} thread
 * @returns {Object}
 */
function createJobOpsGmailEnvelope_(message, thread) {
  return {
    thread,
    input: {
      subject: message.getSubject(),
      from: message.getFrom(),
      date: message.getDate(),
      plainBody: message.getPlainBody(),
      htmlBody: message.getBody(),
      messageId: message.getId(),
      threadId: thread.getId(),
    },
  };
}

/**
 * Adds Processing before writes so interrupted runs can be inspected safely.
 *
 * @param {GoogleAppsScript.Gmail.GmailThread[]} threads
 */
function markJobOpsThreadsProcessing_(threads) {
  const labels = getJobOpsGmailLabelMap_();
  addJobOpsLabelToThreads_(labels['Jobs/Processing'], uniqueJobOpsThreads_(threads));
}

/**
 * Applies final thread labels and always removes Processing.
 *
 * @param {GoogleAppsScript.Gmail.GmailThread[]} processedThreads
 * @param {GoogleAppsScript.Gmail.GmailThread[]} failedThreads
 * @param {GoogleAppsScript.Gmail.GmailThread[]} recruiterThreads
 */
function finalizeJobOpsThreadLabels_(processedThreads, failedThreads, recruiterThreads) {
  const labels = getJobOpsGmailLabelMap_();
  const failed = uniqueJobOpsThreads_(failedThreads);
  const failedIds = new Set(failed.map((thread) => thread.getId()));
  const processed = uniqueJobOpsThreads_(processedThreads).filter(
    (thread) => !failedIds.has(thread.getId()),
  );
  const all = uniqueJobOpsThreads_(processed.concat(failed));

  removeJobOpsLabelFromThreads_(labels['Jobs/Processing'], all);
  removeJobOpsLabelFromThreads_(labels['Jobs/Failed'], processed);
  removeJobOpsLabelFromThreads_(labels['Jobs/Processed'], failed);
  addJobOpsLabelToThreads_(labels['Jobs/Processed'], processed);
  addJobOpsLabelToThreads_(labels['Jobs/Failed'], failed);
  addJobOpsLabelToThreads_(labels['Jobs/Recruiters'], uniqueJobOpsThreads_(recruiterThreads));
}

/**
 * Gets all required labels, creating a missing one without changing messages.
 *
 * @returns {Object<string, GoogleAppsScript.Gmail.GmailLabel>}
 */
function getJobOpsGmailLabelMap_() {
  const labels = {};
  try {
    for (const name of JOBOPS_GMAIL_LABEL_NAMES) {
      labels[name] = GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
    }
  } catch (error) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.GMAIL_LABEL,
      `Unable to access JobOps Gmail labels: ${error.message}`,
    );
  }
  return labels;
}

/**
 * De-duplicates Gmail thread objects by their private ID.
 *
 * @param {GoogleAppsScript.Gmail.GmailThread[]} threads
 * @returns {GoogleAppsScript.Gmail.GmailThread[]}
 */
function uniqueJobOpsThreads_(threads) {
  const seen = new Set();
  return threads.filter((thread) => {
    const id = thread.getId();
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

/**
 * Adds a label in bounded GmailApp batches.
 *
 * @param {GoogleAppsScript.Gmail.GmailLabel} label
 * @param {GoogleAppsScript.Gmail.GmailThread[]} threads
 */
function addJobOpsLabelToThreads_(label, threads) {
  updateJobOpsThreadLabelBatches_(threads, (batch) => label.addToThreads(batch));
}

/**
 * Removes a label in bounded GmailApp batches.
 *
 * @param {GoogleAppsScript.Gmail.GmailLabel} label
 * @param {GoogleAppsScript.Gmail.GmailThread[]} threads
 */
function removeJobOpsLabelFromThreads_(label, threads) {
  updateJobOpsThreadLabelBatches_(threads, (batch) => label.removeFromThreads(batch));
}

/**
 * Executes a Gmail label operation with API-safe batch sizes.
 *
 * @param {GoogleAppsScript.Gmail.GmailThread[]} threads
 * @param {Function} operation
 */
function updateJobOpsThreadLabelBatches_(threads, operation) {
  try {
    for (let index = 0; index < threads.length; index += 100) {
      operation(threads.slice(index, index + 100));
    }
  } catch (error) {
    throw createJobOpsError_(
      JOBOPS_ERROR_CODES.GMAIL_LABEL,
      `Unable to update JobOps Gmail labels: ${error.message}`,
    );
  }
}
