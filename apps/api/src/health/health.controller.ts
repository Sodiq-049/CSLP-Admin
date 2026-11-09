import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Connection } from 'mongoose';
import { z } from 'zod';
import { responseContract } from '@cslp/validation';
import { ApiOk } from '../common/zod.js';
import { Public } from '../auth/decorators.js';

const HealthSchema = responseContract(
  'Health',
  z.object({
    status: z.enum(['ok', 'degraded']),
    checks: z.object({ mongo: z.enum(['up', 'down']) }),
  }),
);

@ApiTags('public')
@Controller('public/health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOk(HealthSchema)
  check() {
    const mongo = this.connection.readyState === 1 ? 'up' : 'down';
    return { status: mongo === 'up' ? 'ok' : 'degraded', checks: { mongo } } as const;
  }
}
