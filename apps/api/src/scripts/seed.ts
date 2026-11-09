import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import {
  academicLevelSchema,
  hashPassword,
  institutionSchema,
  roleAssignmentSchema,
  semesterSchema,
  userSchema,
  MODELS,
} from '@cslp/server-core';
import { AdminPasswordSchema, EmailSchema } from '@cslp/validation';

/**
 * Idempotent seed (docs/08 Phase 1.11):
 *  - a Super Administrator from env
 *  - the YABATECH institution shell with First/Second semesters
 * It deliberately creates NO faculties, departments, programmes or courses: official structure
 * must be entered by an administrator, never invented (brief §7, §26).
 */
const env = z
  .object({
    MONGODB_URI: z.string().min(1),
    SEED_SUPER_ADMIN_EMAIL: EmailSchema,
    SEED_SUPER_ADMIN_PASSWORD: AdminPasswordSchema,
  })
  .parse(process.env);

await mongoose.connect(env.MONGODB_URI);
const User = mongoose.model(MODELS.User, userSchema);
const RoleAssignment = mongoose.model(MODELS.RoleAssignment, roleAssignmentSchema);
const Institution = mongoose.model(MODELS.Institution, institutionSchema);
const Semester = mongoose.model(MODELS.Semester, semesterSchema);
mongoose.model(MODELS.AcademicLevel, academicLevelSchema);
await Promise.all([User.init(), RoleAssignment.init(), Institution.init(), Semester.init()]);

let admin = await User.findOne({ email: env.SEED_SUPER_ADMIN_EMAIL });
if (!admin) {
  admin = await User.create({
    email: env.SEED_SUPER_ADMIN_EMAIL,
    passwordHash: await hashPassword(env.SEED_SUPER_ADMIN_PASSWORD),
    accountType: 'admin',
    status: 'active',
    profile: { firstName: 'Super', lastName: 'Admin' },
    security: { passwordChangedAt: new Date() },
  });
  console.log(`Created super admin ${admin.email}`);
}
await RoleAssignment.updateOne(
  { userId: admin._id, role: 'super_admin', institutionId: null, revokedAt: null },
  {
    $setOnInsert: {
      userId: admin._id,
      role: 'super_admin',
      institutionId: null,
      grantedAt: new Date(),
    },
  },
  { upsert: true },
);

const yabatech = await Institution.findOneAndUpdate(
  { slug: 'yabatech' },
  {
    $setOnInsert: {
      name: 'Yaba College of Technology',
      shortName: 'YABATECH',
      slug: 'yabatech',
      country: 'NG',
      city: 'Lagos',
      timezone: 'Africa/Lagos',
    },
  },
  { upsert: true, returnDocument: 'after' },
);
for (const [rank, name, code] of [
  [1, 'First Semester', 'S1'],
  [2, 'Second Semester', 'S2'],
] as const) {
  await Semester.updateOne(
    { institutionId: yabatech!._id, code },
    { $setOnInsert: { institutionId: new Types.ObjectId(yabatech!._id), name, code, rank } },
    { upsert: true },
  );
}
console.log(
  'Seeded YABATECH with First and Second semesters. Add faculties, departments and programmes in the Admin Portal.',
);
await mongoose.disconnect();
