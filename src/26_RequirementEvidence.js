/* global extractJobOpsTechnologies_ */

/** Extracts explicit evidence only. Absence is UNKNOWN, never zero experience.
 * @param {Object} job Normalized posting; description stays in memory.
 * @returns {Object} Facts for deterministic fit and human review.
 */
function extractJobOpsRequirementEvidence_(job) {
  const title = normalizeJobOpsSingleLineText_(job.position);
  const text = normalizeJobOpsMultilineText_(job.descriptionText);
  const clauses = text
    .split(/[\n.!;]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const preferred = /\b(?:preferred|desirable|nice to have|bonus|deseable|idealmente)\b/iu;
  const required =
    /\b(?:required|must|minimum|at least|requirements|requisito|obligatorio|mínimo|mínima)\b/iu;
  const yearsPattern = /\b(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?|años?)\b/iu;
  const experienceRequirements = [];
  let minimumYearsOverall = null;
  for (const clause of clauses) {
    const match = clause.match(yearsPattern);
    if (!match || preferred.test(clause) || !/experience|experiencia/iu.test(clause)) {
      continue;
    }
    if (/\b(?:AWS|Azure|GCP|cloud|Kubernetes|Terraform|Linux|Ansible|Bash)\b/iu.test(clause)) {
      experienceRequirements.push(clause.slice(0, 240));
    } else {
      minimumYearsOverall = Math.max(minimumYearsOverall || 0, Number(match[1]));
    }
  }
  const seniority = title.match(
    /\b(principal|director|manager|staff|lead|senior|junior|associate|entry|mid)\b/iu,
  );
  const mandatory = clauses.filter((s) => required.test(s) && !preferred.test(s));
  const desirable = clauses.filter((s) => preferred.test(s));
  const details = {
    language: clauses.filter((s) => /\b(?:English|inglés|B2|C1|C2)\b/iu.test(s)),
    geography: [
      job.location,
      ...clauses.filter((s) =>
        /\b(?:residen|eligible|authorized|visa|Colombia|LATAM|US only|United States only)\b/iu.test(
          s,
        ),
      ),
    ].filter(Boolean),
    contract: clauses.filter((s) =>
      /\b(?:contractor|full.time|part.time|contrato|indefinido|término fijo)\b/iu.test(s),
    ),
    salary: [job.salary].filter(Boolean),
  };
  const reviewReasons = Object.entries(details).map(
    ([key, values]) =>
      `${key}: ${values.length ? values.join(' | ').slice(0, 320) : 'UNKNOWN — revisar'}`,
  );
  reviewReasons.push(
    `Obligatorias: ${extractJobOpsTechnologies_(mandatory.join('\n')).join(', ') || 'UNKNOWN'}`,
  );
  reviewReasons.push(
    `Deseables: ${extractJobOpsTechnologies_(desirable.join('\n')).join(', ') || 'UNKNOWN'}`,
  );
  const cloudGap = mandatory
    .concat(experienceRequirements)
    .some(
      (s) =>
        /\b(?:AWS|Azure|GCP|cloud|Kubernetes)\b/iu.test(s) &&
        (/\b[1-9]\d*\s*\+?\s*(?:years?|años?)\b/iu.test(s) ||
          /production|professional|profesional/iu.test(s)),
    );
  if (cloudGap) {
    reviewReasons.push(
      'Experiencia profesional cloud/Kubernetes requerida; perfil actual en aprendizaje.',
    );
  }
  return {
    seniorityLevel: seniority ? seniority[1].toUpperCase() : 'UNKNOWN',
    minimumYearsOverall,
    experienceRequirements: experienceRequirements.slice(0, 12),
    hardRequirements: mandatory.map((s) => s.slice(0, 240)).slice(0, 12),
    reviewReasons,
    cloudGap,
  };
}
