/**
 * Deterministic clean-up of model output before it is stored. Models sometimes echo internal
 * markers (provenance labels, citation tags) into prose; citations are tracked separately, so
 * these must never reach students.
 */
export function cleanModelText(s: string): string {
  return s
    .replace(/^\s*(?:source[_ ]grounded|ai[_ ]supplementary|official)\s*[:\-–]\s*/i, '')
    .replace(/\s*\[\s*"?S\d{1,3}"?(?:\s*,\s*"?S\d{1,3}"?)*\s*\]/g, '')
    .replace(/\s*\(\s*S\d{1,3}(?:\s*,\s*S\d{1,3})*\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Remove outline numbering ("Week 2:", "2.1", "Unit 3 -", "IV.") from a topic title. */
export function stripTopicNumbering(s: string): string {
  return s
    .replace(
      /^\s*(?:week|unit|module|topic|chapter|lecture|section)\s+\d+[a-z]?\s*[:.)\-–]?\s*/i,
      '',
    )
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, '')
    .replace(/^\s*[IVXLC]+[.)]\s+/, '')
    .trim();
}
