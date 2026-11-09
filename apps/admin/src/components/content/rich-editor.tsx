'use client';

import { Extension, Mark, mergeAttributes, type JSONContent } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Sparkles,
  Code2,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Table as TableIcon,
  Undo2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditorAction } from '@cslp/shared-types';
import { AiAssistDialog } from './ai-assist-dialog';
import { cn } from '@/components/ui/cn';

/** Matches the server allow-list (packages/server-core/src/content/rich-doc.ts). */
const Citation = Mark.create({
  name: 'citation',
  inclusive: false,
  addAttributes() {
    return { label: { default: null }, index: { default: 1 } };
  },
  parseHTML() {
    return [{ tag: 'sup[data-citation]' }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-citation': mark.attrs.label,
        class: 'citation',
        title: `Source ${mark.attrs.index}`,
      }),
      0,
    ];
  },
});

const Provenance = Extension.create({
  name: 'provenance',
  addGlobalAttributes() {
    return [
      {
        types: [
          'paragraph',
          'heading',
          'bulletList',
          'orderedList',
          'blockquote',
          'codeBlock',
          'table',
        ],
        attributes: {
          provenance: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-provenance'),
            renderHTML: (attrs) =>
              attrs.provenance ? { 'data-provenance': attrs.provenance } : {},
          },
        },
      },
    ];
  },
});

function ToolButton({
  label,
  active,
  onClick,
  icon: Icon,
  disabled,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon: typeof Bold;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'rounded p-1.5 text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-30',
        active && 'bg-primary-soft text-primary',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function Toolbar({ editor, onAiAssist }: { editor: Editor; onAiAssist?: () => void }) {
  // TipTap 3 does not re-render on every transaction; subscribe to exactly what the toolbar shows.
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      hasSelection: !e.state.selection.empty,
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-14 z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-surface/95 px-2 py-1.5 backdrop-blur"
    >
      <ToolButton
        label="Bold"
        icon={Bold}
        active={st.bold}
        onClick={() => c().toggleBold().run()}
      />
      <ToolButton
        label="Italic"
        icon={Italic}
        active={st.italic}
        onClick={() => c().toggleItalic().run()}
      />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton
        label="Heading"
        icon={Heading2}
        active={st.h2}
        onClick={() => c().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        label="Subheading"
        icon={Heading3}
        active={st.h3}
        onClick={() => c().toggleHeading({ level: 3 }).run()}
      />
      <ToolButton
        label="Bulleted list"
        icon={List}
        active={st.bullet}
        onClick={() => c().toggleBulletList().run()}
      />
      <ToolButton
        label="Numbered list"
        icon={ListOrdered}
        active={st.ordered}
        onClick={() => c().toggleOrderedList().run()}
      />
      <ToolButton
        label="Callout"
        icon={Quote}
        active={st.quote}
        onClick={() => c().toggleBlockquote().run()}
      />
      <ToolButton
        label="Code block"
        icon={Code2}
        active={st.code}
        onClick={() => c().toggleCodeBlock().run()}
      />
      <ToolButton
        label="Insert table"
        icon={TableIcon}
        onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton
        label="Undo"
        icon={Undo2}
        disabled={!st.canUndo}
        onClick={() => c().undo().run()}
      />
      <ToolButton
        label="Redo"
        icon={Redo2}
        disabled={!st.canRedo}
        onClick={() => c().redo().run()}
      />
      {onAiAssist && (
        <>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onAiAssist}
            disabled={!st.hasSelection}
            title={st.hasSelection ? 'AI assist' : 'Select some text first'}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[13px] font-medium text-violet hover:bg-violet-soft disabled:opacity-40"
          >
            <Sparkles className="size-4" aria-hidden /> AI assist
          </button>
        </>
      )}
    </div>
  );
}

/** Plain text → editor nodes; lines starting with "- " become a bulleted list. */
function textToNodes(text: string): JSONContent[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1 && lines.every((l) => /^[-•]\s+/.test(l))) {
    return [
      {
        type: 'bulletList',
        content: lines.map((l) => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: l.replace(/^[-•]\s+/, '') }] },
          ],
        })),
      },
    ];
  }
  return lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }));
}

export function RichEditor({
  content,
  editable,
  onChange,
  label,
  onAiAction,
}: {
  content: JSONContent;
  editable: boolean;
  onChange?: (doc: JSONContent) => void;
  label: string;
  onAiAction?: (action: EditorAction, text: string, context: string) => Promise<string>;
}) {
  const [assist, setAssist] = useState<{ from: number; to: number; text: string } | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, protocols: ['http', 'https'] },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Citation,
      Provenance,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose-notes focus:outline-none',
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: e }) => onChange?.(e.getJSON()),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return <div className="min-h-64" />;
  return (
    <div className="rounded-lg border border-border bg-surface focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      {editable && (
        <Toolbar
          editor={editor}
          onAiAssist={
            onAiAction
              ? () => {
                  const { from, to } = editor.state.selection;
                  setAssist({ from, to, text: editor.state.doc.textBetween(from, to, '\n') });
                }
              : undefined
          }
        />
      )}
      <div className="px-5 py-5 sm:px-8">
        <EditorContent editor={editor} />
      </div>
      {onAiAction && (
        <AiAssistDialog
          open={!!assist}
          text={assist?.text ?? ''}
          onClose={() => setAssist(null)}
          onRequest={(action) => onAiAction(action, assist!.text, editor.getText().slice(0, 4000))}
          onAccept={(suggestion) => {
            if (!assist) return;
            const nodes = textToNodes(suggestion);
            const singleInline = nodes.length === 1 && nodes[0]!.type === 'paragraph';
            editor
              .chain()
              .focus()
              .insertContentAt(
                { from: assist.from, to: assist.to },
                singleInline ? nodes[0]!.content! : nodes,
              )
              .run();
          }}
        />
      )}
    </div>
  );
}
