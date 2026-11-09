import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { z } from 'zod';
import { ROLE_LABELS, type Role } from '@cslp/shared-types';
import type {
  AdminUser,
  AdminUserListQuerySchema,
  AssignRoleRequest,
  InviteAdminRequest,
} from '@cslp/validation';
import {
  AppError,
  AuditLogService,
  MODELS,
  type Actor,
  type InstitutionDoc,
  type InvitationDoc,
  type RoleAssignmentDoc,
  type UserDoc,
} from '@cslp/server-core';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import type { AuthContext } from '../auth/auth.types.js';
import { randomToken, sha256 } from '../auth/crypto.js';
import { SessionService } from '../auth/session.service.js';
import { MAILER, type Mailer } from '../mail/mail.module.js';

const INVITE_TTL_MS = 72 * 3600 * 1000;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
    @InjectModel(MODELS.RoleAssignment) private readonly assignments: Model<RoleAssignmentDoc>,
    @InjectModel(MODELS.Invitation) private readonly invitations: Model<InvitationDoc>,
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /* ───────────── authorisation rules (docs/03 §3, §5) ───────────── */

  /** May `auth` grant or revoke `role` at `institutionId`? */
  private assertCanManageRole(auth: AuthContext, role: Role, institutionId: string | null): void {
    if (role === 'super_admin' || role === 'institution_admin') {
      if (!auth.permissions.can('role.assign.any'))
        throw AppError.forbidden('Only a Super Administrator can manage this role');
      return;
    }
    if (auth.permissions.can('role.assign.any')) return;
    if (!institutionId || !auth.permissions.can('role.assign.institution_staff', institutionId)) {
      throw AppError.forbidden('You cannot manage roles for this institution');
    }
  }

  private async assertInstitutionActive(institutionId: string | null) {
    if (!institutionId) return;
    const ok = await this.institutions.exists({ _id: oid(institutionId), archivedAt: null });
    if (!ok)
      throw new AppError('VALIDATION_FAILED', 'Institution not found', [
        { path: 'institutionId', issue: 'not_found' },
      ]);
  }

  private async assertNotLastSuperAdmin(userId: string) {
    const supers = await this.assignments
      .find({ role: 'super_admin', revokedAt: null }, { userId: 1 })
      .lean();
    const activeSuperIds = new Set(supers.map((s) => String(s.userId)));
    if (!activeSuperIds.has(userId)) return;
    const activeUsers = await this.users.countDocuments({
      _id: { $in: [...activeSuperIds].map(oid) },
      status: 'active',
    });
    if (activeUsers <= 1)
      throw AppError.conflict('The last active Super Administrator cannot be removed or suspended');
  }

  /* ───────────── queries ───────────── */

  async list(auth: AuthContext, q: z.output<typeof AdminUserListQuerySchema>) {
    const scope = auth.permissions.scopeFor('admin_user.update');
    const af: Record<string, unknown> = { revokedAt: null };
    if (scope.kind === 'institutions') af.institutionId = { $in: scope.institutionIds.map(oid) };
    if (q.institutionId) {
      if (scope.kind === 'institutions' && !scope.institutionIds.includes(q.institutionId))
        throw AppError.notFound('Institution');
      af.institutionId = oid(q.institutionId);
    }
    if (q.role) af.role = q.role;
    const userIds = await this.assignments.distinct('userId', af);

    const uf: Record<string, unknown> = { _id: { $in: userIds }, accountType: 'admin' };
    if (q.status) uf.status = q.status;
    if (q.q) {
      const rx = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      uf.$or = [{ email: rx }, { 'profile.firstName': rx }, { 'profile.lastName': rx }];
    }
    const [docs, total] = await Promise.all([
      this.users
        .find(uf)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<UserDoc[]>(),
      this.users.countDocuments(uf),
    ]);
    return {
      items: await this.toDtos(docs, scope.kind === 'all' ? null : scope.institutionIds),
      total,
    };
  }

  async get(auth: AuthContext, userId: string): Promise<AdminUser> {
    const user = await this.loadVisibleUser(auth, userId);
    const scope = auth.permissions.scopeFor('admin_user.update');
    return (await this.toDtos([user], scope.kind === 'all' ? null : scope.institutionIds))[0]!;
  }

  /** A user is visible if they hold an active assignment inside the caller's scope. */
  private async loadVisibleUser(auth: AuthContext, userId: string): Promise<UserDoc> {
    const user = await this.users
      .findOne({ _id: oid(userId), accountType: 'admin' })
      .lean<UserDoc>();
    if (!user) throw AppError.notFound('User');
    const scope = auth.permissions.scopeFor('admin_user.update');
    if (scope.kind === 'all') return user;
    const visible = await this.assignments.exists({
      userId: user._id,
      revokedAt: null,
      institutionId: { $in: scope.institutionIds.map(oid) },
    });
    if (!visible) throw AppError.notFound('User');
    return user;
  }

  /** Institution admins only see assignments within their own institutions. */
  private async toDtos(
    users: UserDoc[],
    visibleInstitutions: readonly string[] | null,
  ): Promise<AdminUser[]> {
    const all = await this.assignments
      .find({ userId: { $in: users.map((u) => u._id) }, revokedAt: null })
      .lean<RoleAssignmentDoc[]>();
    const visible = visibleInstitutions
      ? all.filter((a) => a.institutionId && visibleInstitutions.includes(String(a.institutionId)))
      : all;
    const instIds = [
      ...new Set(
        visible
          .map((a) => a.institutionId)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const insts = await this.institutions
      .find({ _id: { $in: instIds.map(oid) } }, { name: 1 })
      .lean<InstitutionDoc[]>();
    const names = new Map(insts.map((i) => [String(i._id), i.name]));
    return users.map((u) => ({
      id: String(u._id),
      email: u.email,
      status: u.status,
      firstName: u.profile.firstName,
      lastName: u.profile.lastName,
      mfaEnabled: u.mfa.enabled,
      lastLoginAt: u.security.lastLoginAt ? u.security.lastLoginAt.toISOString() : null,
      createdAt: (u as UserDoc).createdAt.toISOString(),
      assignments: visible
        .filter((a) => String(a.userId) === String(u._id))
        .map((a) => ({
          id: String(a._id),
          role: a.role,
          institutionId: a.institutionId ? String(a.institutionId) : null,
          institutionName: a.institutionId ? (names.get(String(a.institutionId)) ?? null) : null,
          departmentIds: a.departmentIds.map(String),
        })),
    }));
  }

  /* ───────────── commands ───────────── */

  async invite(auth: AuthContext, actor: Actor, input: InviteAdminRequest): Promise<AdminUser> {
    const institutionId = input.institutionId ?? null;
    this.assertCanManageRole(auth, input.role, institutionId);
    await this.assertInstitutionActive(institutionId);

    let user = await this.users.findOne({ email: input.email }).lean<UserDoc>();
    if (user && user.accountType !== 'admin') {
      throw AppError.conflict('This email belongs to a student account', [
        { path: 'email', issue: 'student_account' },
      ]);
    }
    if (!user) {
      user = (
        await this.users.create({
          email: input.email,
          accountType: 'admin',
          status: 'invited',
          profile: { firstName: input.firstName ?? '', lastName: input.lastName ?? '' },
        })
      ).toObject() as UserDoc;
    }
    await this.grant(actor, String(user._id), input.role, institutionId);

    if (user.status === 'invited') {
      const token = randomToken();
      await this.invitations.create({
        email: user.email,
        tokenHash: sha256(token),
        userId: user._id,
        role: input.role,
        institutionId: institutionId ? oid(institutionId) : null,
        invitedBy: oid(auth.userId),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      });
      const url = `${this.config.ADMIN_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
      await this.mailer.send({
        to: user.email,
        subject: 'You have been invited to the CSLP Admin Portal',
        text: `You have been invited as ${ROLE_LABELS[input.role]}.\n\nAccept your invitation (valid for 72 hours):\n${url}\n`,
      });
    }
    await this.audit.record({
      actor,
      action: 'admin_user.invite',
      target: { type: 'user', id: user._id },
      institutionId,
      after: { email: user.email, role: input.role },
    });
    return this.get(auth, String(user._id));
  }

  private async grant(actor: Actor, userId: string, role: Role, institutionId: string | null) {
    try {
      await this.assignments.create({
        userId: oid(userId),
        role,
        institutionId: institutionId ? oid(institutionId) : null,
        grantedBy: actor.userId ? oid(actor.userId) : null,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000)
        throw AppError.conflict('User already holds this role');
      throw err;
    }
    await this.audit.record({
      actor,
      action: 'role.grant',
      target: { type: 'user', id: userId },
      institutionId,
      after: { role, institutionId },
    });
  }

  async assignRole(
    auth: AuthContext,
    actor: Actor,
    userId: string,
    input: AssignRoleRequest,
  ): Promise<AdminUser> {
    const institutionId = input.institutionId ?? null;
    this.assertCanManageRole(auth, input.role, institutionId);
    await this.assertInstitutionActive(institutionId);
    const user = await this.users
      .findOne({ _id: oid(userId), accountType: 'admin' })
      .lean<UserDoc>();
    if (!user) throw AppError.notFound('User');
    await this.grant(actor, userId, input.role, institutionId);
    return this.get(auth, userId);
  }

  async revokeRole(
    auth: AuthContext,
    actor: Actor,
    userId: string,
    assignmentId: string,
  ): Promise<void> {
    const a = await this.assignments
      .findOne({ _id: oid(assignmentId), userId: oid(userId), revokedAt: null })
      .lean<RoleAssignmentDoc>();
    if (!a) throw AppError.notFound('Role assignment');
    this.assertCanManageRole(auth, a.role, a.institutionId ? String(a.institutionId) : null);
    if (a.role === 'super_admin') await this.assertNotLastSuperAdmin(userId);
    await this.assignments.updateOne(
      { _id: a._id },
      { $set: { revokedAt: new Date(), revokedBy: oid(auth.userId) } },
    );
    await this.audit.record({
      actor,
      action: 'role.revoke',
      target: { type: 'user', id: userId },
      institutionId: a.institutionId,
      before: { role: a.role, institutionId: a.institutionId },
    });
    const remaining = await this.assignments.countDocuments({
      userId: oid(userId),
      revokedAt: null,
    });
    if (remaining === 0) await this.sessions.revokeAllForUser(userId, 'all_roles_revoked');
  }

  async setSuspended(
    auth: AuthContext,
    actor: Actor,
    userId: string,
    suspended: boolean,
  ): Promise<AdminUser> {
    if (userId === auth.userId)
      throw AppError.conflict('You cannot change your own account status');
    const user = await this.loadVisibleUser(auth, userId);
    const held = await this.assignments
      .find({ userId: user._id, revokedAt: null })
      .lean<RoleAssignmentDoc[]>();
    // Must be allowed to manage every role the target holds (no suspending your superiors).
    for (const a of held)
      this.assertCanManageRole(auth, a.role, a.institutionId ? String(a.institutionId) : null);
    if (suspended) {
      if (user.status === 'invited') throw AppError.conflict('Revoke the invitation instead');
      await this.assertNotLastSuperAdmin(userId);
      await this.users.updateOne({ _id: user._id }, { $set: { status: 'suspended' } });
      await this.sessions.revokeAllForUser(userId, 'suspended');
    } else {
      if (user.status !== 'suspended') throw AppError.conflict('User is not suspended');
      await this.users.updateOne({ _id: user._id }, { $set: { status: 'active' } });
    }
    await this.audit.record({
      actor,
      action: suspended ? 'admin_user.suspend' : 'admin_user.reactivate',
      target: { type: 'user', id: userId },
    });
    return this.get(auth, userId);
  }
}
