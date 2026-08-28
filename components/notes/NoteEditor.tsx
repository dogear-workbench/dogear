import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  Separator,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { ArrowLeft, ChevronDown, ChevronRight, Link2, Loader2, Plus, Tags, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useNotesStore, type NotePatch } from '@/stores/notes-store';
import type { Note, TodoItem, TodoStatus } from '@/types/note';

const LINK_PREFIXES = [
  { value: 'article', label: 'article', placeholder: '文章 ID，回车添加' },
  { value: 'stock', label: 'stock', placeholder: '股票代码，回车添加' },
  { value: 'plan', label: 'plan', placeholder: '计划文件路径，回车添加' },
] as const;

type LinkPrefix = (typeof LINK_PREFIXES)[number]['value'];

const NEXT_STATUS: Record<TodoStatus, TodoStatus> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
};

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '待办',
  in_progress: '进行中',
  done: '已完成',
};

function nextTodoId(todos: TodoItem[]): string {
  let n = todos.length + 1;
  while (todos.some((t) => t.id === `t${n}`)) n += 1;
  return `t${n}`;
}

function splitLink(link: string): { prefix: string; value: string } {
  const i = link.indexOf(':');
  return { prefix: link.slice(0, i), value: link.slice(i + 1) };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface NoteEditorProps {
  workspacePath: string;
  noteId: string;
  onClose: () => void;
  onDelete?: () => void;
}

// 父组件以 key={noteId} 挂载：换卡即重挂载，规避 MDXEditor 非受控内容重置
export function NoteEditor({ workspacePath, noteId, onClose, onDelete }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [linkPrefix, setLinkPrefix] = useState<LinkPrefix>('article');
  const [linkDraft, setLinkDraft] = useState('');
  const [todoDraft, setTodoDraft] = useState('');
  const [expandedTodoId, setExpandedTodoId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const pendingRef = useRef<NotePatch>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateNote = useNotesStore((s) => s.updateNote);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0) return;
    pendingRef.current = {};
    setSaving(true);
    void updateNote(workspacePath, noteId, patch).finally(() => setSaving(false));
  }, [workspacePath, noteId, updateNote]);

  const commit = useCallback(
    (patch: NotePatch, immediate = false) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      setTouched(true);
      if (immediate) {
        flush();
        return;
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 800);
    },
    [flush],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.getNote({ workspacePath, noteId });
      if (cancelled) return;
      if ('note' in result && result.note) {
        setNote(result.note);
        setTags(result.note.tags);
        setLinks(result.note.links);
        setTodos(result.note.todos);
      } else {
        setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      flush();
    };
  }, [workspacePath, noteId, flush]);

  const addTag = () => {
    const tag = tagDraft.trim();
    setTagDraft('');
    if (!tag || tags.includes(tag)) return;
    const next = [...tags, tag];
    setTags(next);
    commit({ tags: next }, true);
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    commit({ tags: next }, true);
  };

  const addLink = () => {
    const value = linkDraft.trim();
    setLinkDraft('');
    if (!value) return;
    const link = `${linkPrefix}:${value}`;
    if (links.includes(link)) return;
    const next = [...links, link];
    setLinks(next);
    commit({ links: next }, true);
  };

  const removeLink = (link: string) => {
    const next = links.filter((l) => l !== link);
    setLinks(next);
    commit({ links: next }, true);
  };

  const addTodo = () => {
    const text = todoDraft.trim();
    setTodoDraft('');
    if (!text) return;
    const next = [...todos, { id: nextTodoId(todos), text, status: 'pending' as const }];
    setTodos(next);
    commit({ todos: next }, true);
  };

  const removeTodo = (id: string) => {
    const next = todos.filter((t) => t.id !== id);
    setTodos(next);
    if (expandedTodoId === id) setExpandedTodoId(null);
    commit({ todos: next }, true);
  };

  // 勾选框三态循环：待办 → 进行中 → 已完成
  const cycleTodoStatus = (id: string) => {
    const next = todos.map((t) => (t.id === id ? { ...t, status: NEXT_STATUS[t.status] } : t));
    setTodos(next);
    commit({ todos: next }, true);
  };

  const updateTodoText = (id: string, text: string) => {
    const next = todos.map((t) => (t.id === id ? { ...t, text } : t));
    setTodos(next);
    commit({ todos: next });
  };

  const updateTodoPlan = (id: string, plan: string) => {
    const trimmed = plan.trim();
    const next = todos.map((t) => {
      if (t.id !== id) return t;
      return trimmed ? { ...t, plan: trimmed } : { id: t.id, text: t.text, status: t.status };
    });
    setTodos(next);
    commit({ todos: next });
  };

  const undoneCount = todos.filter((t) => t.status !== 'done').length;
  const linkPlaceholder = LINK_PREFIXES.find((p) => p.value === linkPrefix)?.placeholder ?? '';

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
      <header className="flex items-center gap-2 px-2 py-1.5 border-b shrink-0">
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="返回列表">
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">{note ? formatTime(note.created) : ''}</span>
        <span className="flex-1" />
        {touched && (
          <span className="text-xs text-muted-foreground">{saving ? '保存中…' : '已保存'}</span>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            title="移入回收站"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </header>

      {loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          卡片不存在或已被删除
          <Button variant="outline" size="sm" onClick={onClose}>
            返回列表
          </Button>
        </div>
      ) : !note ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b space-y-1.5 shrink-0">
            <div className="flex items-center gap-1.5 flex-wrap min-h-7">
              <Tags className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {tags.map((tag) => (
                <Badge key={tag} variant="subtle" className="gap-1 pl-2 pr-1 py-0 font-normal">
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="rounded-full hover:bg-foreground/10 p-0.5"
                    title="删除标签"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTag();
                }}
                placeholder="加标签"
                className="h-7 w-28 border-none bg-transparent px-1 text-xs shadow-none md:text-xs focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap min-h-7">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {links.map((link) => {
                const { prefix, value } = splitLink(link);
                return (
                  <Badge key={link} variant="outline" className="gap-1 pl-2 pr-1 py-0 font-normal max-w-64">
                    <span className="text-[10px] text-muted-foreground shrink-0">{prefix}</span>
                    <span className="truncate" title={value}>
                      {value}
                    </span>
                    <button
                      onClick={() => removeLink(link)}
                      className="rounded-full hover:bg-foreground/10 p-0.5 shrink-0"
                      title="删除链接"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                );
              })}
              <Select value={linkPrefix} onValueChange={(v) => setLinkPrefix(v as LinkPrefix)}>
                <SelectTrigger size="sm" className="h-7 w-[4.5rem] px-2 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_PREFIXES.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addLink();
                }}
                placeholder={linkPlaceholder}
                className="h-7 w-44 text-xs md:text-xs"
              />
              <Button variant="ghost" size="icon-xs" onClick={addLink} title="添加链接">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <MDXEditor
              markdown={note.content}
              onChange={(md) => commit({ content: md })}
              placeholder="写点什么…"
              contentEditableClassName="prose prose-sm max-w-none dark:prose-invert px-4 py-3 min-h-full focus:outline-none"
              className="flex-1 overflow-y-auto"
              plugins={[
                headingsPlugin(),
                listsPlugin(),
                quotePlugin(),
                thematicBreakPlugin(),
                linkPlugin(),
                linkDialogPlugin(),
                markdownShortcutPlugin(),
                toolbarPlugin({
                  toolbarClassName: 'border-b border-border bg-muted/30',
                  toolbarContents: () => (
                    <>
                      <UndoRedo />
                      <Separator />
                      <BoldItalicUnderlineToggles />
                      <Separator />
                      <BlockTypeSelect />
                      <Separator />
                      <ListsToggle />
                      <Separator />
                      <CreateLink />
                    </>
                  ),
                }),
              ]}
            />
          </div>

          <div className="border-t shrink-0 flex flex-col">
            <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                待办{todos.length > 0 ? `（未完成 ${undoneCount}/${todos.length}）` : ''}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto px-3 pb-1 space-y-0.5">
              {todos.map((todo) => (
                <div key={todo.id}>
                  <div className="flex items-center gap-2 group">
                    <Checkbox
                      checked={todo.status === 'done' ? true : todo.status === 'in_progress' ? 'indeterminate' : false}
                      onCheckedChange={() => cycleTodoStatus(todo.id)}
                      title={`${STATUS_LABEL[todo.status]}（点击切换状态）`}
                      className="w-3.5 h-3.5 data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
                    />
                    <Input
                      value={todo.text}
                      onChange={(e) => updateTodoText(todo.id, e.target.value)}
                      className={cn(
                        'h-7 border-none bg-transparent px-1 shadow-none focus-visible:ring-0',
                        todo.status === 'done' && 'line-through text-muted-foreground',
                        todo.status === 'in_progress' && 'text-amber-600',
                      )}
                    />
                    <button
                      onClick={() => setExpandedTodoId(expandedTodoId === todo.id ? null : todo.id)}
                      className="p-0.5 rounded hover:bg-muted"
                      title={todo.plan ? `实施计划：${todo.plan}` : '填实施计划路径（选填）'}
                    >
                      {expandedTodoId === todo.id ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight
                          className={cn('w-3.5 h-3.5', todo.plan ? 'text-primary' : 'text-muted-foreground')}
                        />
                      )}
                    </button>
                    <button
                      onClick={() => removeTodo(todo.id)}
                      className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100"
                      title="删除待办"
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  {expandedTodoId === todo.id && (
                    <Input
                      value={todo.plan ?? ''}
                      onChange={(e) => updateTodoPlan(todo.id, e.target.value)}
                      placeholder="plan 路径（选填，如 docs/plans/x/plan.md）"
                      className="h-7 mt-0.5 ml-5.5 w-[calc(100%-1.5rem)] border-dashed text-xs md:text-xs"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="px-3 pb-2 pt-0.5">
              <Input
                value={todoDraft}
                onChange={(e) => setTodoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTodo();
                }}
                placeholder="加待办，回车新增"
                className="h-7 border-dashed text-sm"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
