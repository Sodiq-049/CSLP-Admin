import type { QuestionType } from '@cslp/shared-types';
import type { AnswerOutcome } from './learning.schemas.js';

/** Lower-case, collapse whitespace, drop surrounding punctuation/quotes. */
export const normaliseAnswer = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’(\[]+|["'“”‘’)\].,;:!?]+$/g, '')
    .trim();

export interface GradableQuestion {
  type: QuestionType;
  options: { id: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
}

/**
 * Grade one answer from the pinned question revision (docs/05 §7: answers never leave the server
 * before submission). `scored` = whether it counts toward the score (short answers without an
 * accepted-answer match are left for a human).
 */
export function gradeAnswer(
  q: GradableQuestion,
  a: { optionId?: string | null; text?: string | null } | undefined,
): { outcome: AnswerOutcome; scored: boolean } {
  if (q.type === 'mcq_single' || q.type === 'true_false') {
    if (!a?.optionId) return { outcome: 'unanswered', scored: true };
    const correct = q.options.find((o) => o.isCorrect)?.id;
    return { outcome: a.optionId === correct ? 'correct' : 'incorrect', scored: true };
  }
  const text = a?.text ? normaliseAnswer(a.text) : '';
  const accepted = new Set(q.acceptedAnswers.map(normaliseAnswer).filter(Boolean));
  if (q.type === 'fill_gap') {
    if (!text) return { outcome: 'unanswered', scored: true };
    return { outcome: accepted.has(text) ? 'correct' : 'incorrect', scored: true };
  }
  // short_answer
  if (!text) return { outcome: 'unanswered', scored: false };
  if (accepted.has(text)) return { outcome: 'correct', scored: true };
  return { outcome: 'needs_review', scored: false };
}
