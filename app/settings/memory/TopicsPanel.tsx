import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '@/lib/client';
import { useConfirmStore } from '@/stores/confirm-store';
import { SLUG_RE, type TopicIndexEntry } from './types';
import { TopicsList } from './TopicsList';
import { TopicEditor, type EditState } from './TopicEditor';

interface Props {
  workspacePath: string;
}

export function TopicsPanel({ workspacePath }: Props) {
  const confirm = useConfirmStore((s) => s.confirm);
  const [topics, setTopics] = useState<TopicIndexEntry[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const loadingRef = useRef(false);

  const loadList = useCallback(async () => {
    const result = await client.listMemoryTopics({ workspacePath });
    const list = 'topics' in result ? result.topics : undefined;
    if (list) setTopics(list);
  }, [workspacePath]);

  useEffect(() => { loadList(); }, [loadList]);

  const editDirty = !!(edit && savedSnapshot && (
    edit.slug !== savedSnapshot.slug ||
    edit.title !== savedSnapshot.title ||
    edit.content !== savedSnapshot.content ||
    edit.keywords.join(' ') !== savedSnapshot.keywords.join(' ')
  ));

  const confirmDiscardIfDirty = async (): Promise<boolean> => {
    if (!edit) return true;
    if (edit.isNew) {
      const anyInput = edit.slug || edit.title || edit.keywords.length > 0 || edit.content;
      if (!anyInput) return true;
      const r = await confirm({
        title: '放弃草稿？',
        description: '当前新建的主题尚未保存，切换将丢失。',
        buttons: [
          { label: '取消', value: 'cancel', variant: 'outline' },
          { label: '放弃草稿', value: 'ok', variant: 'destructive' },
        ],
      });
      return r === 'ok';
    }
    if (!editDirty) return true;
    const r = await confirm({
      title: '放弃未保存的修改？',
      description: `主题「${savedSnapshot?.title ?? edit.originalSlug}」有未保存的修改。`,
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '放弃', value: 'ok', variant: 'destructive' },
      ],
    });
    return r === 'ok';
  };

  const selectTopic = async (slug: string) => {
    if (loadingRef.current) return;
    if (edit?.originalSlug === slug && !edit.isNew) return;
    if (!(await confirmDiscardIfDirty())) return;

    loadingRef.current = true;
    try {
      const result = await client.getMemoryTopic({ workspacePath, slug });
      const topic = 'topic' in result ? result.topic : undefined;
      if (topic) {
        const next: EditState = {
          isNew: false,
          originalSlug: topic.slug,
          slug: topic.slug,
          title: topic.title,
          keywords: [...topic.keywords],
          content: topic.content,
        };
        setEdit(next);
        setSavedSnapshot(next);
      }
    } finally {
      loadingRef.current = false;
    }
  };

  const handleCreate = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    const draft: EditState = {
      isNew: true,
      originalSlug: '',
      slug: '',
      title: '',
      keywords: [],
      content: '',
    };
    setEdit(draft);
    setSavedSnapshot(draft);
  };

  const validate = async (s: EditState): Promise<boolean> => {
    if (!s.slug.trim()) {
      await confirm({ title: '校验失败', description: 'slug 不能为空。', buttons: [{ label: '知道了', value: 'ok' }] });
      return false;
    }
    if (!SLUG_RE.test(s.slug)) {
      await confirm({
        title: '校验失败',
        description: 'slug 只能包含小写字母、数字和连字符（kebab-case）。',
        buttons: [{ label: '知道了', value: 'ok' }],
      });
      return false;
    }
    if (!s.title.trim()) {
      await confirm({ title: '校验失败', description: 'title 不能为空。', buttons: [{ label: '知道了', value: 'ok' }] });
      return false;
    }
    if (s.keywords.length === 0) {
      await confirm({
        title: '校验失败',
        description: '至少要有 1 个关键词供 dogear__RecallMemory 检索使用。',
        buttons: [{ label: '知道了', value: 'ok' }],
      });
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!edit) return;
    if (!(await validate(edit))) return;

    // slug 冲突预检（新建或改名场景）
    const slugChanged = edit.isNew || edit.slug !== edit.originalSlug;
    if (slugChanged) {
      const existing = await client.getMemoryTopic({ workspacePath, slug: edit.slug });
      const existingTopic = 'topic' in existing ? existing.topic : undefined;
      if (existingTopic) {
        const r = await confirm({
          title: 'slug 已存在',
          description: `已存在主题「${existingTopic.title}」(slug=${edit.slug})，保存会覆盖该主题。是否继续？`,
          buttons: [
            { label: '取消', value: 'cancel', variant: 'outline' },
            { label: '覆盖', value: 'ok', variant: 'destructive' },
          ],
        });
        if (r !== 'ok') return;
      }
    }

    setSaving(true);
    try {
      const result = await client.upsertMemoryTopic({
        workspacePath,
        topic: {
          slug: edit.slug,
          title: edit.title,
          keywords: edit.keywords,
          content: edit.content,
        },
      });
      const saved = 'topic' in result ? result.topic : undefined;
      const err = 'error' in result ? result.error : undefined;
      if (saved) {
        if (!edit.isNew && edit.slug !== edit.originalSlug) {
          await client.deleteMemoryTopic({ workspacePath, slug: edit.originalSlug });
        }
        const next: EditState = {
          isNew: false,
          originalSlug: saved.slug,
          slug: saved.slug,
          title: saved.title,
          keywords: [...saved.keywords],
          content: saved.content,
        };
        setEdit(next);
        setSavedSnapshot(next);
        await loadList();
      } else if (err) {
        await confirm({
          title: '保存失败',
          description: err,
          buttons: [{ label: '知道了', value: 'ok' }],
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!edit || edit.isNew) return;
    const r = await confirm({
      title: '删除主题？',
      description: `将删除主题「${edit.title}」(slug=${edit.originalSlug})，不可恢复。`,
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '删除', value: 'ok', variant: 'destructive' },
      ],
    });
    if (r !== 'ok') return;
    await client.deleteMemoryTopic({ workspacePath, slug: edit.originalSlug });
    setEdit(null);
    setSavedSnapshot(null);
    await loadList();
  };

  const handleEditChange = (updater: (prev: EditState) => EditState) => {
    setEdit((prev) => (prev ? updater(prev) : prev));
  };

  const selectedSlug = edit && !edit.isNew ? edit.originalSlug : null;

  return (
    <div className="flex gap-6">
      <TopicsList
        topics={topics}
        selectedSlug={selectedSlug}
        hasDraft={!!edit?.isNew}
        onCreate={handleCreate}
        onSelect={selectTopic}
      />
      <TopicEditor
        edit={edit}
        editDirty={editDirty}
        saving={saving}
        onChange={handleEditChange}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
