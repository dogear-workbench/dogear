import { useState } from 'react';
import { Pencil, Check, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface EditState {
  isNew: boolean;
  originalSlug: string;
  slug: string;
  title: string;
  keywords: string[];
  content: string;
}

interface Props {
  edit: EditState | null;
  editDirty: boolean;
  saving: boolean;
  onChange: (updater: (prev: EditState) => EditState) => void;
  onSave: () => void;
  onDelete: () => void;
}

export function TopicEditor({ edit, editDirty, saving, onChange, onSave, onDelete }: Props) {
  const [keywordInput, setKeywordInput] = useState('');

  if (!edit) {
    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-center h-[400px] text-muted-foreground">
          <div className="text-center space-y-2">
            <Pencil className="w-8 h-8 mx-auto opacity-50" />
            <p className="text-sm">选择一个主题进行编辑</p>
            <p className="text-xs">或点击左侧"新建主题"创建</p>
          </div>
        </div>
      </div>
    );
  }

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw) return;
    onChange((prev) => {
      if (prev.keywords.includes(kw)) return prev;
      return { ...prev, keywords: [...prev.keywords, kw] };
    });
    setKeywordInput('');
  };

  const removeKeyword = (kw: string) => {
    onChange((prev) => ({ ...prev, keywords: prev.keywords.filter((k) => k !== kw) }));
  };

  const slugChanged = !edit.isNew && edit.slug !== edit.originalSlug;

  return (
    <div className="flex-1 min-w-0">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Slug（文件名）</label>
            <input
              type="text"
              className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              value={edit.slug}
              onChange={(e) => onChange((prev) => ({ ...prev, slug: e.target.value }))}
              placeholder="kebab-case，如 stock-analysis"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">标题</label>
            <input
              type="text"
              className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              value={edit.title}
              onChange={(e) => onChange((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="主题中文标题"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">关键词（供 RecallMemory 检索）</label>
          <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-background min-h-[44px]">
            {edit.keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs"
              >
                {kw}
                <button
                  type="button"
                  className="hover:text-destructive"
                  onClick={() => removeKeyword(kw)}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              className="flex-1 min-w-[120px] px-1 text-xs bg-transparent focus:outline-none"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              onBlur={addKeyword}
              placeholder={edit.keywords.length === 0 ? '输入关键词后回车' : '添加…'}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">正文（Markdown）</label>
          <Textarea
            value={edit.content}
            onChange={(e) => onChange((prev) => ({ ...prev, content: e.target.value }))}
            placeholder={'# 主题标题\n\n## 核心决策\n...\n\n## 未决问题\n...'}
            className="min-h-[300px] font-mono text-sm resize-y"
          />
        </div>

        <div className="flex items-center justify-between">
          {!edit.isNew && (
            <span className="text-xs text-muted-foreground">
              slug: <span className="font-mono">{edit.originalSlug}</span>
              {slugChanged && (
                <span className="ml-2 text-amber-600">
                  → 将重命名为 <span className="font-mono">{edit.slug}</span>
                </span>
              )}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            {!edit.isNew && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={onDelete}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                删除
              </Button>
            )}
            <Button size="sm" disabled={!editDirty || saving} onClick={onSave}>
              <Check className="w-4 h-4 mr-1" />
              {saving ? '保存中...' : edit.isNew ? '创建' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
