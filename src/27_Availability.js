/* global Utilities */

/** Official individual endpoint only; never fetches a job web page. */
function buildJobOpsAvailabilityUrl_(guid) {
  const match = String(guid || '').match(
    /^https:\/\/himalayas\.app(\/companies\/[a-z0-9-]+\/jobs\/[a-z0-9-]+)$/u,
  );
  return match ? 'https://himalayas.app/jobs/api' + match[1] : '';
}

/** Network/format errors and 404 are deliberately inconclusive. */
function fetchJobOpsAvailability_(guid, fetcher) {
  const url = buildJobOpsAvailabilityUrl_(guid);
  if (!url) {
    return { state: 'UNKNOWN', reason: 'Unsupported guid' };
  }
  try {
    const response = (fetcher || ((u, o) => UrlFetchApp.fetch(u, o)))(url, {
      muteHttpExceptions: true,
      followRedirects: false,
      headers: { Accept: 'application/json' },
    });
    const code = response.getResponseCode();
    if (code === 429) {
      return { state: 'UNKNOWN', reason: 'HTTP 429', rateLimited: true };
    }
    const body = JSON.parse(response.getContentText());
    if (code === 200 && body.job && body.job.guid === guid) {
      return { state: 'OPEN', reason: 'Official API 200' };
    }
    if (code === 410 && body && Number(body.expiryDate) > 0) {
      return { state: 'CLOSED', reason: 'Official API 410 with expiryDate' };
    }
    return { state: 'UNKNOWN', reason: 'Inconclusive HTTP ' + code };
  } catch {
    return { state: 'UNKNOWN', reason: 'Network or invalid response' };
  }
}

/** Manual, bounded check. Separate evidence sheet leaves Jobs entirely intact.
 * Script Property AVAILABILITY_DAILY_LIMIT can reduce the hard daily cap of 20.
 */
function checkJobAvailability() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('JobOps is busy');
  }
  try {
    const properties = readJobOpsScriptProperties_();
    assertValidJobOpsScriptProperties_(properties);
    const spreadsheet = openConfiguredJobOpsSpreadsheet_(properties.SPREADSHEET_ID);
    const store = PropertiesService.getScriptProperties();
    const day = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
    const key = 'AVAILABILITY_USAGE_' + day;
    const limit = Math.max(
      0,
      Math.min(20, Number(store.getProperty('AVAILABILITY_DAILY_LIMIT') || 20) || 0),
    );
    let used = Number(store.getProperty(key)) || 0;
    const sheet =
      spreadsheet.getSheetByName('Availability') || spreadsheet.insertSheet('Availability');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['JOB_ID', 'CHECKED_AT', 'STATE', 'REASON']);
    }
    const latest = new Map(
      sheet
        .getDataRange()
        .getValues()
        .slice(1)
        .map((r) => [String(r[0]), new Date(r[1]).getTime()]),
    );
    let checked = 0;
    for (const target of readJobOpsJobsForRescore_(spreadsheet)) {
      const r = target.record;
      if (used >= limit || store.getProperty('AVAILABILITY_STOP_DAY') === day) {
        break;
      }
      if (
        r.SOURCE !== 'Himalayas' ||
        !['NEW', 'REVIEW', 'READY', 'APPLIED', 'FOLLOW_UP', 'SCREENING', 'TECHNICAL'].includes(
          r.STATUS,
        )
      ) {
        continue;
      }
      if (
        !buildJobOpsAvailabilityUrl_(r.SOURCE_JOB_ID) ||
        Date.now() - (latest.get(String(r.JOB_ID)) || 0) < 86400000
      ) {
        continue;
      }
      used += 1;
      store.setProperty(key, String(used));
      const result = fetchJobOpsAvailability_(r.SOURCE_JOB_ID);
      sheet.appendRow([r.JOB_ID, new Date(), result.state, result.reason]);
      checked += 1;
      if (result.rateLimited) {
        store.setProperty('AVAILABILITY_STOP_DAY', day);
        break;
      }
      Utilities.sleep(1100);
    }
    return { checked, used, limit };
  } finally {
    lock.releaseLock();
  }
}
