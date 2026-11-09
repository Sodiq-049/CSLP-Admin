import type {
  AcademicLevel,
  CurriculumVersion,
  Department,
  Faculty,
  Institution,
  Programme,
  Semester,
} from '@cslp/validation';
import type {
  AcademicLevelDoc,
  CurriculumVersionDoc,
  DepartmentDoc,
  FacultyDoc,
  InstitutionDoc,
  ProgrammeDoc,
  SemesterDoc,
} from './academic.schemas.js';

const stamps = (d: { createdAt: Date; updatedAt: Date; archivedAt: Date | null }) => ({
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
  archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
});

export const toInstitutionDto = (d: InstitutionDoc): Institution => ({
  id: String(d._id),
  name: d.name,
  shortName: d.shortName,
  slug: d.slug,
  country: d.country,
  city: d.city ?? null,
  timezone: d.timezone,
  status: d.status,
  settings: {
    defaultLocale: d.settings.defaultLocale,
    aiMonthlyBudgetUsd: d.settings.aiMonthlyBudgetUsd,
    videoMonthlyBudgetUsd: d.settings.videoMonthlyBudgetUsd,
    studentAiChatEnabled: d.settings.studentAiChatEnabled,
  },
  ...stamps(d),
});

export const toFacultyDto = (d: FacultyDoc): Faculty => ({
  id: String(d._id),
  institutionId: String(d.institutionId),
  name: d.name,
  code: d.code ?? null,
  orderKey: d.orderKey,
  ...stamps(d),
});

export const toDepartmentDto = (d: DepartmentDoc): Department => ({
  id: String(d._id),
  institutionId: String(d.institutionId),
  facultyId: String(d.facultyId),
  name: d.name,
  code: d.code,
  orderKey: d.orderKey,
  ...stamps(d),
});

export const toProgrammeDto = (d: ProgrammeDoc): Programme => ({
  id: String(d._id),
  institutionId: String(d.institutionId),
  facultyId: String(d.facultyId),
  departmentId: String(d.departmentId),
  name: d.name,
  award: d.award,
  code: d.code,
  durationLevels: d.durationLevels,
  ...stamps(d),
});

export const toLevelDto = (d: AcademicLevelDoc): AcademicLevel => ({
  id: String(d._id),
  institutionId: String(d.institutionId),
  programmeId: String(d.programmeId),
  name: d.name,
  code: d.code,
  rank: d.rank,
  ...stamps(d),
});

export const toSemesterDto = (d: SemesterDoc): Semester => ({
  id: String(d._id),
  institutionId: String(d.institutionId),
  name: d.name,
  code: d.code,
  rank: d.rank,
  ...stamps(d),
});

export const toCurriculumVersionDto = (d: CurriculumVersionDoc): CurriculumVersion => ({
  id: String(d._id),
  institutionId: String(d.institutionId),
  programmeId: d.programmeId ? String(d.programmeId) : null,
  label: d.label,
  effectiveFromSession: d.effectiveFromSession,
  isCurrent: d.isCurrent,
  notes: d.notes ?? null,
  ...stamps(d),
});
