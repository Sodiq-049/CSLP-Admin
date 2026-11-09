import { z } from 'zod';
import { USER_STATUSES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema, PageQuerySchema } from './common.js';
import { EmailSchema, RoleAssignmentSchema, RoleSchema } from './auth.js';
import { requestContract, responseContract } from './registry.js';

export const InviteAdminRequestSchema = requestContract(
  'InviteAdminRequest',
  z
    .object({
      email: EmailSchema,
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      role: RoleSchema,
      institutionId: ObjectIdSchema.optional(),
    })
    .refine((v) => (v.role === 'super_admin') === !v.institutionId, {
      message: 'super_admin is global; every other role needs an institutionId',
      path: ['institutionId'],
    }),
);
export type InviteAdminRequest = z.infer<typeof InviteAdminRequestSchema>;

export const AssignRoleRequestSchema = requestContract(
  'AssignRoleRequest',
  z
    .object({ role: RoleSchema, institutionId: ObjectIdSchema.optional() })
    .refine((v) => (v.role === 'super_admin') === !v.institutionId, {
      message: 'super_admin is global; every other role needs an institutionId',
      path: ['institutionId'],
    }),
);
export type AssignRoleRequest = z.infer<typeof AssignRoleRequestSchema>;

export const AdminUserListQuerySchema = PageQuerySchema.extend({
  institutionId: ObjectIdSchema.optional(),
  role: RoleSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export const AdminUserSchema = responseContract(
  'AdminUser',
  z.object({
    id: ObjectIdSchema,
    email: z.string(),
    status: z.enum(USER_STATUSES),
    firstName: z.string(),
    lastName: z.string(),
    mfaEnabled: z.boolean(),
    lastLoginAt: IsoDateSchema.nullable(),
    assignments: z.array(RoleAssignmentSchema),
    createdAt: IsoDateSchema,
  }),
);
export type AdminUser = z.infer<typeof AdminUserSchema>;
