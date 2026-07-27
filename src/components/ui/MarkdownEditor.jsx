import { useEffect } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { normalizeMarkdown } from '../../utils/markdown.js';

const extensions = [StarterKit, Markdown];

function ToolbarButton({ active, disabled = false, label, onClick, children }) {
  return (
    <button
      type="button"
      className="markdown-editor__toolbar-button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder = '',
  minHeight = 180,
  readOnly = false,
}) {
  const normalizedValue = normalizeMarkdown(value);
  const editor = useEditor({
    extensions,
    content: normalizedValue,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: {
      attributes: {
        'aria-label': label,
        'data-placeholder': placeholder,
        class: 'markdown-editor__content',
        style: `min-height: ${minHeight}px`,
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(currentEditor.getMarkdown());
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive('bold') ?? false,
      italic: currentEditor?.isActive('italic') ?? false,
      heading2: currentEditor?.isActive('heading', { level: 2 }) ?? false,
      heading3: currentEditor?.isActive('heading', { level: 3 }) ?? false,
      bulletList: currentEditor?.isActive('bulletList') ?? false,
      orderedList: currentEditor?.isActive('orderedList') ?? false,
      blockquote: currentEditor?.isActive('blockquote') ?? false,
      canUndo: currentEditor?.can().undo() ?? false,
      canRedo: currentEditor?.can().redo() ?? false,
    }),
  });

  useEffect(() => {
    if (!editor) return;
    const next = normalizeMarkdown(value);
    if (editor.getMarkdown() !== next) {
      editor.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return null;

  return (
    <div className={`markdown-editor${readOnly ? ' markdown-editor--readonly' : ''}`}>
      {!readOnly && (
        <div className="markdown-editor__toolbar" role="toolbar" aria-label={`${label}の書式`}>
          <ToolbarButton
            label="見出し2"
            active={state?.heading2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            label="見出し3"
            active={state?.heading3}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            H3
          </ToolbarButton>
          <ToolbarButton
            label="太字"
            active={state?.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            label="斜体"
            active={state?.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </ToolbarButton>
          <ToolbarButton
            label="箇条書き"
            active={state?.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            • List
          </ToolbarButton>
          <ToolbarButton
            label="番号付きリスト"
            active={state?.orderedList}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1. List
          </ToolbarButton>
          <ToolbarButton
            label="引用"
            active={state?.blockquote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            “”
          </ToolbarButton>
          <span className="markdown-editor__toolbar-spacer" />
          <ToolbarButton
            label="元に戻す"
            disabled={!state?.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            ↶
          </ToolbarButton>
          <ToolbarButton
            label="やり直す"
            disabled={!state?.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            ↷
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
