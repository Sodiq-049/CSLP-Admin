import type { TextBlock } from './extract-text.js';

export interface SuggestedNode {
  key: string;
  title: string;
  sourceQuote: string | null;
  confidence: 'high' | 'medium' | 'low';
  children: Omit<SuggestedNode, 'children'>[];
}
export interface OutlineSuggestion {
  nodes: SuggestedNode[];
  detectedMetadata: {
    courseCode: string | null;
    courseTitle: string | null;
    creditUnits: number | null;
    objectives: string[];
  };
  warnings: string[];
}

/** Sections that are part of a course outline but are not teaching topics (brief §9). */
const NON_TOPIC_SECTION =
  /^(?:course\s+)?(?:objectives?|aims?|learning\s+outcomes?|references?|reading\s+list|recommended\s+(?:texts?|books?|reading)|text\s*books?|assessment|grading|evaluation|course\s+(?:description|code|title|information)|lecturer|contact|prerequisites?|credit\s+units?|attendance|methods?\s+of\s+(?:teaching|delivery)|general\s+objectives?)\b/i;
const OBJECTIVE_SECTION =
  /^(?:course\s+)?(?:(?:general|specific)\s+)?(?:objectives?|aims?|learning\s+outcomes?)\b/i;

const TOPIC_PATTERNS: { re: RegExp; level: 0 | 1; confidence: 'high' | 'medium' }[] = [
  {
    re: /^(?:week|unit|module|topic|chapter|lecture)\s+\d+[a-z]?\s*[:.)\-–]?\s*(.+)$/i,
    level: 0,
    confidence: 'high',
  },
  { re: /^\d+\.\d+[.)]?\s+(.+)$/, level: 1, confidence: 'high' },
  { re: /^\d+[.)]\s+(.+)$/, level: 0, confidence: 'high' },
  { re: /^[IVXLC]+[.)]\s+(.+)$/, level: 0, confidence: 'medium' },
  { re: /^\(?[a-z][.)]\s+(.+)$/, level: 1, confidence: 'medium' },
  { re: /^[-•*▪◦]\s+(.+)$/, level: 1, confidence: 'medium' },
];

const cleanTitle = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/[:;,.\s]+$/, '')
    .trim();
const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : s;

/** Course metadata found in the text: shown beside stored values, never applied automatically. */
export function detectMetadata(text: string): OutlineSuggestion['detectedMetadata'] {
  const code = text.match(/\b(?:course\s+code\s*[:\-]?\s*)?([A-Z]{2,6})\s?-?(\d{3}[A-Z]?)\b/);
  const title = text.match(
    /course\s+title\s*[:\-]\s*(.+?)(?=\s+(?:course\s+code|credit\s+units?|units?\s*:|level|semester)\b|\s*$)/im,
  );
  const units =
    text.match(/credit[ \t]*units?[ \t]*[:\-]?[ \t]*(\d{1,2})\b/i) ??
    text.match(/(?<![\d.])\b(\d{1,2})[ \t]*(?:credit[ \t]*units?|CU)\b/i);
  return {
    courseCode: code ? `${code[1]} ${code[2]}` : null,
    courseTitle: title ? cleanTitle(title[1]!).slice(0, 200) : null,
    creditUnits: units ? Number(units[1]) : null,
    objectives: [],
  };
}

/**
 * Deterministic outline suggestion from extracted blocks. It is intentionally conservative:
 * unknown lines are ignored rather than guessed, and every node keeps a source quote so the
 * reviewer can check it against the original document.
 */
export function suggestOutline(blocks: TextBlock[], fullText: string): OutlineSuggestion {
  const meta = detectMetadata(fullText);
  const warnings: string[] = [];
  const nodes: SuggestedNode[] = [];
  let section: 'topics' | 'objectives' | 'skip' = 'topics';
  let n = 0;
  const key = () => `n${++n}`;

  for (const b of blocks) {
    const line = b.text.trim();
    if (!line || line.length > 200) continue;

    if (b.headingLevel === 1 || NON_TOPIC_SECTION.test(line)) {
      if (OBJECTIVE_SECTION.test(line)) {
        section = 'objectives';
        continue;
      }
      if (NON_TOPIC_SECTION.test(line)) {
        section = 'skip';
        warnings.push(
          `Skipped “${cleanTitle(line).slice(0, 60)}”: looks like course information, not a teaching topic.`,
        );
        continue;
      }
      if (
        /^(?:course\s+)?(?:outline|content|contents|syllabus|topics|course\s+content)\b/i.test(line)
      ) {
        section = 'topics';
        continue;
      }
    }

    if (section === 'objectives') {
      const m = line.match(/^(?:\d+[.)]|[-•*▪◦]|\(?[a-z][.)])\s+(.+)$/i);
      if (m) {
        meta.objectives.push(cleanTitle(m[1]!));
        continue;
      }
      if (b.headingLevel) section = 'topics';
      else continue;
    }
    if (section === 'skip') {
      if (b.headingLevel === 1 && !NON_TOPIC_SECTION.test(line)) section = 'topics';
      else continue;
    }

    let matched = false;
    for (const p of TOPIC_PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      const title = titleCase(cleanTitle(m[1]!));
      if (title.length < 3) break;
      if (p.level === 1 && nodes.length) {
        nodes[nodes.length - 1]!.children.push({
          key: key(),
          title,
          sourceQuote: line,
          confidence: p.confidence,
        });
      } else {
        nodes.push({
          key: key(),
          title,
          sourceQuote: line,
          confidence: p.level === 1 ? 'low' : p.confidence,
          children: [],
        });
      }
      matched = true;
      break;
    }
    if (!matched && b.headingLevel && b.headingLevel <= 2 && line.split(/\s+/).length <= 12) {
      const title = titleCase(cleanTitle(line));
      if (b.headingLevel === 2 && nodes.length)
        nodes[nodes.length - 1]!.children.push({
          key: key(),
          title,
          sourceQuote: line,
          confidence: 'low',
        });
      else nodes.push({ key: key(), title, sourceQuote: line, confidence: 'low', children: [] });
    }
  }

  if (!nodes.length)
    warnings.push('No topics could be identified automatically. Add them manually.');
  return {
    nodes: nodes.slice(0, 100),
    detectedMetadata: meta,
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}
