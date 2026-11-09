'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  CornerUpLeft,
  GripVertical,
  Pencil,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  coursesArchiveTopic,
  coursesCreateTopic,
  coursesMoveTopic,
  coursesUpdateTopic,
  useCoursesTree,
  type Course,
  type Topic,
  type TopicTreeNode,
} from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Input } from '@/components/ui/field';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';

type MoveInput = {
  parentTopicId: string | null;
  beforeId?: string | null;
  afterId?: string | null;
};

function InlineAdd({
  placeholder,
  onAdd,
  label,
}: {
  placeholder: string;
  onAdd: (title: string) => Promise<void>;
  label: string;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value.trim().length < 2) return;
        setBusy(true);
        try {
          await onAdd(value.trim());
          setValue('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-[13px]"
      />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={value.trim().length < 2}
      >
        <Plus className="size-3.5" aria-hidden /> Add
      </Button>
    </form>
  );
}

function TopicRow({
  topic,
  index,
  siblings,
  canManage,
  onMove,
  onRename,
  onArchive,
  extraActions,
  depth,
}: {
  topic: Topic;
  index: number;
  siblings: Topic[];
  canManage: boolean;
  onMove: (input: MoveInput) => void;
  onRename: (title: string) => Promise<void>;
  onArchive: () => void;
  extraActions?: React.ReactNode;
  depth: 0 | 1;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    setActivatorNodeRef,
  } = useSortable({ id: topic.id, disabled: !canManage });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const prev = siblings[index - 1];
  const next = siblings[index + 1];
  const parentId = topic.parentTopicId;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
        isDragging ? 'z-10 border-border bg-surface shadow-md' : 'hover:bg-surface-2',
      )}
    >
      {canManage && (
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab rounded p-1 text-subtle hover:text-fg active:cursor-grabbing"
          aria-label={`Drag to reorder ${topic.title}`}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <span
        className={cn(
          'w-7 shrink-0 text-right text-[12px] tabular-nums text-subtle',
          depth === 1 && 'w-10',
        )}
      >
        {depth === 0 ? `${index + 1}.` : `${index + 1})`}
      </span>
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim().length < 2) return;
            await onRename(title.trim());
            setEditing(false);
          }}
        >
          <Input
            autoFocus
            aria-label="Topic title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setEditing(false), setTitle(topic.title))}
            className="h-8 text-[13px]"
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setTitle(topic.title);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Link
          href={`/courses/${topic.courseId}/topics/${topic.id}`}
          className={cn(
            'flex-1 text-sm hover:text-primary hover:underline',
            depth === 0 ? 'font-medium text-fg' : 'text-fg',
          )}
        >
          {topic.title}
        </Link>
      )}
      {canManage && !editing && (
        <div className="flex shrink-0 items-center opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {extraActions}
          <IconBtn
            label={`Move ${topic.title} up`}
            disabled={!prev}
            onClick={() =>
              onMove({
                parentTopicId: parentId,
                beforeId: siblings[index - 2]?.id ?? null,
                afterId: prev!.id,
              })
            }
            icon={ArrowUp}
          />
          <IconBtn
            label={`Move ${topic.title} down`}
            disabled={!next}
            onClick={() =>
              onMove({
                parentTopicId: parentId,
                beforeId: next!.id,
                afterId: siblings[index + 2]?.id ?? null,
              })
            }
            icon={ArrowDown}
          />
          <IconBtn label={`Rename ${topic.title}`} onClick={() => setEditing(true)} icon={Pencil} />
          <IconBtn label={`Archive ${topic.title}`} onClick={onArchive} icon={Archive} />
        </div>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  icon: Icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: typeof ArrowUp;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1.5 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** Siblings are sortable within their list; neighbours after the drop become before/after ids. */
function useDropHandler(
  list: Topic[],
  parentTopicId: string | null,
  onMove: (id: string, input: MoveInput) => void,
) {
  return (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = list.findIndex((t) => t.id === e.active.id);
    const to = list.findIndex((t) => t.id === e.over!.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(list, from, to);
    onMove(String(e.active.id), {
      parentTopicId,
      beforeId: reordered[to - 1]?.id ?? null,
      afterId: reordered[to + 1]?.id ?? null,
    });
  };
}

function SubtopicList({
  parent,
  canManage,
  onMove,
  onRename,
  onArchive,
}: {
  parent: TopicTreeNode;
  canManage: boolean;
  onMove: (id: string, i: MoveInput) => void;
  onRename: (id: string, t: string) => Promise<void>;
  onArchive: (t: Topic) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = useDropHandler(parent.subtopics, parent.id, onMove);
  if (!parent.subtopics.length) return null;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={parent.subtopics.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="ml-8 border-l border-border pl-2">
          {parent.subtopics.map((s, i) => (
            <TopicRow
              key={s.id}
              topic={s}
              index={i}
              siblings={parent.subtopics}
              depth={1}
              canManage={canManage}
              onMove={(input) => onMove(s.id, input)}
              onRename={(t) => onRename(s.id, t)}
              onArchive={() => onArchive(s)}
              extraActions={
                <IconBtn
                  label={`Make ${s.title} a topic`}
                  onClick={() =>
                    onMove(s.id, { parentTopicId: null, beforeId: parent.id, afterId: null })
                  }
                  icon={CornerUpLeft}
                />
              }
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function TopicsPanel({ course, readOnly }: { course: Course; readOnly: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = useCan('topic.manage', course.institutionId) && !readOnly;
  const tree = useCoursesTree(course.id);
  const topics = tree.data?.data ?? [];
  const [archiving, setArchiving] = useState<Topic | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const refresh = () => invalidateAdmin(qc);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      await refresh();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const move = (id: string, input: MoveInput) =>
    run(() =>
      coursesMoveTopic(id, {
        parentTopicId: input.parentTopicId,
        beforeId: input.beforeId ?? null,
        afterId: input.afterId ?? null,
      }),
    );
  const rename = (id: string, title: string) =>
    run(() => coursesUpdateTopic(id, { title }), 'Topic renamed');
  const onDragEnd = useDropHandler(topics, null, move);

  if (tree.isLoading) return <Spinner />;
  if (tree.error)
    return <ErrorState message={errorMessage(tree.error)} onRetry={() => tree.refetch()} />;

  return (
    <Card>
      <CardHeader
        title="Topics and subtopics"
        description={
          canManage
            ? 'Drag the handle (or focus it and use Space + arrow keys) to reorder, or use the row buttons.'
            : 'Read-only'
        }
      />
      {canManage && (
        <div className="border-b border-border px-5 py-3">
          <InlineAdd
            label="New topic title"
            placeholder="Add a topic, e.g. Computer Generations"
            onAdd={(title) => run(() => coursesCreateTopic(course.id, { title }), 'Topic added')}
          />
        </div>
      )}
      {!topics.length ? (
        <EmptyState
          title="No topics yet"
          body="Add topics here, or approve the course outline and sync its topics."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={topics.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-0.5 px-3 py-3" aria-label="Topics">
              {topics.map((t, i) => (
                <li key={t.id}>
                  <TopicRow
                    topic={t}
                    index={i}
                    siblings={topics}
                    depth={0}
                    canManage={canManage}
                    onMove={(input) => move(t.id, input)}
                    onRename={(title) => rename(t.id, title)}
                    onArchive={() => setArchiving(t)}
                    extraActions={
                      <>
                        <IconBtn
                          label={`Add a subtopic to ${t.title}`}
                          onClick={() => setAddingTo(addingTo === t.id ? null : t.id)}
                          icon={Plus}
                        />
                        {i > 0 && !t.subtopics.length && (
                          <IconBtn
                            label={`Make ${t.title} a subtopic of ${topics[i - 1]!.title}`}
                            onClick={() => move(t.id, { parentTopicId: topics[i - 1]!.id })}
                            icon={CornerDownRight}
                          />
                        )}
                      </>
                    }
                  />
                  <SubtopicList
                    parent={t}
                    canManage={canManage}
                    onMove={move}
                    onRename={rename}
                    onArchive={setArchiving}
                  />
                  {addingTo === t.id && (
                    <div className="mt-1 mb-2 ml-10">
                      <InlineAdd
                        label={`New subtopic of ${t.title}`}
                        placeholder="Subtopic title"
                        onAdd={(title) =>
                          run(
                            () => coursesCreateTopic(course.id, { title, parentTopicId: t.id }),
                            'Subtopic added',
                          )
                        }
                      />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {archiving && (
        <ConfirmDialog
          open
          onClose={() => setArchiving(null)}
          title={`Archive “${archiving.title}”?`}
          body={
            archiving.depth === 0
              ? 'Its subtopics are archived too. Nothing is deleted.'
              : 'The subtopic is hidden. Nothing is deleted.'
          }
          confirmLabel="Archive"
          onConfirm={() => run(() => coursesArchiveTopic(archiving.id), 'Topic archived')}
        />
      )}
    </Card>
  );
}
