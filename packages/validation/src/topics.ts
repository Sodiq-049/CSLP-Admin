import { z } from 'zod';
import { IsoDateSchema, ObjectIdSchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

const Objective = z.object({ id: z.string().optional(), text: z.string().trim().min(3).max(500) });

export const CreateTopicSchema = requestContract(
  'CreateTopicRequest',
  z.object({
    title: z.string().trim().min(2).max(200),
    parentTopicId: ObjectIdSchema.optional(),
    learningObjectives: z.array(Objective).max(20).default([]),
  }),
);
export const UpdateTopicSchema = requestContract(
  'UpdateTopicRequest',
  z.object({
    title: z.string().trim().min(2).max(200).optional(),
    learningObjectives: z.array(Objective).max(20).optional(),
  }),
);

/** Drag-and-drop and keyboard moves share this: place the topic between two siblings under a parent. */
export const MoveTopicSchema = requestContract(
  'MoveTopicRequest',
  z.object({
    parentTopicId: ObjectIdSchema.nullable(),
    beforeId: ObjectIdSchema.nullable().default(null),
    afterId: ObjectIdSchema.nullable().default(null),
  }),
);

const TopicBase = z.object({
  id: ObjectIdSchema,
  courseId: ObjectIdSchema,
  parentTopicId: ObjectIdSchema.nullable(),
  title: z.string(),
  slug: z.string(),
  orderKey: z.string(),
  depth: z.number().int(),
  learningObjectives: z.array(
    z.object({ id: z.string(), text: z.string(), source: z.enum(['official', 'admin']) }),
  ),
  outlineNodeKey: z.string().nullable(),
  publication: z.object({
    state: z.enum(['unpublished', 'scheduled', 'published', 'archived']),
    publishedAt: IsoDateSchema.nullable(),
  }),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  archivedAt: IsoDateSchema.nullable(),
});
export const TopicSchema = responseContract('Topic', TopicBase);
export type Topic = z.infer<typeof TopicSchema>;

export const TopicTreeNodeSchema = responseContract(
  'TopicTreeNode',
  TopicBase.extend({ subtopics: z.array(TopicBase) }),
);
export type TopicTreeNode = z.infer<typeof TopicTreeNodeSchema>;

export const TopicTreeQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
