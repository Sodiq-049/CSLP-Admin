import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type {
  Enrolment,
  Progress,
  ProgressUpdateSchema,
  QuizAttemptResult,
  QuizAttemptSchema,
} from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import type { LearningMaterialDoc } from '../content/content.schemas.js';
import type { QuestionDoc } from '../quizzes/question.schema.js';
import { PublishedContentService } from '../publishing/published-content.service.js';
import { gradeAnswer } from './grading.js';
import type { EnrolmentDoc, MaterialProgressDoc, QuizAttemptDoc } from './learning.schemas.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/**
 * Student learning activity (docs/04 §3.10). Every entry point first proves the target is visible
 * through PublishedContentService, so students can never record activity on hidden content.
 */
@Injectable()
export class LearningService {
  constructor(
    @InjectModel(MODELS.Enrolment) private readonly enrolments: Model<EnrolmentDoc>,
    @InjectModel(MODELS.MaterialProgress) private readonly progress: Model<MaterialProgressDoc>,
    @InjectModel(MODELS.QuizAttempt) private readonly attempts: Model<QuizAttemptDoc>,
    @InjectModel(MODELS.LearningMaterial) private readonly materials: Model<LearningMaterialDoc>,
    @InjectModel(MODELS.Question) private readonly questions: Model<QuestionDoc>,
    private readonly published: PublishedContentService,
  ) {}

  /* ───────────── enrolments ───────────── */

  async enrol(userId: string, institutionId: Types.ObjectId, courseId: string): Promise<Enrolment> {
    await this.published.courseDetail(institutionId, courseId); // 404 unless visible
    await this.ensureEnrolled(userId, institutionId, oid(courseId));
    return (await this.listEnrolments(userId, institutionId)).find((e) => e.courseId === courseId)!;
  }

  private async ensureEnrolled(
    userId: string,
    institutionId: Types.ObjectId,
    courseId: Types.ObjectId,
  ) {
    await this.enrolments.updateOne(
      { institutionId, userId: oid(userId), courseId },
      { $setOnInsert: { enrolledAt: new Date() } },
      { upsert: true },
    );
  }

  async listEnrolments(userId: string, institutionId: Types.ObjectId): Promise<Enrolment[]> {
    const list = await this.enrolments
      .find({ institutionId, userId: oid(userId) })
      .sort({ enrolledAt: -1 })
      .lean<EnrolmentDoc[]>();
    const out: Enrolment[] = [];
    for (const e of list) {
      // Courses that were unpublished since enrolment drop out of the student's list.
      const detail = await this.published
        .courseDetail(institutionId, String(e.courseId))
        .catch(() => null);
      if (!detail) continue;
      const materialIds = detail.topics.flatMap((t) => [
        ...t.materials.map((m) => m.id),
        ...t.subtopics.flatMap((s) => s.materials.map((m) => m.id)),
      ]);
      const completed = materialIds.length
        ? await this.progress.countDocuments({
            institutionId,
            userId: oid(userId),
            materialId: { $in: materialIds.map(oid) },
            state: 'completed',
          })
        : 0;
      out.push({
        id: String(e._id),
        courseId: String(e.courseId),
        courseCode: detail.code,
        courseTitle: detail.title,
        enrolledAt: e.enrolledAt.toISOString(),
        progress: {
          completedMaterials: completed,
          totalMaterials: materialIds.length,
          percent: materialIds.length ? Math.round((completed / materialIds.length) * 100) : 0,
        },
      });
    }
    return out;
  }

  /* ───────────── progress ───────────── */

  async updateProgress(
    userId: string,
    institutionId: Types.ObjectId,
    materialId: string,
    input: z.output<typeof ProgressUpdateSchema>,
  ): Promise<Progress> {
    const m = await this.published.material(institutionId, materialId); // 404 unless visible
    const courseId = oid(m.course.id);
    await this.ensureEnrolled(userId, institutionId, courseId);
    const key = { institutionId, userId: oid(userId), materialId: oid(materialId) };
    const existing = await this.progress.findOne(key).lean<MaterialProgressDoc>();
    // Progress only moves forward: a completed material stays completed.
    const completed = input.state === 'completed' || existing?.state === 'completed';
    const percent = completed ? 100 : Math.max(existing?.percent ?? 0, input.percent ?? 0);
    const doc = await this.progress
      .findOneAndUpdate(
        key,
        {
          $set: {
            courseId,
            topicId: oid(m.topic.id),
            kind: m.kind,
            state: completed ? 'completed' : 'in_progress',
            percent,
            ...(completed && !existing?.completedAt ? { completedAt: new Date() } : {}),
          },
          $inc: { timeSpentSec: input.timeSpentSec },
        },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<MaterialProgressDoc>();
    return this.toProgress(doc!);
  }

  async listProgress(
    userId: string,
    institutionId: Types.ObjectId,
    courseId?: string,
  ): Promise<Progress[]> {
    const f: Record<string, unknown> = { institutionId, userId: oid(userId) };
    if (courseId) f.courseId = oid(courseId);
    const list = await this.progress
      .find(f)
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean<MaterialProgressDoc[]>();
    return list.map((p) => this.toProgress(p));
  }

  private toProgress = (p: MaterialProgressDoc): Progress => ({
    materialId: String(p.materialId),
    courseId: String(p.courseId),
    state: p.state,
    percent: p.percent,
    timeSpentSec: p.timeSpentSec,
    updatedAt: p.updatedAt.toISOString(),
  });

  /* ───────────── quiz attempts ───────────── */

  async submitAttempt(
    userId: string,
    institutionId: Types.ObjectId,
    materialId: string,
    input: z.output<typeof QuizAttemptSchema>,
  ): Promise<QuizAttemptResult> {
    const m = await this.published.material(institutionId, materialId); // 404 unless visible
    if (m.content.kind !== 'quiz') throw AppError.conflict('This material is not a quiz');
    const material = await this.materials
      .findOne({ institutionId, _id: oid(materialId) }, { publishedVersionId: 1 })
      .lean<LearningMaterialDoc>();
    const ids = m.content.questions.map((q) => q.id);
    // Grade against exactly the pinned revisions the student was shown.
    const qs = await this.questions
      .find({ institutionId, _id: { $in: ids.map(oid) } })
      .lean<QuestionDoc[]>();
    const byId = new Map(qs.map((q) => [String(q._id), q]));
    const answers = new Map<string, { optionId?: string; text?: string }>();
    for (const a of input.answers) if (!answers.has(a.questionId)) answers.set(a.questionId, a);

    let score = 0;
    let maxScore = 0;
    let pending = 0;
    const graded: QuizAttemptDoc['answers'] = [];
    const results: QuizAttemptResult['results'] = [];
    for (const id of ids) {
      const q = byId.get(id);
      if (!q) continue;
      const a = answers.get(id);
      const g = gradeAnswer(q, a);
      if (g.scored) maxScore += 1;
      if (g.scored && g.outcome === 'correct') score += 1;
      if (g.outcome === 'needs_review') pending += 1;
      graded.push({
        questionId: q._id,
        type: q.type,
        optionId: a?.optionId ?? null,
        text: a?.text ?? null,
        outcome: g.outcome,
      });
      // Official assessment items keep their answers private even after submission.
      const reveal = !q.isOfficialAssessment;
      results.push({
        questionId: id,
        type: q.type,
        outcome: g.outcome,
        correctOptionId: reveal ? (q.options.find((o) => o.isCorrect)?.id ?? null) : null,
        acceptedAnswers: reveal ? q.acceptedAnswers : [],
        explanation: reveal ? q.explanation : '',
      });
    }
    const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
    const passed = percent >= m.content.settings.passMarkPercent;
    const now = new Date();
    const doc = await this.attempts.create({
      institutionId,
      userId: oid(userId),
      courseId: oid(m.course.id),
      topicId: oid(m.topic.id),
      materialId: oid(materialId),
      versionId: material!.publishedVersionId!,
      answers: graded,
      score,
      maxScore,
      percent,
      passed,
      pendingManualReview: pending,
      startedAt: input.startedAt ? new Date(input.startedAt) : null,
      submittedAt: now,
    });
    const spent = input.startedAt
      ? Math.min(
          4 * 3600,
          Math.max(0, Math.round((now.getTime() - Date.parse(input.startedAt)) / 1000)),
        )
      : 0;
    await this.updateProgress(userId, institutionId, materialId, {
      state: 'completed',
      timeSpentSec: spent,
    });
    return {
      id: String(doc._id),
      materialId,
      score,
      maxScore,
      percent,
      passed,
      pendingManualReview: pending,
      results,
      submittedAt: now.toISOString(),
    };
  }

  async listAttempts(userId: string, institutionId: Types.ObjectId, materialId: string) {
    if (!Types.ObjectId.isValid(materialId)) throw AppError.notFound();
    const list = await this.attempts
      .find({ institutionId, userId: oid(userId), materialId: oid(materialId) })
      .sort({ submittedAt: -1 })
      .limit(20)
      .lean<QuizAttemptDoc[]>();
    return list.map((a) => ({
      id: String(a._id),
      score: a.score,
      maxScore: a.maxScore,
      percent: a.percent,
      passed: a.passed,
      submittedAt: a.submittedAt.toISOString(),
    }));
  }
}
