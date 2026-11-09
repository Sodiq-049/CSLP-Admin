import { UPLOAD_LIMITS } from '@cslp/shared-types';

export type DocumentKind = 'pdf' | 'docx' | 'txt';

/**
 * Identify the file from its bytes, not its name or the browser-supplied MIME type (docs/06 §2).
 * Returns null for anything we don't accept.
 */
export function sniffDocument(buf: Buffer): { kind: DocumentKind; mimeType: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return { kind: 'pdf', mimeType: 'application/pdf' };
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // ZIP container: accept only Word documents (word/document.xml entry name in the central directory).
    if (buf.includes(Buffer.from('word/document.xml'))) {
      return {
        kind: 'docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    return null;
  }
  // ELF executables can be crafted without NUL bytes; reject the signature explicitly.
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '\x7fELF') return null;
  // Plain text: valid UTF-8, no NUL bytes, and (almost) no control characters in the first 64 KB.
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return null;
  let control = 0;
  for (const b of head) if (b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f) control++;
  if (control > Math.max(1, head.length * 0.01)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
  } catch {
    return null;
  }
  return { kind: 'txt', mimeType: 'text/plain' };
}

export const EXTENSION: Record<DocumentKind, string> = { pdf: 'pdf', docx: 'docx', txt: 'txt' };
export const MAX_UPLOAD_BYTES = UPLOAD_LIMITS.maxBytes;
