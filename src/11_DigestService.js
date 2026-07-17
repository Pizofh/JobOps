/**
 * Selects digest sections from named Jobs and ParsingErrors records.
 *
 * @param {Object[]} jobs
 * @param {Object[]} errors
 * @param {Object} config
 * @param {Date} now
 * @returns {{jobs: Object[], recruiters: Object[], followUps: Object[], errors: Object[]}}
 */
function selectJobOpsDigestSections_(jobs, errors, config, now) {
  const activeStatuses = new Set(['NEW', 'REVIEW', 'READY']);
  const sortedJobs = jobs
    .filter(
      (job) =>
        activeStatuses.has(normalizeJobOpsSingleLineText_(job.STATUS).toUpperCase()) &&
        normalizeJobOpsSingleLineText_(job.PRIORITY).toUpperCase() !== 'LOW',
    )
    .sort(compareJobOpsDigestJobs_);
  const today = getJobOpsDateKey_(now, config.TIMEZONE);

  return {
    jobs: selectJobOpsDistributedDigestJobs_(sortedJobs, config.MAX_DIGEST_JOBS),
    recruiters: sortedJobs.filter(isJobOpsRecruiterRecord_).slice(0, config.MAX_DIGEST_JOBS),
    followUps: jobs.filter(
      (job) =>
        ['APPLIED', 'FOLLOW_UP'].includes(
          normalizeJobOpsSingleLineText_(job.STATUS).toUpperCase(),
        ) &&
        isJobOpsUsableDate_(job.FOLLOW_UP_DATE) &&
        getJobOpsDateKey_(new Date(job.FOLLOW_UP_DATE), config.TIMEZONE) <= today,
    ),
    errors: errors
      .filter((error) => !parseJobOpsLooseBoolean_(error.RESOLVED))
      .slice(0, config.MAX_DIGEST_JOBS),
  };
}

/**
 * Selects the daily top list with soft strategy buckets. Missing buckets are
 * never forced: the remaining highest-scored jobs fill the available space.
 *
 * @param {Object[]} sortedJobs
 * @param {number} maximum
 * @returns {Object[]}
 */
function selectJobOpsDistributedDigestJobs_(sortedJobs, maximum) {
  const limit = Math.max(Number(maximum) || 0, 0);
  if (limit === 0) {
    return [];
  }

  const buckets = [
    { name: 'DIRECT', share: 0.35 },
    { name: 'SUPPORT', share: 0.3 },
    { name: 'BACKEND', share: 0.2 },
    { name: 'INFRA_AUTOMATION', share: 0.1 },
    { name: 'SECONDARY', share: 0.05 },
  ];
  const cutoffJob = sortedJobs[Math.min(limit, sortedJobs.length) - 1];
  const cutoffPriority = cutoffJob ? getJobOpsDigestPriorityWeight_(cutoffJob) : 4;
  const eligibleJobs = sortedJobs.filter(
    (job) => getJobOpsDigestPriorityWeight_(job) <= cutoffPriority,
  );
  const selected = [];
  const selectedJobs = new Set();

  for (const bucket of buckets) {
    const quota = Math.floor(limit * bucket.share);
    let selectedForBucket = 0;
    for (const job of eligibleJobs) {
      if (selected.length >= limit || selectedForBucket >= quota) {
        break;
      }
      if (selectedJobs.has(job) || getJobOpsDigestStrategyBucket_(job) !== bucket.name) {
        continue;
      }
      selected.push(job);
      selectedJobs.add(job);
      selectedForBucket += 1;
    }
  }

  for (const job of sortedJobs) {
    if (selected.length >= limit) {
      break;
    }
    if (!selectedJobs.has(job)) {
      selected.push(job);
      selectedJobs.add(job);
    }
  }
  return selected;
}

/** @param {Object} job @returns {number} */
function getJobOpsDigestPriorityWeight_(job) {
  const weights = { HIGH: 0, REVIEW: 1, OPTIONAL: 2, LOW: 3 };
  return weights[normalizeJobOpsSingleLineText_(job.PRIORITY).toUpperCase()] ?? 4;
}

/** @param {Object} job @returns {string} */
function getJobOpsDigestStrategyBucket_(job) {
  const family = normalizeJobOpsSingleLineText_(job.ROLE_FAMILY).toUpperCase();
  if (['DEVOPS_CLOUDOPS_JR', 'PLATFORM_SRE_ASSOCIATE'].includes(family)) {
    return 'DIRECT';
  }
  if (['CLOUD_SUPPORT_OPERATIONS', 'APPLICATION_PRODUCTION_SUPPORT'].includes(family)) {
    return 'SUPPORT';
  }
  if (family === 'BACKEND_WITH_DEVOPS') {
    return 'BACKEND';
  }
  if (['RELEASE_CICD_AUTOMATION', 'LINUX_INFRASTRUCTURE'].includes(family)) {
    return 'INFRA_AUTOMATION';
  }
  if (['OBSERVABILITY_NOC', 'IAM_DEVSECOPS'].includes(family)) {
    return 'SECONDARY';
  }
  return 'OTHER';
}

/**
 * Builds an HTML and plain-text digest without including email bodies.
 *
 * @param {{jobs: Object[], recruiters: Object[], followUps: Object[], errors: Object[]}} sections
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{hasContent: boolean, htmlBody: string, plainBody: string}}
 */
function buildJobOpsDigest_(sections, now, timeZone) {
  const dateKey = getJobOpsDateKey_(now, timeZone);
  const hasContent = Object.values(sections).some((records) => records.length > 0);
  const htmlSections = [];
  const plainSections = [];

  appendJobOpsDigestJobSection_(
    htmlSections,
    plainSections,
    'Nuevas oportunidades prioritarias',
    sections.jobs,
  );
  appendJobOpsDigestJobSection_(
    htmlSections,
    plainSections,
    'Oportunidades de reclutadores',
    sections.recruiters,
  );
  appendJobOpsDigestJobSection_(
    htmlSections,
    plainSections,
    'Seguimientos vencidos',
    sections.followUps,
  );
  appendJobOpsDigestErrorSection_(htmlSections, plainSections, sections.errors);

  return {
    hasContent,
    htmlBody: `<h1>JobOps — ${escapeJobOpsHtml_(dateKey)}</h1>${htmlSections.join('')}`,
    plainBody: [`JobOps — ${dateKey}`, ...plainSections].join('\n\n'),
  };
}

/**
 * Sorts first by priority, then score and discovery time.
 *
 * @param {Object} first
 * @param {Object} second
 * @returns {number}
 */
function compareJobOpsDigestJobs_(first, second) {
  const weights = { HIGH: 0, REVIEW: 1, OPTIONAL: 2, LOW: 3 };
  const firstPriority = weights[normalizeJobOpsSingleLineText_(first.PRIORITY).toUpperCase()] ?? 4;
  const secondPriority =
    weights[normalizeJobOpsSingleLineText_(second.PRIORITY).toUpperCase()] ?? 4;
  const priorityDifference = firstPriority - secondPriority;
  if (priorityDifference) {
    return priorityDifference;
  }
  const scoreDifference = Number(second.MATCH_SCORE) - Number(first.MATCH_SCORE);
  if (scoreDifference) {
    return scoreDifference;
  }
  return new Date(second.DISCOVERED_AT).getTime() - new Date(first.DISCOVERED_AT).getTime();
}

/**
 * Appends a job list section to both digest representations.
 *
 * @param {string[]} htmlSections
 * @param {string[]} plainSections
 * @param {string} title
 * @param {Object[]} jobs
 */
function appendJobOpsDigestJobSection_(htmlSections, plainSections, title, jobs) {
  if (jobs.length === 0) {
    return;
  }
  htmlSections.push(`<h2>${escapeJobOpsHtml_(title)}</h2><ul>`);
  plainSections.push(title);
  for (const job of jobs) {
    const titleLine = `${job.POSITION || 'Cargo no detectado'} — ${job.COMPANY || 'Empresa no detectada'}`;
    const details = [
      job.SOURCE,
      job.LOCATION,
      job.WORK_MODE,
      `Score ${job.MATCH_SCORE}`,
      job.PRIORITY,
      job.ROLE_FAMILY,
      job.RECOMMENDED_CV,
    ]
      .filter(Boolean)
      .join(' · ');
    const url = normalizeJobOpsSingleLineText_(job.JOB_URL);
    htmlSections.push(
      `<li><strong>${escapeJobOpsHtml_(titleLine)}</strong><br>${escapeJobOpsHtml_(details)}${
        url ? ` · <a href="${escapeJobOpsHtml_(url)}">Revisar</a>` : ''
      }</li>`,
    );
    plainSections.push(`- ${titleLine} (${details})${url ? ` — ${url}` : ''}`);
  }
  htmlSections.push('</ul>');
}

/**
 * Appends a privacy-limited ParsingErrors section.
 *
 * @param {string[]} htmlSections
 * @param {string[]} plainSections
 * @param {Object[]} errors
 */
function appendJobOpsDigestErrorSection_(htmlSections, plainSections, errors) {
  if (errors.length === 0) {
    return;
  }
  htmlSections.push('<h2>Errores de procesamiento</h2><ul>');
  plainSections.push('Errores de procesamiento');
  for (const error of errors) {
    const item = [error.DETECTED_SOURCE, error.SUBJECT, error.ERROR_TYPE]
      .filter(Boolean)
      .join(' · ');
    htmlSections.push(`<li>${escapeJobOpsHtml_(item)}</li>`);
    plainSections.push(`- ${item}`);
  }
  htmlSections.push('</ul>');
}

/** @param {Object} job @returns {boolean} */
function isJobOpsRecruiterRecord_(job) {
  return normalizeJobOpsSingleLineText_(job.SOURCE) === 'Recruiter' || Boolean(job.RECRUITER_EMAIL);
}

/** @param {Date} value @param {string} timeZone @returns {string} */
function getJobOpsDateKey_(value, timeZone) {
  return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
}

/** @param {*} value @returns {string} */
function escapeJobOpsHtml_(value) {
  return String(value === null || value === undefined ? '' : value).replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}
