import type { NotesOutput } from '@cslp/validation';

/**
 * TipTap/ProseMirror JSON helpers shared by generation (server) and the editor (client schema).
 * The allow-list is the only HTML-adjacent surface: anything else is dropped on save.
 */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const PROVENANCE = new Set(['official', 'source_grounded', 'ai_supplementary']);
const NODE_ATTRS: Record<string, (attrs: Record<string, unknown>) => Record<string, unknown>> = {
  doc: () => ({}),
  text: () => ({}),
  paragraph: (a) => prov(a),
  heading: (a) => ({ level: clampInt(a.level, 1, 4, 2), ...prov(a) }),
  bulletList: (a) => prov(a),
  orderedList: (a) => ({ start: clampInt(a.start, 1, 999, 1), ...prov(a) }),
  listItem: () => ({}),
  blockquote: (a) => prov(a),
  codeBlock: (a) => ({
    language:
      typeof a.language === 'string'
        ? a.language.replace(/[^\w+#.-]/g, '').slice(0, 20) || null
        : null,
    ...prov(a),
  }),
  horizontalRule: () => ({}),
  hardBreak: () => ({}),
  table: (a) => prov(a),
  tableRow: () => ({}),
  tableHeader: (a) => cell(a),
  tableCell: (a) => cell(a),
};
const MARK_ATTRS: Record<
  string,
  (attrs: Record<string, unknown>) => Record<string, unknown> | null
> = {
  bold: () => ({}),
  italic: () => ({}),
  underline: () => ({}),
  strike: () => ({}),
  code: () => ({}),
  link: (a) =>
    typeof a.href === 'string' && /^https?:\/\//i.test(a.href)
      ? { href: a.href.slice(0, 2000) }
      : null,
  citation: (a) =>
    typeof a.label === 'string' && /^S\d{1,3}$/.test(a.label)
      ? { label: a.label, index: clampInt(a.index, 1, 999, 1) }
      : null,
};

function prov(a: Record<string, unknown>) {
  return typeof a.provenance === 'string' && PROVENANCE.has(a.provenance)
    ? { provenance: a.provenance }
    : {};
}
function cell(a: Record<string, unknown>) {
  return { colspan: clampInt(a.colspan, 1, 20, 1), rowspan: clampInt(a.rowspan, 1, 20, 1) };
}
function clampInt(v: unknown, min: number, max: number, dflt: number) {
  const n = typeof v === 'number' && Number.isInteger(v) ? v : dflt;
  return Math.min(max, Math.max(min, n));
}

export const MAX_DOC_BYTES = 500_000;

/** Returns a cleaned copy of the document; unknown nodes/marks/attributes are removed. */
export function sanitizeDoc(input: unknown, depth = 0): PMNode | null {
  if (!input || typeof input !== 'object' || depth > 30) return null;
  const n = input as PMNode;
  const attrFn = NODE_ATTRS[n.type];
  if (!attrFn) return null;
  const out: PMNode = { type: n.type };
  const attrs = attrFn((n.attrs ?? {}) as Record<string, unknown>);
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (n.type === 'text') {
    if (typeof n.text !== 'string' || !n.text) return null;
    out.text = n.text.slice(0, 20_000);
    const marks = (n.marks ?? [])
      .map((m) => {
        const fn = MARK_ATTRS[m?.type];
        const a = fn?.((m.attrs ?? {}) as Record<string, unknown>);
        return a ? { type: m.type, ...(Object.keys(a).length ? { attrs: a } : {}) } : null;
      })
      .filter((m): m is NonNullable<typeof m> => !!m);
    if (marks.length) out.marks = marks;
    return out;
  }
  if (Array.isArray(n.content)) {
    const children = n.content
      .map((c) => sanitizeDoc(c, depth + 1))
      .filter((c): c is PMNode => !!c);
    if (children.length) out.content = children;
  }
  return out;
}

export function docText(node: PMNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? [])
    .map(docText)
    .join(node.type === 'paragraph' || node.type === 'heading' ? '\n' : ' ');
}

export function docStats(doc: PMNode) {
  const words = docText(doc).split(/\s+/).filter(Boolean).length;
  return { wordCount: words, readingMinutes: Math.max(1, Math.round(words / 200)) };
}

/* ───────────── AI output → document ───────────── */

const text = (t: string, marks?: PMNode['marks']): PMNode => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});

/**
 * Builds the editor document from validated notes output. Citation labels (S1…) become numbered
 * citation marks in order of first appearance; `cite` maps a label to its display number.
 */
export function notesToDoc(
  out: NotesOutput,
  cite: (label: string) => number | null,
  objectivesHeading = 'Learning objectives',
): PMNode {
  const withCitations = (body: string, labels: string[], provenance?: string): PMNode => {
    const content: PMNode[] = [];
    if (body.trim()) content.push(text(body.trim()));
    for (const label of labels) {
      const n = cite(label);
      if (n) content.push(text(`[${n}]`, [{ type: 'citation', attrs: { label, index: n } }]));
    }
    return {
      type: 'paragraph',
      ...(provenance ? { attrs: { provenance } } : {}),
      ...(content.length ? { content } : {}),
    };
  };
  const list = (ordered: boolean, items: string[], provenance: string): PMNode => ({
    type: ordered ? 'orderedList' : 'bulletList',
    attrs: { provenance },
    content: items
      .filter((i) => i.trim())
      .map((i) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [text(i.trim())] }],
      })),
  });

  const content: PMNode[] = [];
  if (out.learningObjectives.length) {
    content.push({
      type: 'heading',
      attrs: { level: 2, provenance: 'ai_supplementary' },
      content: [text(objectivesHeading)],
    });
    content.push(list(false, out.learningObjectives, 'ai_supplementary'));
  }
  for (const s of out.sections) {
    content.push({
      type: 'heading',
      attrs: { level: 2, provenance: s.provenance },
      content: [text(s.heading.trim() || 'Section')],
    });
    for (const b of s.blocks) {
      if (b.kind === 'paragraph') content.push(withCitations(b.text, b.citations, s.provenance));
      else if (b.kind === 'bullets' || b.kind === 'numbered') {
        if (b.text.trim()) content.push(withCitations(b.text, [], s.provenance));
        content.push(list(b.kind === 'numbered', b.items, s.provenance));
        if (b.citations.length) content.push(withCitations('', b.citations, s.provenance));
      } else if (b.kind === 'code' && b.text.trim()) {
        content.push({
          type: 'codeBlock',
          attrs: { language: b.language || null, provenance: 'ai_supplementary' },
          content: [text(b.text)],
        });
      } else if (b.kind === 'callout') {
        content.push({
          type: 'blockquote',
          attrs: { provenance: s.provenance },
          content: [withCitations(b.text, b.citations)],
        });
      } else if (b.kind === 'table' && b.rows.length) {
        const width = Math.max(...b.rows.map((r) => r.length));
        content.push({
          type: 'table',
          attrs: { provenance: s.provenance },
          content: b.rows.map((r, ri) => ({
            type: 'tableRow',
            content: Array.from({ length: width }, (_, ci) => ({
              type: ri === 0 ? 'tableHeader' : 'tableCell',
              content: [
                { type: 'paragraph', ...(r[ci]?.trim() ? { content: [text(r[ci]!.trim())] } : {}) },
              ],
            })),
          })),
        });
        if (b.text.trim() || b.citations.length)
          content.push(withCitations(b.text, b.citations, s.provenance));
      }
    }
  }
  if (out.glossary.length) {
    content.push({
      type: 'heading',
      attrs: { level: 2, provenance: 'source_grounded' },
      content: [text('Key terms')],
    });
    content.push({
      type: 'bulletList',
      content: out.glossary.map((g) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              text(g.term.trim(), [{ type: 'bold' }]),
              text(`: ${g.definition.trim()}`),
              ...g.citations.flatMap((l) => {
                const n = cite(l);
                return n
                  ? [text(` [${n}]`, [{ type: 'citation', attrs: { label: l, index: n } }])]
                  : [];
              }),
            ],
          },
        ],
      })),
    });
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
