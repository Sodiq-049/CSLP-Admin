import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import type { DocumentKind } from './file-type.js';

export interface TextBlock {
  text: string;
  page: number | null;
  /** 1–3 when the block looks like a heading, else null. */
  headingLevel: number | null;
}
export interface ExtractedDocument {
  blocks: TextBlock[];
  pageCount: number | null;
  warnings: string[];
}

const NUMBERED_HEADING =
  /^(?:(?:week|unit|module|topic|chapter|section|lecture)\s+\d+[a-z]?[:.)-]?\s+|\d+(?:\.\d+)*[.)]?\s+|[IVXLC]+[.)]\s+)\S/i;

function normalise(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Guess heading level for a plain line (PDF/TXT have no structural markup). */
export function guessHeadingLevel(line: string): number | null {
  const t = line.trim();
  if (!t || t.length > 120 || /[.;,]$/.test(t)) return null;
  if (/^#{1,3}\s/.test(t)) return t.match(/^#+/)![0].length;
  if (/^\d+\.\d+\.\d+\s/.test(t)) return 3;
  if (/^\d+\.\d+[.)]?\s/.test(t)) return 2;
  if (NUMBERED_HEADING.test(t)) return 1;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 10)
    return 1;
  return null;
}

function linesToBlocks(text: string, page: number | null): TextBlock[] {
  const blocks: TextBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ text: normalise(para.join(' ')), page, headingLevel: null });
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = normalise(raw);
    if (!line) {
      flush();
      continue;
    }
    const level = guessHeadingLevel(line);
    if (level || /^[-•*▪◦]\s+/.test(line) || /^\(?[a-z]\)\s+/i.test(line)) {
      flush();
      blocks.push({ text: line.replace(/^#+\s+/, ''), page, headingLevel: level });
    } else para.push(line);
  }
  flush();
  return blocks;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};
const decode = (s: string) =>
  s
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? _)
    .replace(/<[^>]+>/g, '');

async function extractDocx(buf: Buffer): Promise<ExtractedDocument> {
  const { value: html, messages } = await mammoth.convertToHtml({ buffer: buf });
  const blocks: TextBlock[] = [];
  for (const m of html.matchAll(/<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/g)) {
    const tag = m[1]!;
    const text = normalise(decode(m[2]!));
    if (!text) continue;
    const headingLevel = tag.startsWith('h')
      ? Math.min(3, Number(tag[1]))
      : tag === 'p'
        ? guessHeadingLevel(text)
        : null;
    blocks.push({ text, page: null, headingLevel });
  }
  const warnings = messages
    .filter((x) => x.type === 'warning')
    .slice(0, 5)
    .map((x) => x.message);
  return { blocks, pageCount: null, warnings };
}

async function extractPdf(buf: Buffer): Promise<ExtractedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractPdfText(pdf, { mergePages: false });
  const pages = text as string[];
  const blocks = pages.flatMap((t, i) => linesToBlocks(t, i + 1));
  const chars = pages.reduce((n, t) => n + t.trim().length, 0);
  const warnings: string[] = [];
  if (chars < 50 * totalPages)
    warnings.push('Very little text was found. The PDF may be scanned images; OCR is not enabled.');
  return { blocks, pageCount: totalPages, warnings };
}

export async function extractDocument(buf: Buffer, kind: DocumentKind): Promise<ExtractedDocument> {
  if (kind === 'pdf') return extractPdf(buf);
  if (kind === 'docx') return extractDocx(buf);
  return { blocks: linesToBlocks(buf.toString('utf8'), null), pageCount: null, warnings: [] };
}

export function blocksToText(blocks: TextBlock[]): string {
  return blocks
    .map((b) => (b.headingLevel ? `\n${'#'.repeat(b.headingLevel)} ${b.text}` : b.text))
    .join('\n')
    .trim();
}
