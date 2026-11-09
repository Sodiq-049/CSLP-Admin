import { z } from 'zod';
import { PERMISSIONS, ROLES, ACCOUNT_TYPES, USER_STATUSES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

/** Admin password policy (docs/03 §6): 12+ chars, not all one class. */
export const AdminPasswordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), {
    message: 'Must contain upper-case, lower-case and a digit',
  });

export const LoginRequestSchema = requestContract(
  'LoginRequest',
  z.object({ email: EmailSchema, password: z.string().min(1).max(128) }),
);
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = responseContract(
  'LoginResponse',
  z.discriminatedUnion('status', [
    z.object({
      status: z.literal('authenticated'),
      /** Only returned when the client asks for token mode (mobile: header `X-Auth-Mode: token`). */
      tokens: z
        .object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number().int() })
        .optional(),
    }),
    z.object({ status: z.literal('mfa_required'), mfaToken: z.string() }),
    z.object({ status: z.literal('mfa_enrolment_required'), mfaToken: z.string() }),
  ]),
);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const MfaVerifyRequestSchema = requestContract(
  'MfaVerifyRequest',
  z.object({
    mfaToken: z.string().min(10),
    code: z.string().trim().min(6).max(20),
  }),
);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaEnrolRequestSchema = requestContract(
  'MfaEnrolRequest',
  z.object({ mfaToken: z.string().min(10).optional() }),
);
export const MfaEnrolResponseSchema = responseContract(
  'MfaEnrolResponse',
  z.object({ otpauthUrl: z.string(), secret: z.string() }),
);
export const MfaConfirmRequestSchema = requestContract(
  'MfaConfirmRequest',
  z.object({ mfaToken: z.string().min(10).optional(), code: z.string().trim().length(6) }),
);
export const MfaConfirmResponseSchema = responseContract(
  'MfaConfirmResponse',
  z.object({ recoveryCodes: z.array(z.string()) }),
);

export const RefreshRequestSchema = requestContract(
  'RefreshRequest',
  z.object({ refreshToken: z.string().optional() }),
);

export const AcceptInvitationRequestSchema = requestContract(
  'AcceptInvitationRequest',
  z.object({
    password: AdminPasswordSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
  }),
);
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const ChangePasswordRequestSchema = requestContract(
  'ChangePasswordRequest',
  z.object({ currentPassword: z.string().min(1), newPassword: AdminPasswordSchema }),
);

export const RoleSchema = z.enum(ROLES);
export const PermissionSchema = z.enum(PERMISSIONS);

export const RoleAssignmentSchema = responseContract(
  'RoleAssignment',
  z.object({
    id: ObjectIdSchema,
    role: RoleSchema,
    institutionId: ObjectIdSchema.nullable(),
    institutionName: z.string().nullable(),
    departmentIds: z.array(ObjectIdSchema),
  }),
);
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

export const MeResponseSchema = responseContract(
  'MeResponse',
  z.object({
    id: ObjectIdSchema,
    email: z.string(),
    accountType: z.enum(ACCOUNT_TYPES),
    status: z.enum(USER_STATUSES),
    firstName: z.string(),
    lastName: z.string(),
    mfaEnabled: z.boolean(),
    assignments: z.array(RoleAssignmentSchema),
    /** Effective permissions: `global` for super-admin grants, otherwise keyed by institution id. */
    permissions: z.object({
      global: z.array(PermissionSchema),
      byInstitution: z.record(z.string(), z.array(PermissionSchema)),
    }),
  }),
);
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const SessionSchema = responseContract(
  'Session',
  z.object({
    id: ObjectIdSchema,
    current: z.boolean(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: IsoDateSchema,
    lastUsedAt: IsoDateSchema,
  }),
);
export type Session = z.infer<typeof SessionSchema>;

export const ReauthenticateRequestSchema = requestContract(
  'ReauthenticateRequest',
  z.object({
    password: z.string().min(1).max(128),
    code: z.string().trim().min(6).max(20).optional(),
  }),
);
