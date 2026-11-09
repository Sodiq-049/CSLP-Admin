import { describe, expect, it } from 'vitest';
import { chunkBlocks } from '../src/ingest/chunker.js';
import { blocksToText, extractDocument } from '../src/ingest/extract-text.js';
import { sniffDocument } from '../src/ingest/file-type.js';
import { suggestOutline } from '../src/ingest/outline-heuristics.js';
import { makeDocx, makePdf, SAMPLE_OUTLINE } from './fixtures/make.js';

describe('sniffDocument', () => {
  it('identifies files by content, not name', async () => {
    expect(sniffDocument(await makePdf(['hello']))?.kind).toBe('pdf');
    expect(sniffDocument(await makeDocx())?.kind).toBe('docx');
    expect(sniffDocument(Buffer.from('plain text'))?.kind).toBe('txt');
  });
  it('rejects binaries and non-Word zips', () => {
    expect(sniffDocument(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]))).toBeNull(); // ELF
    expect(
      sniffDocument(
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')]),
      ),
    ).toBeNull();
    expect(sniffDocument(Buffer.from([0xff, 0xfe, 0xfd]))).toBeNull(); // invalid UTF-8
    expect(sniffDocument(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]))).toBeNull(); // ELF without NULs
    expect(sniffDocument(Buffer.from('ab\x01\x02\x03\x04cd'))).toBeNull(); // control characters
  });
  it('accepts ordinary and tiny text files', () => {
    expect(sniffDocument(Buffer.from('x'))?.kind).toBe('txt');
    expect(sniffDocument(Buffer.from('Notes\twith tabs\r\nand CRLF'))?.kind).toBe('txt');
    expect(sniffDocument(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]))).toBeNull(); // ELF without NULs
    expect(sniffDocument(Buffer.from('ab\x01\x02\x03\x04cd'))).toBeNull(); // control characters
    expect(sniffDocument(Buffer.from('x'))?.kind).toBe('txt'); // tiny files are fine
    expect(sniffDocument(Buffer.from('Notes\twith tabs\r\nand CRLF'))?.kind).toBe('txt');
  });
});

describe('extractDocument', () => {
  it('extracts PDF text per page', async () => {
    const pdf = await makePdf(SAMPLE_OUTLINE.split('\n'));
    const r = await extractDocument(pdf, 'pdf');
    expect(r.pageCount).toBe(1);
    expect(blocksToText(r.blocks)).toContain('History of Computers');
  });
  it('keeps DOCX heading structure', async () => {
    const r = await extractDocument(await makeDocx(), 'docx');
    expect(r.blocks.find((b) => b.text === 'Course Content')?.headingLevel).toBe(1);
    expect(r.blocks.some((b) => b.text === '1. Arrays and Lists')).toBe(true);
  });
});

describe('chunkBlocks', () => {
  it('splits long sections with overlap and keeps heading paths', () => {
    const para = 'Computers process data using instructions stored in memory. '.repeat(30);
    const chunks = chunkBlocks([
      { text: 'Hardware', page: 1, headingLevel: 1 },
      { text: para, page: 1, headingLevel: null },
      { text: para, page: 2, headingLevel: null },
      { text: 'Software', page: 3, headingLevel: 1 },
      {
        text: 'Programs are sets of instructions written by programmers.',
        page: 3,
        headingLevel: null,
      },
    ]);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.every((c) => c.text.length <= 2400 + 400)).toBe(true);
    expect(chunks[0]!.headingPath).toEqual(['Hardware']);
    expect(chunks.at(-1)!.headingPath).toEqual(['Software']);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
});

describe('suggestOutline (heuristic)', () => {
  const blocks = () => extractDocument(Buffer.from(SAMPLE_OUTLINE), 'txt').then((r) => r.blocks);

  it('finds weekly topics and numbered subtopics, in order', async () => {
    const s = suggestOutline(await blocks(), SAMPLE_OUTLINE);
    expect(s.nodes.map((n) => n.title)).toEqual([
      'Introduction to Computer Science',
      'History of Computers',
      'Computer Generations',
      'Computer Hardware',
      'Computer Software',
    ]);
    expect(s.nodes[0]!.children.map((c) => c.title)).toEqual([
      'Definition of computer science',
      'Areas of computer science',
    ]);
    expect(s.nodes[0]!.confidence).toBe('high');
    expect(s.nodes[0]!.sourceQuote).toBe('Week 1: Introduction to Computer Science');
  });

  it('separates objectives and skips assessment/references instead of treating them as topics', async () => {
    const s = suggestOutline(await blocks(), SAMPLE_OUTLINE);
    expect(s.detectedMetadata.objectives).toHaveLength(2);
    const titles = s.nodes.flatMap((n) => [n.title, ...n.children.map((c) => c.title)]).join(' ');
    expect(titles).not.toMatch(/assessment|smith|understand the basic/i);
    expect(s.warnings.some((w) => /ASSESSMENT/i.test(w))).toBe(true);
  });

  it('reports metadata without changing it', async () => {
    const s = suggestOutline(await blocks(), SAMPLE_OUTLINE);
    expect(s.detectedMetadata).toMatchObject({
      courseCode: 'CSC 101',
      courseTitle: 'Introduction to Computing (Sample)',
      creditUnits: 3,
    });
  });

  it('warns when nothing can be identified', () => {
    const s = suggestOutline(
      [
        {
          text: 'Just a paragraph of prose with no structure at all.',
          page: null,
          headingLevel: null,
        },
      ],
      '',
    );
    expect(s.nodes).toEqual([]);
    expect(s.warnings[0]).toMatch(/No topics/);
  });
});

describe('detectMetadata', () => {
  it('stops the title at the next label when PDF lines were merged into one paragraph', async () => {
    const { detectMetadata } = await import('../src/ingest/outline-heuristics.js');
    const m = detectMetadata(
      'COURSE TITLE: Introduction to Computing (Sample) Course Code: CSC 101 Credit Units: 3',
    );
    expect(m).toMatchObject({
      courseTitle: 'Introduction to Computing (Sample)',
      courseCode: 'CSC 101',
      creditUnits: 3,
    });
  });
});
