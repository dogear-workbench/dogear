import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Bot, Save, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConfirmStore } from '@/stores/confirm-store';
import type { AgentFileInfo } from '@/types/agents';

// 动态工具列表 hook
function useAvailableTools() {
  const [tools, setTools] = useState<string[]>([]);
  useEffect(() => {
    client.getRegisteredTools().then((result: any) => {
      const sdkNames = (result?.sdk || []).map((t: any) => t.name);
      const customNames = (result?.custom || []).map((t: any) => t.name);
      setTools([...sdkNames, ...customNames]);
    }).catch(() => {});
  }, []);
  return tools;
}

// 内置代理列表（只读展示，不可编辑/删除）
const BUILTIN_AGENTS: AgentFileInfo[] = [
  {
    fileName: '',
    agentName: 'chapter-analyzer',
    definition: {
      description: '分析书籍章节内容，提取摘要、关键概念和结构信息',
      prompt: '你是一个章节分析专家...',
      model: 'haiku',
      tools: ['Read', 'Glob', 'Grep'],
      maxTurns: 5,
    },
    filePath: '',
    source: 'builtin',
  },
  {
    fileName: '',
    agentName: 'book-searcher',
    definition: {
      description: '在书籍中搜索特定内容，查找相关章节和段落',
      prompt: '你是一个书籍内容搜索专家...',
      model: 'haiku',
      tools: ['Read', 'Glob', 'Grep'],
      maxTurns: 8,
    },
    filePath: '',
    source: 'builtin',
  },
];

// availableTools 已替换为动态加载的 useAvailableTools hook

const MODEL_OPTIONS = [
  { value: '', label: '继承（默认）' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

export function AgentsTab() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;
  const showConfirm = useConfirmStore((s) => s.showConfirm);
  const availableTools = useAvailableTools();

  const [fileAgents, setFileAgents] = useState<AgentFileInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 编辑表单状态
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editTools, setEditTools] = useState<string[]>([]);
  const [editMaxTurns, setEditMaxTurns] = useState<number | undefined>();
  const [editPrompt, setEditPrompt] = useState('');
  const [isNewAgent, setIsNewAgent] = useState(false);

  // 所有代理（内置 + 文件）
  const allAgents = [...BUILTIN_AGENTS, ...fileAgents];

  // 加载文件代理
  const loadAgents = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const result = await client.listAgentFiles({ workspacePath });
      if ('files' in result) {
        // 解析每个文件获取信息（简单展示文件名）
        const agents: AgentFileInfo[] = [];
        for (const fileName of (result.files as string[])) {
          const contentResult = await client.readAgentFile({ workspacePath, fileName });
          const content = 'content' in contentResult ? contentResult.content as string | null : null;
          if (content) {
            // 简单解析 frontmatter 中的 description
            const descMatch = content.match(/description:\s*(.+)/);
            const modelMatch = content.match(/model:\s*(.+)/);
            const maxTurnsMatch = content.match(/maxTurns:\s*(\d+)/);
            // 解析 tools 列表
            const toolsMatch = content.match(/tools:\n((?:\s+-\s+.+\n?)*)/);
            const tools = toolsMatch
              ? toolsMatch[1].split('\n').map(l => l.trim().replace(/^-\s+/, '')).filter(Boolean)
              : [];

            // 提取 prompt（--- 之后的内容）
            const parts = content.split(/^---\s*$/m);
            const prompt = parts.length >= 3 ? parts.slice(2).join('---').trim() : '';

            agents.push({
              fileName,
              agentName: fileName.replace(/\.md$/, ''),
              definition: {
                description: descMatch?.[1]?.trim() || '',
                prompt,
                model: modelMatch?.[1]?.trim(),
                tools: tools.length > 0 ? tools : undefined,
                maxTurns: maxTurnsMatch ? parseInt(maxTurnsMatch[1]) : undefined,
              },
              filePath: `${workspacePath}/.claude/agents/${fileName}`,
              source: 'file',
            });
          }
        }
        setFileAgents(agents);
      }
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // 选中代理时填充表单
  const selectAgent = (agentName: string) => {
    setSelectedAgent(agentName);
    setIsNewAgent(false);
    const agent = allAgents.find((a) => a.agentName === agentName);
    if (agent) {
      setEditName(agent.agentName);
      setEditDescription(agent.definition.description);
      setEditModel(agent.definition.model || '');
      setEditTools(agent.definition.tools || []);
      setEditMaxTurns(agent.definition.maxTurns);
      setEditPrompt(agent.definition.prompt);
    }
  };

  // 新建代理
  const handleNew = () => {
    setSelectedAgent(null);
    setIsNewAgent(true);
    setEditName('');
    setEditDescription('');
    setEditModel('haiku');
    setEditTools(['Read', 'Glob', 'Grep']);
    setEditMaxTurns(10);
    setEditPrompt('');
  };

  // 保存代理到文件
  const handleSave = async () => {
    if (!workspacePath || !editName.trim()) return;
    setSaving(true);
    try {
      // 构建 frontmatter
      const lines = ['---'];
      if (editDescription) lines.push(`description: ${editDescription}`);
      if (editModel) lines.push(`model: ${editModel}`);
      if (editMaxTurns) lines.push(`maxTurns: ${editMaxTurns}`);
      if (editTools.length > 0) {
        lines.push('tools:');
        for (const t of editTools) lines.push(`  - ${t}`);
      }
      lines.push('---', '', editPrompt);

      const fileName = `${editName.trim()}.md`;
      await client.writeAgentFile({ workspacePath, fileName, content: lines.join('\n') });
      await loadAgents();
      setSelectedAgent(editName.trim());
      setIsNewAgent(false);
    } finally {
      setSaving(false);
    }
  };

  // 删除代理文件
  const handleDelete = async (agentName: string) => {
    if (!workspacePath) return;
    const confirmed = await showConfirm(`确定要删除代理 "${agentName}" 吗？`);
    if (!confirmed) return;
    await client.deleteAgentFile({ workspacePath, fileName: `${agentName}.md` });
    await loadAgents();
    if (selectedAgent === agentName) {
      setSelectedAgent(null);
      setIsNewAgent(false);
    }
  };

  const toggleTool = (tool: string) => {
    setEditTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const selectedIsBuiltin = allAgents.find((a) => a.agentName === selectedAgent)?.source === 'builtin';

  if (!workspacePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <FolderOpen className="w-10 h-10 mx-auto opacity-50" />
          <p className="text-sm">请先选择一个工作区</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：代理列表 */}
      <div className="w-48 border-r flex flex-col">
        <div className="p-2 border-b flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">代理列表</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNew} title="新建代理">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {allAgents.map((agent) => (
            <div
              key={`${agent.source}-${agent.agentName}`}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-b',
                selectedAgent === agent.agentName && !isNewAgent
                  ? 'bg-accent'
                  : 'hover:bg-muted/50',
              )}
              onClick={() => selectAgent(agent.agentName)}
            >
              <Bot className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{agent.agentName}</span>
              {agent.source === 'builtin' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  内置
                </span>
              )}
            </div>
          ))}
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">加载中...</div>
          )}
        </div>
      </div>

      {/* 右侧：编辑表单 */}
      <div className="flex-1 overflow-y-auto p-6">
        {(selectedAgent || isNewAgent) ? (
          <div className="max-w-xl space-y-5">
            <h3 className="text-lg font-semibold">
              {isNewAgent ? '新建代理' : `编辑: ${selectedAgent}`}
            </h3>

            {selectedIsBuiltin && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                内置代理为只读，如需自定义请创建同名文件代理来覆盖。
              </p>
            )}

            {/* 名称 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">名称</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="my-agent"
                disabled={selectedIsBuiltin || (!isNewAgent && !!selectedAgent)}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                文件名即代理名，使用小写字母和连字符
              </p>
            </div>

            {/* 描述 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">描述</label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="描述代理的用途，Claude 会据此决定何时调用"
                disabled={selectedIsBuiltin}
                className="text-sm"
              />
            </div>

            {/* 模型 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">模型</label>
              <select
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                disabled={selectedIsBuiltin}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* maxTurns */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">最大轮次</label>
              <Input
                type="number"
                value={editMaxTurns ?? ''}
                onChange={(e) => setEditMaxTurns(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="不限制"
                disabled={selectedIsBuiltin}
                className="text-sm w-32"
              />
            </div>

            {/* 工具 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">允许的工具</label>
              <div className="grid grid-cols-3 gap-2">
                {availableTools.map((tool) => (
                  <div key={tool} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`tool-${tool}`}
                      checked={editTools.includes(tool)}
                      onCheckedChange={() => toggleTool(tool)}
                      disabled={selectedIsBuiltin}
                    />
                    <label htmlFor={`tool-${tool}`} className="text-xs">{tool}</label>
                  </div>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">系统提示词（Prompt）</label>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="描述代理的角色和行为..."
                className="min-h-[150px] font-mono text-sm resize-y"
                disabled={selectedIsBuiltin}
              />
            </div>

            {/* 操作按钮 */}
            {!selectedIsBuiltin && (
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleSave} disabled={!editName.trim() || saving}>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {saving ? '保存中...' : '保存到文件'}
                </Button>
                {!isNewAgent && selectedAgent && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(selectedAgent)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    删除
                  </Button>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground pt-2">
              代理配置修改后需重启会话才能生效。
            </p>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <Bot className="w-10 h-10 mx-auto opacity-50" />
              <p className="text-sm">选择左侧代理查看详情，或点击 + 新建</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
