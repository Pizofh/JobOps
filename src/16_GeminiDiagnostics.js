/* exported testGeminiConnection */

const JOBOPS_GEMINI_DIAGNOSTIC_DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/**
 * Tests Gemini connectivity with one minimal request. It does not read Gmail or
 * Sheets and never logs the API key or raw response body.
 *
 * @returns {{ok: boolean, status: number, model: string, response?: string, error?: string}}
 */
function testGeminiConnection() {
  const properties = PropertiesService.getScriptProperties();
  const apiKey = String(properties.getProperty('GEMINI_API_KEY') || '').trim();
  const model =
    String(properties.getProperty('GEMINI_MODEL') || '').trim() ||
    JOBOPS_GEMINI_DIAGNOSTIC_DEFAULT_MODEL;

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
  let message = String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 500);
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
