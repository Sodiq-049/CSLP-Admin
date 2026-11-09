import { z } from 'zod';

/** Plain-language validation messages for admin forms (Zod's defaults are developer-facing). */
z.config({
  customError: (iss) => {
    if (
      iss.code === 'invalid_type' &&
      (iss.input === undefined || iss.input === null || iss.input === '')
    )
      return 'Required';
    if (iss.code === 'too_small' && iss.origin === 'string')
      return Number(iss.minimum) <= 1 || iss.input === ''
        ? 'Required'
        : `Must be at least ${iss.minimum} characters`;
    if (iss.code === 'too_big' && iss.origin === 'string')
      return `Must be at most ${iss.maximum} characters`;
    if (iss.code === 'too_small' && iss.origin === 'number')
      return `Must be ${iss.minimum} or more`;
    if (iss.code === 'too_big' && iss.origin === 'number') return `Must be ${iss.maximum} or less`;
    if (iss.code === 'invalid_format' && iss.format === 'email')
      return 'Enter a valid email address';
    if (iss.code === 'invalid_value') return 'Choose one of the options';
    return undefined;
  },
});
