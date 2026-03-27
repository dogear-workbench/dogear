import { useState } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, Persona } from '@/types/settings';

interface PersonaTabProps {
  local: AppSettings;
  setLocal: (updater: (prev: AppSettings) => AppSettings) => void;
}

export function PersonaTab({ local, setLocal }: PersonaTabProps) {
  const personas = local.personas || [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  const selectedPersona = personas.find(p => p.id === selectedId);

  // 选中人设并加载到编辑区
  const selectPersona = (persona: Persona) => {
    setSelectedId(persona.id);
    setEditName(persona.name);
    setEditDescription(persona.description || '');
    setEditPrompt(persona.prompt);
  };

  // 新建人设
  const handleCreate = () => {
    const newPersona: Persona = {
      id: uuidv4(),
      name: '新人设',
      description: '',
      prompt: '',
      createdAt: new Date().toISOString(),
    };
    setLocal(prev => ({
      ...prev,
      personas: [...(prev.personas || []), newPersona],
    }));
    selectPersona(newPersona);
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (!selectedId) return;
    setLocal(prev => ({
      ...prev,
      personas: (prev.personas || []).map(p =>
        p.id === selectedId
          ? { ...p, name: editName, description: editDescription || undefined, prompt: editPrompt }
          : p
      ),
    }));
  };

  // 删除人设
  const handleDelete = (id: string) => {
    setLocal(prev => ({
      ...prev,
      personas: (prev.personas || []).filter(p => p.id !== id),
    }));
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  // 编辑区是否有未保存修改
  const editDirty = selectedPersona && (
    editName !== selectedPersona.name ||
    editDescription !== (selectedPersona.description || '') ||
    editPrompt !== selectedPersona.prompt
  );

  return (
    <div className="max-w-3xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">人设管理</h2>
      <p className="text-sm text-muted-foreground mb-6">
        管理 AI 助手的人设预设，可在对话中快速切换不同的人设风格
      </p>

      <div className="flex gap-6">
        {/* 左侧：人设列表 */}
        <div className="w-56 flex-shrink-0 space-y-2">
          <Button variant="outline" size="sm" className="w-full" onClick={handleCreate}>
            <Plus className="w-4 h-4 mr-1" />
            新建人设
          </Button>

          <ScrollArea className="h-[400px]">
            <div className="space-y-1 pr-2">
              {personas.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  还没有人设，点击上方按钮创建
                </p>
              )}
              {personas.map(persona => (
                <div
                  key={persona.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm',
                    selectedId === persona.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted/50',
                  )}
                  onClick={() => selectPersona(persona)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{persona.name}</div>
                    {persona.description && (
                      <div className="text-xs text-muted-foreground truncate">{persona.description}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDelete(persona.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧：编辑区 */}
        <div className="flex-1 min-w-0">
          {selectedPersona ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">名称</label>
                <input
                  type="text"
                  className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="人设名称"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">描述 <span className="text-muted-foreground font-normal">（可选）</span></label>
                <input
                  type="text"
                  className="h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="简短描述这个人设的用途"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">提示词</label>
                <Textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="输入人设提示词，例如：&#10;你是一个严谨的学术助手，回答问题时需要引用原文...&#10;&#10;或者：&#10;你是一个轻松幽默的阅读伙伴，用通俗的语言解释复杂概念..."
                  className="min-h-[200px] text-sm resize-y"
                />
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={!editDirty}
                >
                  <Check className="w-4 h-4 mr-1" />
                  应用修改
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              <div className="text-center space-y-2">
                <Pencil className="w-8 h-8 mx-auto opacity-50" />
                <p className="text-sm">选择一个人设进行编辑</p>
                <p className="text-xs">或点击左侧"新建人设"创建</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
