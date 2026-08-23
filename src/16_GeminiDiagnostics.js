/* exported testGeminiConnection, diagnoseGeminiIngestion */
/* global assertValidJobOpsScriptProperties_, buildJobOpsAiEmailEvidence_, buildJobOpsGeminiRequest_, detectJobOpsSource_, extractJobOpsGeminiResponseText_, foldJobOpsText_, normalizeAndValidateJobOpsConfig_, openConfiguredJobOpsSpreadsheet_, readJobOpsConfig_, readJobOpsGmailCandidates_, readJobOpsScriptProperties_, readJobOpsSourceDefinitions_, validateJobOpsAiJobs_ */

const JOBOPS_GEMINI_DIAGNOSTIC_DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Tests Gemini connectivity with one minimal request. It does not read Gmail or
 * Sheets and never logs the API key or raw response body.
 *
 * @returns {{ok: boolean, status: number, model: string, response?: string, error?: string}}
 */
function testGeminiConnection() {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = String(properties.getProperty('GEMINI_API_KEY') || '').trim();
  const configuredModel = String(properties.getProperty('GEMINI_MODEL') || '').trim();
  const model =
    !configuredModel || configuredModel === 'gemini-2.5-flash-lite'
      ? JOBOPS_GEMINI_DIAGNOSTIC_DEFAULT_MODEL
      : configuredModel;

  if (!apiKey) {
    const result = {
      ok: false,
      status: 0,
      model,
      error: 'GEMINI_API_KEY is not configured.',
    };
    logJobOpsGeminiDiagnostic_(result);
    return result;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  const request = {
    contents: [{ role: 'user', parts: [{ text: 'Reply with exactly OK.' }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8,
    },
  };

  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(request),
      muteHttpExceptions: true,
    });
  } catch (error) {
    const result = {
      ok: false,
      status: 0,
      model,
      error: sanitizeJobOpsGeminiDiagnosticMessage_(
        error && error.message ? error.message : 'Gemini request failed before an HTTP response.',
        apiKey,
      ),
    };
    logJobOpsGeminiDiagnostic_(result);
    return result;
  }

  const status = Number(response.getResponseCode()) || 0;
  const responseText = String(response.getContentText() || '');

  if (status < 200 || status >= 300) {
    const result = {
      ok: false,
      status,
      model,
      error: parseJobOpsGeminiDiagnosticError_(responseText, apiKey),
    };
    logJobOpsGeminiDiagnostic_(result);
    return result;
  }

  const result = {
    ok: true,
    status,
    model,
    response: extractJobOpsGeminiDiagnosticText_(responseText) || 'OK',
  };
  logJobOpsGeminiDiagnostic_(result);
  return result;
}

/**
 * Diagnoses the real Indeed path with one candidate message only. It does not
 * write to Gmail or Sheets and logs counts/HTTP metadata only, never subject,
 * body, addresses, URLs or the API key.
 *
 * @returns {Object}
 */
function diagnoseGeminiIngestion() {
  const properties = readJobOpsScriptProperties_();
  assertValidJobOpsScriptProperties_(properties);
  const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
  const config = normalizeAndValidateJobOpsConfig_(readJobOpsConfig_(spreadsheet));
  const sourceDefinitions = readJobOpsSourceDefinitions_(spreadsheet);
  const inbox = readJobOpsGmailCandidates_(config, sourceDefinitions);
  const indeedCandidates = inbox.candidates
    .map((envelope) => ({
      envelope,
      detection: envelope.detection || detectJobOpsSource_(envelope.input, sourceDefinitions),
    }))
    .filter((item) => foldJobOpsText_(item.detection.source) === 'indeed');

  const baseResult = {
    ok: false,
    candidateMessages: inbox.candidates.length,
    indeedCandidates: indeedCandidates.length,
    jobLinks: 0,
    bodyChars: 0,
    status: 0,
    model: '',
    modelJobs: 0,
    validJobs: 0,
    error: '',
  };

  if (indeedCandidates.length === 0) {
    baseResult.error = 'No Indeed candidate was found in the current ingestion window.';
    logJobOpsGeminiIngestionDiagnostic_(baseResult);
    return baseResult;
  }

  const { envelope, detection } = indeedCandidates[0];
  const evidence = buildJobOpsAiEmailEvidence_(envelope.input, detection);
  baseResult.jobLinks = evidence.jobLinks.length;
  baseResult.bodyChars = evidence.body.length;

  if (evidence.jobLinks.length === 0) {
    baseResult.error = 'No Indeed job-card links were extracted locally from the first candidate.';
    logJobOpsGeminiIngestionDiagnostic_(baseResult);
    return baseResult;
  }

  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = String(scriptProperties.getProperty('GEMINI_API_KEY') || '').trim();
  const configuredModel = String(scriptProperties.getProperty('GEMINI_MODEL') || '').trim();
  const model =
    !configuredModel || configuredModel === 'gemini-2.5-flash-lite'
      ? JOBOPS_GEMINI_DIAGNOSTIC_DEFAULT_MODEL
      : configuredModel;
  baseResult.model = model;

  if (!apiKey) {
    baseResult.error = 'GEMINI_API_KEY is not configured.';
    logJobOpsGeminiIngestionDiagnostic_(baseResult);
    return baseResult;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(buildJobOpsGeminiRequest_(evidence)),
      muteHttpExceptions: true,
    });
  } catch (error) {
    baseResult.error = sanitizeJobOpsGeminiDiagnosticMessage_(
      error && error.message ? error.message : 'Gemini request failed before an HTTP response.',
      apiKey,
    );
    logJobOpsGeminiIngestionDiagnostic_(baseResult);
    return baseResult;
  }

  baseResult.status = Number(response.getResponseCode()) || 0;
  const responseText = String(response.getContentText() || '');
  if (baseResult.status < 200 || baseResult.status >= 300) {
    baseResult.error = parseJobOpsGeminiDiagnosticError_(responseText, apiKey);
    logJobOpsGeminiIngestionDiagnostic_(baseResult);
    return baseResult;
  }

  try {
    const payload = JSON.parse(responseText);
    const structuredText = extractJobOpsGeminiResponseText_(payload);
    const structured = JSON.parse(structuredText);
    baseResult.modelJobs = Array.isArray(structured.jobs) ? structured.jobs.length : 0;
    baseResult.validJobs = validateJobOpsAiJobs_(structured, evidence).length;
    baseResult.ok = baseResult.validJobs > 0;
    if (!baseResult.ok) {
      baseResult.error = 'Gemini returned structured jobs, but none passed local validation.';
    }
  } catch (error) {
    baseResult.error = sanitizeJobOpsGeminiDiagnosticMessage_(
      error && error.message ? error.message : 'Unable to parse Gemini structured output.',
      apiKey,
    );
  }

  logJobOpsGeminiIngestionDiagnostic_(baseResult);
  return baseResult;
}

/**
 * Extracts only Google's error message and avoids returning the raw API body.
 *
 * @param {*} responseText
 * @param {string} apiKey
 * @returns {string}
 */
function parseJobOpsGeminiDiagnosticError_(responseText, apiKey) {
  let message = '';
  try {
    const payload = JSON.parse(String(responseText || ''));
    message = payload && payload.error && payload.error.message ? payload.error.message : '';
  } catch {
    // A non-JSON API response is summarized below without exposing the body.
  }

  return sanitizeJobOpsGeminiDiagnosticMessage_(
    message || 'Gemini returned an error response without a readable error message.',
    apiKey,
  );
}

/**
 * Extracts the short model reply without logging the full response payload.
 *
 * @param {*} responseText
 * @returns {string}
 */
function extractJobOpsGeminiDiagnosticText_(responseText) {
  try {
    const payload = JSON.parse(String(responseText || ''));
    const parts =
      payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content
        ? payload.candidates[0].content.parts || []
        : [];
    return parts
      .map((part) => String((part && part.text) || '').trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 100);
  } catch {
    return '';
  }
}

/**
 * Removes the configured API key from a diagnostic message if an upstream
 * service unexpectedly echoes it.
 *
 * @param {*} value
 * @param {string} apiKey
 * @returns {string}
 */
function sanitizeJobOpsGeminiDiagnosticMessage_(value, apiKey) {
  let message = String(value || '')
    .replace(/https?:\/\/\S+/giu, '[url removed]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email removed]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
  if (apiKey) {
    message = message.split(apiKey).join('[redacted]');
  }
  return message;
}

/**
 * Logs only status/model/result metadata.
 *
 * @param {Object} result
 */
function logJobOpsGeminiDiagnostic_(result) {
  const detail = result.ok ? result.response || 'OK' : result.error || 'Unknown error';
  Logger.log(
    `JobOps Gemini diagnostic: ok=${result.ok}, status=${result.status}, model=${result.model}, detail=${detail}`,
  );
}

/**
 * Logs privacy-safe ingestion diagnostics for one candidate.
 *
 * @param {Object} result
 */
function logJobOpsGeminiIngestionDiagnostic_(result) {
  Logger.log(
    `JobOps Gemini ingestion diagnostic: ok=${result.ok}, candidates=${result.candidateMessages}, indeed=${result.indeedCandidates}, jobLinks=${result.jobLinks}, bodyChars=${result.bodyChars}, status=${result.status}, model=${result.model || 'n/a'}, modelJobs=${result.modelJobs}, validJobs=${result.validJobs}, detail=${result.error || 'OK'}`,
  );
}
