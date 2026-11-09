import { applyDecorators, Body, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  AppError,
  MAX_UPLOAD_BYTES,
  type UploadedFile as CoreUploadedFile,
} from '@cslp/server-core';
import { ZodValidationPipe } from './zod.js';

/**
 * multipart/form-data endpoint with a single `file` part plus Zod-validated text fields.
 * Files are held in memory (≤ 50 MB) and validated by content in the domain layer.
 */
export function UploadEndpoint(fields: z.ZodObject) {
  const json = z.toJSONSchema(fields, { io: 'input', target: 'openapi-3.0' }) as {
    properties?: object;
    required?: string[];
  };
  return applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        storage: memoryStorage(),
        limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 20 },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file', ...(json.required ?? [])],
        properties: { file: { type: 'string', format: 'binary' }, ...(json.properties ?? {}) },
      } as never,
    }),
  );
}

export const UploadFields = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));

export const UploadedDocument = () =>
  UploadedFile({
    transform: (f: Express.Multer.File | undefined): CoreUploadedFile => {
      if (!f)
        throw new AppError('VALIDATION_FAILED', 'A file is required', [
          { path: 'file', issue: 'required' },
        ]);
      return {
        buffer: f.buffer,
        originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      };
    },
  });
