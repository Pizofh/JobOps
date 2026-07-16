/**
 * Decodes the small, predictable HTML entity set found in job emails.
 *
 * @param {*} value
 * @returns {string}
 */
function decodeJobOpsHtmlEntities_(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return String(value === null || value === undefined ? '' : value)
    .replace(/&(#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/giu, (_match, entity) => {
      const normalized = entity.toLowerCase();
      if (normalized[0] !== '#') {
        return namedEntities[normalized];
      }

      const hexadecimal = normalized[1] === 'x';
      const number = Number.parseInt(normalized.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : _match;
    })
    .replace(/\u00a0/gu, ' ');
}

/**
 * Produces readable plain text without executing or logging HTML content.
 *
 * @param {*} html
 * @returns {string}
 */
function jobOpsHtmlToText_(html) {
  return normalizeJobOpsMultilineText_(
    decodeJobOpsHtmlEntities_(html)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
      .replace(/<\s*br\s*\/?\s*>/giu, '\n')
      .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/giu, '\n')
      .replace(/<li\b[^>]*>/giu, '- ')
      .replace(/<[^>]+>/gu, ' '),
  );
}

/**
 * Normalizes a value to one line.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeJobOpsSingleLineText_(value) {
  return decodeJobOpsHtmlEntities_(value).replace(/\s+/gu, ' ').trim();
}

/**
 * Normalizes whitespace while preserving useful line boundaries.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeJobOpsMultilineText_(value) {
  return decodeJobOpsHtmlEntities_(value)
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Removes accents for comparisons but never changes stored display values.
 *
 * @param {*} value
 * @returns {string}
 */
function foldJobOpsText_(value) {
  return normalizeJobOpsSingleLineText_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

/**
 * Removes known analytics parameters from an HTTP(S) URL.
 *
 * @param {*} value
 * @returns {string}
 */
function canonicalizeJobOpsUrl_(value) {
  let url = decodeJobOpsHtmlEntities_(value)
    .trim()
    .replace(/^[<(\[]+/u, '')
    .replace(/[>\])},.;:!?]+$/u, '');

  const match = url.match(/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/iu);
  if (!match) {
    return '';
  }

  const protocol = match[1].toLowerCase();
  const authority = match[2].toLowerCase();
  const path = match[3] || '';
  const trackingParameters = new Set(
    JOBOPS_TRACKING_QUERY_PARAMETERS.map((parameter) => parameter.toLowerCase()),
  );
  const queryParts = (match[4] || '').split('&').filter((part) => {
    if (!part) {
      return false;
    }
    const rawKey = part.split('=', 1)[0];
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/gu, ' '));
    } catch {
      // Keep malformed, non-tracking parameters instead of changing URL meaning.
    }
    return !trackingParameters.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_');
  });

  url = `${protocol}://${authority}${path}`;
  if (queryParts.length > 0) {
    url += `?${queryParts.join('&')}`;
  }
  return url;
}

/**
 * Extracts unique canonical HTTP(S) links in their original order.
 *
 * @param {*} value
 * @returns {string[]}
 */
function extractJobOpsUrls_(value) {
  const matches = decodeJobOpsHtmlEntities_(value).match(/https?:\/\/[^\s<>"']+/giu) || [];
  const seen = new Set();
  const urls = [];

  for (const match of matches) {
    const url = canonicalizeJobOpsUrl_(match);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Detects work mode from Spanish or English job text.
 *
 * @param {*} value
 * @returns {string}
 */
function detectJobOpsWorkMode_(value) {
  const text = foldJobOpsText_(value);

  if (/\b(hybrid|hibrid[oa]|semi[- ]?presencial)\b/u.test(text)) {
    return 'HYBRID';
  }
  if (/\b(remote|remot[oa]|work from home|home[- ]?office|teletrabajo)\b/u.test(text)) {
    return 'REMOTE';
  }
  if (/\b(on[- ]?site|onsite|presencial|in office)\b/u.test(text)) {
    return 'ONSITE';
  }
  return 'UNKNOWN';
}

/**
 * Extracts a stable, de-duplicated technology list.
 *
 * @param {*} value
 * @returns {string[]}
 */
function extractJobOpsTechnologies_(value) {
  const text = foldJobOpsText_(value);

  return JOBOPS_TECHNOLOGY_NAMES.filter((technology) => {
    const signal = foldJobOpsText_(technology);
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'u').test(text);
  });
}

/**
 * Reads the first non-empty labeled line from a message body.
 *
 * @param {*} value
 * @param {string[]} labels
 * @returns {string}
 */
function extractJobOpsLabeledValue_(value, labels) {
  const lines = normalizeJobOpsMultilineText_(value).split('\n');
  const foldedLabels = labels.map(foldJobOpsText_);

  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const label = foldJobOpsText_(line.slice(0, separator));
    if (foldedLabels.includes(label)) {
      return normalizeJobOpsSingleLineText_(line.slice(separator + 1));
    }
  }

  return '';
}

/**
 * Extracts the original headers from Gmail or Outlook forwarded content.
 *
 * @param {*} body
 * @returns {{forwarded: boolean, from: string, subject: string}}
 */
function extractJobOpsForwardedMetadata_(body) {
  const text = normalizeJobOpsMultilineText_(body);
  const from = extractJobOpsLabeledValue_(text, ['From', 'De']);
  const subject = extractJobOpsLabeledValue_(text, ['Subject', 'Asunto']);
  const hasForwardMarker = /forwarded message|mensaje reenviado|mensaje original/iu.test(text);

  return {
    forwarded: Boolean((from && subject) || hasForwardMarker),
    from,
    subject,
  };
}

/**
 * Splits a sender header into a display name and email address.
 *
 * @param {*} value
 * @returns {{name: string, email: string}}
 */
function parseJobOpsSender_(value) {
  const text = normalizeJobOpsSingleLineText_(value);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  const email = emailMatch ? emailMatch[0].toLowerCase() : '';
  const name = normalizeJobOpsSingleLineText_(
    email ? text.replace(email, '').replace(/[<>"']/gu, ' ') : text,
  );

  return { name, email };
}

/**
 * Finds a short salary expression without retaining the full email body.
 *
 * @param {*} value
 * @returns {string}
 */
function extractJobOpsSalary_(value) {
  const text = normalizeJobOpsSingleLineText_(value);
  const match = text.match(
    /(?:salary|salario|compensation|remuneraci[oó]n)\s*:?\s*((?:USD|COP|EUR|\$|€)\s*[\d.,]+(?:\s*(?:-|to|a)\s*(?:USD|COP|EUR|\$|€)?\s*[\d.,]+)?(?:\s*(?:monthly|mensual|yearly|annual|anual|per month|al mes))?)/iu,
  );
  return match ? normalizeJobOpsSingleLineText_(match[1]) : '';
}

/**
 * Finds a concise experience requirement.
 *
 * @param {*} value
 * @returns {string}
 */
function extractJobOpsExperience_(value) {
  const text = normalizeJobOpsSingleLineText_(value);
  const match = text.match(
    /(?:experience|experiencia)\s*:?\s*((?:minimum|minimo|m[ií]nimo|at least|al menos)?\s*\d+\s*\+?\s*(?:years?|a[nñ]os?))/iu,
  );
  return match ? normalizeJobOpsSingleLineText_(match[1]) : '';
}
