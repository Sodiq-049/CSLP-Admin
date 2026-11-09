import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { authSessionSchema, hashPassword, MODELS, userSchema } from '@cslp/server-core';

/**
 * Break-glass recovery for an administrator account (run on the server, never exposed over HTTP):
 *   pnpm --filter @cslp/api reset-admin <email> [--reset-mfa] [--keep-password]
 * Sets a new random password, clears any lockout and signs out all sessions. With --reset-mfa the
 * authenticator is removed and must be set up again at the next sign-in.
 */
const [email, ...flags] = process.argv.slice(2);
if (!email) {
  console.error('Usage: reset-admin <email> [--reset-mfa] [--keep-password]');
  process.exit(1);
}
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set');
await mongoose.connect(uri);
const User = mongoose.model(MODELS.User, userSchema);
const Session = mongoose.model(MODELS.AuthSession, authSessionSchema);
const user = await User.findOne({ email: email.toLowerCase().trim() });
if (!user) {
  console.error(`No account found for ${email}`);
  process.exit(1);
}
// Readable but strong: 4 groups of random characters plus a digit and capital to meet the policy.
const raw = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
const password = `Cslp-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-7Q`;
const keepPassword = flags.includes('--keep-password');
const set: Record<string, unknown> = {
  status: 'active',
  'security.failedLoginCount': 0,
  'security.lockedUntil': null,
  ...(keepPassword
    ? {}
    : { passwordHash: await hashPassword(password), 'security.passwordChangedAt': new Date() }),
};
if (flags.includes('--reset-mfa')) {
  Object.assign(set, {
    'mfa.enabled': false,
    'mfa.totpSecretEnc': null,
    'mfa.pendingSecretEnc': null,
    'mfa.recoveryCodeHashes': [],
    'mfa.enrolledAt': null,
    'mfa.lastUsedStep': null,
  });
}
await User.updateOne({ _id: user._id }, { $set: set });
await Session.updateMany(
  { userId: user._id, revokedAt: null },
  { $set: { revokedAt: new Date(), revokeReason: 'admin_reset' } },
);
console.log(`Account:  ${user.email}`);
console.log(keepPassword ? 'Password: unchanged' : `Password: ${password}`);
console.log(
  flags.includes('--reset-mfa')
    ? 'Two-step verification was turned off for this account.'
    : 'Two-step verification unchanged: use your authenticator app code (or a recovery code).',
);
await mongoose.disconnect();
