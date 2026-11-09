import type { TextBlock } from './extract-text.js';

export interface Chunk {
  ordinal: number;
  text: string;
  tokenCount: number;
  page: number | null;
  headingPath: string[];
  charStart: number;
  charEnd: number;
}

/** ≈4 characters per token for English prose: good enough for sizing, never billed on it. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Heading-aware chunking (docs/06 §2): chunks never cross a top-level section, target ~600 tokens,
 * with a small overlap so a sentence split across chunks is still retrievable.
 */
export function chunkBlocks(
  blocks: TextBlock[],
  opts: { targetChars?: number; overlapChars?: number } = {},
): Chunk[] {
  const target = opts.targetChars ?? 2400;
  const overlap = opts.overlapChars ?? 320;
  const chunks: Chunk[] = [];
  const path: string[] = [];
  let buf = '';
  let bufPage: number | null = null;
  let offset = 0;
  let bufStart = 0;

  const emit = (keepOverlap: boolean) => {
    const text = buf.trim();
    if (text.length >= 40) {
      chunks.push({
        ordinal: chunks.length,
        text,
        tokenCount: estimateTokens(text),
        page: bufPage,
        headingPath: [...path],
        charStart: bufStart,
        charEnd: bufStart + buf.length,
      });
    }
    const tail = keepOverlap ? buf.slice(-overlap).replace(/^\S*\s/, '') : '';
    bufStart = bufStart + buf.length - tail.length;
    buf = tail;
    bufPage = null;
  };

  for (const b of blocks) {
    if (b.headingLevel) {
      emit(false);
      path.length = Math.min(path.length, b.headingLevel - 1);
      path[b.headingLevel - 1] = b.text;
      path.length = b.headingLevel;
      offset += b.text.length + 1;
      bufStart = offset;
      continue;
    }
    // Very long paragraphs are split on sentence boundaries.
    const pieces =
      b.text.length > target
        ? (b.text.match(new RegExp(`[^.!?]{1,${target}}[.!?]*\\s*`, 'g')) ?? [b.text])
        : [b.text];
    for (const piece of pieces) {
      if (buf.length + piece.length > target && buf.length > 0) emit(true);
      if (bufPage === null) bufPage = b.page;
      buf += (buf ? '\n' : '') + piece;
    }
    offset += b.text.length + 1;
  }
  emit(false);
  return chunks;
}
