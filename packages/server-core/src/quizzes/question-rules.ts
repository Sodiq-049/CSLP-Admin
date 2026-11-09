import { createHash, randomUUID } from 'node:crypto';
import type { QuestionType } from '@cslp/shared-types';

export interface QuestionDraft {
  type: QuestionType;
  stem: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
}

export const normaliseStem = (s: string) =>
  s
    .toLowerCase()
    .replace(/_{2,}/g, ' blank ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const stemHash = (s: string) => createHash('sha256').update(normaliseStem(s)).digest('hex');

const tokens = (s: string) =>
  new Set(
    normaliseStem(s)
      .split(' ')
      .filter((t) => t.length > 2),
  );
/** Token-set Jaccard similarity: a cheap near-duplicate signal (docs/06 §8). */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

/** Returns a list of problems; empty means valid. Same rules for AI output and manual edits. */
export function validateQuestion(q: QuestionDraft): string[] {
  const problems: string[] = [];
  if (q.stem.trim().length < 5) problems.push('The question text is too short');
  const texts = q.options.map((o) => o.text.trim().toLowerCase());
  const correct = q.options.filter((o) => o.isCorrect).length;
  switch (q.type) {
    case 'mcq_single':
      if (q.options.length < 3 || q.options.length > 6)
        problems.push('Multiple choice needs 3–6 options');
      if (correct !== 1) problems.push('Multiple choice needs exactly one correct option');
      if (new Set(texts).size !== texts.length)
        problems.push('Options must be different from each other');
      if (texts.some((t) => !t)) problems.push('Options cannot be empty');
      break;
    case 'true_false':
      if (q.options.length !== 2 || correct !== 1)
        problems.push('True/false needs the two options True and False with one marked correct');
      break;
    case 'fill_gap':
      if (!/_{3,}/.test(q.stem))
        problems.push('Fill-in-the-gap questions need a blank written as ____');
      if (!q.acceptedAnswers.some((a) => a.trim()))
        problems.push('Add at least one accepted answer');
      break;
    case 'short_answer':
      if (!q.acceptedAnswers.some((a) => a.trim()))
        problems.push('Add the key points a correct answer must include');
      break;
  }
  return problems;
}

/** Build options from model output (index of the correct option). */
export function optionsFrom(type: QuestionType, options: string[], correctIndex: number) {
  if (type === 'true_false') {
    const truth = correctIndex === 0;
    return [
      { id: randomUUID().slice(0, 8), text: 'True', isCorrect: truth },
      { id: randomUUID().slice(0, 8), text: 'False', isCorrect: !truth },
    ];
  }
  if (type !== 'mcq_single') return [];
  return options.map((text, i) => ({
    id: randomUUID().slice(0, 8),
    text: text.trim(),
    isCorrect: i === correctIndex,
  }));
}
