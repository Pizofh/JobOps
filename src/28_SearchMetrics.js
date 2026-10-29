/** Snapshot metrics: never invent past transitions or assume a recommended CV was used. */
function buildJobOpsSearchMetrics_(records) {
  const groups = {};
  for (const record of records) {
    for (const [dimension, value] of [
      ['source', record.SOURCE],
      ['family', record.ROLE_FAMILY],
    ]) {
      const key = dimension + ': ' + (value || 'UNKNOWN');
      const group = groups[key] || { found: 0, applied: 0, interview: 0, rejected: 0, offers: 0 };
      group.found += 1;
      const applied =
        Boolean(record.APPLIED_DATE) ||
        ['APPLIED', 'FOLLOW_UP', 'SCREENING', 'TECHNICAL', 'OFFER'].includes(record.STATUS);
      if (applied) {
        group.applied += 1;
      }
      if (['SCREENING', 'TECHNICAL', 'OFFER'].includes(record.STATUS)) {
        group.interview += 1;
      }
      if (record.STATUS === 'REJECTED') {
        group.rejected += 1;
      }
      if (record.STATUS === 'OFFER') {
        group.offers += 1;
      }
      groups[key] = group;
    }
  }
  return groups;
}
