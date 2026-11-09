import type { NotesOutput, RevisionPackOutput } from '@cslp/validation';
import type { PromptContext } from './prompts.js';

/**
 * Development placeholders (AI_TEXT_PROVIDER=fake). Deterministic, schema-valid, built only from
 * the retrieved passages, and labelled on every section so they can't be mistaken for real
 * teaching content. Never available in production (the API refuses to start).
 */
const LABEL = 'Development placeholder';
const firstSentence = (t: string) =>
  (t.match(/^[^.!?]{10,240}[.!?]/)?.[0] ?? t.slice(0, 200)).trim();

export function placeholderNotes(c: PromptContext, simplified: boolean): NotesOutput {
  const grounded = c.passages.slice(0, 6).map((p) => ({
    kind: 'paragraph' as const,
    text: `From “${p.sourceTitle}”: ${firstSentence(p.text)}`,
    items: [],
    language: '',
    rows: [],
    citations: [p.label],
  }));
  const sections: NotesOutput['sections'] = [
    {
      type: 'introduction',
      heading: `Introduction to ${c.topicTitle}`,
      provenance: 'ai_supplementary',
      blocks: [
        {
          kind: 'callout',
          text: `${LABEL}: no AI model was used. Replace this text, or switch AI_TEXT_PROVIDER to openai.`,
          items: [],
          language: '',
          rows: [],
          citations: [],
        },
      ],
    },
  ];
  if (grounded.length)
    sections.push({
      type: 'concept',
      heading: 'What the approved sources say',
      provenance: 'source_grounded',
      blocks: grounded,
    });
  for (const s of c.subtopics) {
    sections.push({
      type: 'concept',
      heading: s,
      provenance: 'ai_supplementary',
      blocks: [
        {
          kind: 'paragraph',
          text: `${LABEL} for “${s}”.`,
          items: [],
          language: '',
          rows: [],
          citations: [],
        },
      ],
    });
  }
  if (!simplified && c.options.includeCode) {
    sections.push({
      type: 'code_example',
      heading: 'Example',
      provenance: 'ai_supplementary',
      blocks: [
        {
          kind: 'code',
          text: `# ${LABEL}\nprint("${c.topicTitle}")`,
          items: [],
          language: c.options.codeLanguage,
          rows: [],
          citations: [],
        },
      ],
    });
  }
  sections.push({
    type: 'conclusion',
    heading: 'Summary',
    provenance: 'ai_supplementary',
    blocks: [
      {
        kind: 'bullets',
        text: '',
        items: [`${LABEL}: summarise ${c.topicTitle} here.`],
        language: '',
        rows: [],
        citations: [],
      },
    ],
  });
  return {
    title: c.topicTitle,
    learningObjectives: c.topicObjectives.length
      ? c.topicObjectives
      : [`${LABEL}: state what students should be able to do after this topic.`],
    sections,
    glossary: [],
    insufficientSources: c.passages.length === 0,
    missingTopics: c.passages.length ? [] : [c.topicTitle],
  };
}

export function placeholderRevision(c: PromptContext): RevisionPackOutput {
  return {
    summary: `${LABEL}: summary of ${c.topicTitle}.`,
    keyPoints: c.passages
      .slice(0, 6)
      .map((p) => ({ text: firstSentence(p.text), citations: [p.label] })),
    flashcards: [
      { front: `${LABEL}: What is ${c.topicTitle}?`, back: 'Replace with a reviewed answer.' },
    ],
    faq: [
      {
        question: `${LABEL}: Why does ${c.topicTitle} matter?`,
        answer: 'Replace with a reviewed answer.',
      },
    ],
    checklist: [`${LABEL}: I can explain ${c.topicTitle} in my own words.`],
    insufficientSources: c.passages.length === 0,
    missingTopics: c.passages.length ? [] : [c.topicTitle],
  };
}
