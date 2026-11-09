import { Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import type { AppRequest } from '../common/http.js';
import { ApiOk, ZodBody } from '../common/zod.js';
import { AccountService, ACCEPTED_REGISTRATION, ACCEPTED_RESET } from './account.service.js';
import { Public } from './decorators.js';

const client = (req: AppRequest) => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});
const HOUR = 3600_000;

/** Public self-service account endpoints (docs/04 §3.1). Responses never reveal whether an email exists. */
@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  @Post('register')
  @ApiOk(V.AcceptedSchema, { status: 202 })
  async register(
    @ZodBody(V.RegisterStudentSchema) body: z.output<typeof V.RegisterStudentSchema>,
    @Req() req: AppRequest,
  ) {
    await this.accounts.register(body, client(req));
    return { accepted: true as const, message: ACCEPTED_REGISTRATION };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @Post('verify-email')
  @ApiOk(V.OkSchema)
  async verify(
    @ZodBody(V.TokenRequestSchema) body: z.output<typeof V.TokenRequestSchema>,
    @Req() req: AppRequest,
  ) {
    await this.accounts.verifyEmail(body.token, client(req));
    return { ok: true as const };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  @Post('verify-email/resend')
  @ApiOk(V.AcceptedSchema, { status: 202 })
  async resend(@ZodBody(V.ForgotPasswordSchema) body: z.output<typeof V.ForgotPasswordSchema>) {
    await this.accounts.resendVerification(body.email);
    return { accepted: true as const, message: ACCEPTED_REGISTRATION };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  @Post('password/forgot')
  @ApiOk(V.AcceptedSchema, { status: 202 })
  async forgot(@ZodBody(V.ForgotPasswordSchema) body: z.output<typeof V.ForgotPasswordSchema>) {
    await this.accounts.forgotPassword(body.email);
    return { accepted: true as const, message: ACCEPTED_RESET };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @Post('password/reset')
  @ApiOk(V.OkSchema)
  async reset(
    @ZodBody(V.ResetPasswordSchema) body: z.output<typeof V.ResetPasswordSchema>,
    @Req() req: AppRequest,
  ) {
    await this.accounts.resetPassword(body.token, body.password, client(req));
    return { ok: true as const };
  }
}
