import { Document, HeadingLevel, Packer, Paragraph } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Fictional sample outline used only in tests. Not an official course record. */
export const SAMPLE_OUTLINE = `COURSE TITLE: Introduction to Computing (Sample)
Course Code: CSC 101
Credit Units: 3

GENERAL OBJECTIVES
1. Understand the basic components of a computer system
2. Appreciate the history and generations of computers

COURSE CONTENT
Week 1: Introduction to Computer Science
1.1 Definition of computer science
1.2 Areas of computer science
Week 2: History of Computers
Week 3: Computer Generations
3.1 First generation
3.2 Second generation
Week 4: Computer Hardware
Week 5: Computer Software

ASSESSMENT
Continuous assessment 40%, examination 60%

REFERENCES
- Smith, A. (2020) Computing Basics.
`;

export async function makePdf(lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  for (const line of lines) {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(line, { x: 50, y, size: 11, font });
    y -= 16;
  }
  return Buffer.from(await pdf.save());
}

export async function makeDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Data Structures (Sample)', heading: HeadingLevel.TITLE }),
          new Paragraph({ text: 'Course Content', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: '1. Arrays and Lists' }),
          new Paragraph({ text: '1.1 Static arrays' }),
          new Paragraph({ text: '2. Stacks and Queues' }),
          new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: 'Some book, 2019.' }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
