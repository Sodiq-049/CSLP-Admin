import { Schema, Types } from 'mongoose';
import {
  ACCOUNT_TYPES,
  ROLES,
  USER_STATUSES,
  type AccountType,
  type Role,
  type UserStatus,
} from '@cslp/shared-types';
import { baseSchemaOptions } from '../database/schema-options.js';

/* ───────── users ───────── */
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string | null;
  accountType: AccountType;
  status: UserStatus;
  profile: { firstName: string; lastName: string };
  /** Required before a student may sign in; admins are verified by accepting an invitation. */
  emailVerifiedAt: Date | null;
  studentProfile: {
    institutionId: Types.ObjectId;
    programmeId: Types.ObjectId | null;
    levelId: Types.ObjectId | null;
  } | null;
  mfa: {
    enabled: boolean;
    totpSecretEnc: string | null;
    pendingSecretEnc: string | null;
    recoveryCodeHashes: string[];
    enrolledAt: Date | null;
    lastUsedStep: number | null;
  };
  security: {
    failedLoginCount: number;
    lockedUntil: Date | null;
    passwordChangedAt: Date | null;
    lastLoginAt: Date | null;
    lastLoginIp: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}

export const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null, select: false },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true },
    profile: {
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
    },
    emailVerifiedAt: { type: Date, default: null },
    studentProfile: {
      type: new Schema(
        {
          institutionId: { type: Schema.Types.ObjectId, required: true },
          programmeId: { type: Schema.Types.ObjectId, default: null },
          levelId: { type: Schema.Types.ObjectId, default: null },
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    mfa: {
      enabled: { type: Boolean, default: false },
      totpSecretEnc: { type: String, default: null, select: false },
      pendingSecretEnc: { type: String, default: null, select: false },
      recoveryCodeHashes: { type: [String], default: [], select: false },
      enrolledAt: { type: Date, default: null },
      lastUsedStep: { type: Number, default: null, select: false },
    },
    security: {
      failedLoginCount: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
      passwordChangedAt: { type: Date, default: null },
      lastLoginAt: { type: Date, default: null },
      lastLoginIp: { type: String, default: null },
    },
  },
  baseSchemaOptions,
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ accountType: 1, status: 1 });
userSchema.index({ 'studentProfile.institutionId': 1, createdAt: -1 }, { sparse: true });

/* ───────── verificationTokens (email verification, password reset) ───────── */
export const TOKEN_PURPOSES = ['verify_email', 'reset_password'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];
export interface VerificationTokenDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: TokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}
export const verificationTokenSchema = new Schema<VerificationTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
verificationTokenSchema.index({ tokenHash: 1 }, { unique: true });
verificationTokenSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });

/* ───────── roleAssignments ───────── */
export interface RoleAssignmentDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  role: Role;
  institutionId: Types.ObjectId | null;
  departmentIds: Types.ObjectId[];
  grantedBy: Types.ObjectId | null;
  grantedAt: Date;
  revokedAt: Date | null;
  revokedBy: Types.ObjectId | null;
}

export const roleAssignmentSchema = new Schema<RoleAssignmentDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', default: null },
    departmentIds: { type: [Schema.Types.ObjectId], default: [] },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    grantedAt: { type: Date, default: () => new Date() },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
roleAssignmentSchema.index(
  { userId: 1, role: 1, institutionId: 1 },
  { unique: true, partialFilterExpression: { revokedAt: null } },
);
roleAssignmentSchema.index({ institutionId: 1, role: 1 });
roleAssignmentSchema.pre('validate', function () {
  const isSuper = this.role === 'super_admin';
  if (isSuper && this.institutionId) throw new Error('super_admin assignments are global');
  if (!isSuper && !this.institutionId) throw new Error(`${this.role} requires an institution`);
});

/* ───────── authSessions (one per refresh-token family) ───────── */
export interface AuthSessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  familyId: string;
  currentTokenHash: string;
  previousTokenHashes: string[];
  audience: AccountType;
  mfaSatisfiedAt: Date | null;
  authTime: Date;
  ip: string | null;
  userAgent: string | null;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
}

export const authSessionSchema = new Schema<AuthSessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    currentTokenHash: { type: String, required: true },
    previousTokenHashes: { type: [String], default: [] },
    audience: { type: String, enum: ACCOUNT_TYPES, required: true },
    mfaSatisfiedAt: { type: Date, default: null },
    authTime: { type: Date, required: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    lastUsedAt: { type: Date, required: true },
    idleExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null },
  },
  baseSchemaOptions,
);
authSessionSchema.index({ userId: 1, revokedAt: 1 });
authSessionSchema.index({ currentTokenHash: 1 }, { unique: true });
authSessionSchema.index({ previousTokenHashes: 1 });
authSessionSchema.index({ familyId: 1 }, { unique: true });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/* ───────── invitations ───────── */
export interface InvitationDoc {
  _id: Types.ObjectId;
  email: string;
  tokenHash: string;
  userId: Types.ObjectId;
  role: Role;
  institutionId: Types.ObjectId | null;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  consumedAt: Date | null;
}

export const invitationSchema = new Schema<InvitationDoc>(
  {
    email: { type: String, required: true, lowercase: true },
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    institutionId: { type: Schema.Types.ObjectId, default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
