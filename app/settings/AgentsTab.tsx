import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, Bot, Save, FolderOpen, Download, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';
import type { AgentFileInfo } from '@/types/agents';

interface ToolMeta {
  name: string;
  description: string;
  server: string;
  category: string;
}
interface ToolGroup {
  server: string;
  label: string;
  tools: ToolMeta[];
}

function useToolGroups() {
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  useEffect(() => {
    client.getRegisteredTools().then((result: any) => {
      setGroups(Array.isArray(result) ? result : []);
    }).catch(() => {});
  }, []);
  return groups;
}

const SDK_BUILTIN_AGENTS: AgentFileInfo[] = [
  {
    fileName: '(sdk)',
    agentName: 'Explore',
    definition: {
      description: '只读探索代理（Haiku）。在大型仓库中快速定位文件、grep 关键字、回答「X 在哪定义/谁引用 Y」。不会做改动。',
      prompt: '',
      model: 'haiku',
      tools: ['Read', 'Glob', 'Grep'],
    },
    filePath: '',
    source: 'template',
  },
  {
    fileName: '(sdk)',
    agentName: 'general-purpose',
    definition: {
      description: '通用代理。研究复杂问题、搜索代码、执行多步骤任务。适合不属于 Explore/Plan 的开放式任务。',
      prompt: '',
      tools: [],
    },
    filePath: '',
    source: 'template',
  },
  {
    fileName: '(sdk)',
    agentName: 'Plan',
    definition: {
      description: '软件架构规划代理。需要设计实现策略时使用，返回分步计划、关键文件、架构权衡。',
      prompt: '',
      tools: [],
    },
    filePath: '',
    source: 'template',
  },
];

const MODEL_OPTIONS = [
  { value: '', label: '继承（默认）' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

interface AgentTemplate {
  fileName: string;
  agentName: string;
  description: string;
}

function parseAgentFile(content: string, fileName: string, workspacePath: string): AgentFileInfo {
  const descMatch = content.match(/description:\s*(.+)/);
  const modelMatch = content.match(/model:\s*(.+)/);
  const maxTurnsMatch = content.match(/maxTurns:\s*(\d+)/);
  const toolsMatch = content.match(/tools:\n((?:\s+-\s+.+\n?)*)/);
  const tools = toolsMatch
    ? toolsMatch[1].split('\n').map(l => l.trim().replace(/^-\s+/, '')).filter(Boolean)
    : [];
  const parts = content.split(/^---\s*$/m);
  const prompt = parts.length >= 3 ? parts.slice(2).join('---').trim() : '';
  return {
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
  };
}

/**
 * 把工具列表反向推导成「分组开关」状态
 * - 含 mcp__<server>__* → 该 MCP 包开关 ON
 * - 含基础包内任一工具 → 基础包 ON
 */
function deriveToolGroupSelection(tools: string[] | undefined, groups: ToolGroup[]): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  if (!tools || tools.length === 0) return selected;
  for (const g of groups) {
    if (g.server === 'sdk') {
      const sdkNames = new Set(g.tools.map(t => t.name));
      if (tools.some(t => sdkNames.has(t))) selected[g.server] = true;
    } else {
      const wildcard = `mcp__${g.server}__*`;
      if (tools.includes(wildcard) || tools.some(t => t.startsWith(`mcp__${g.server}__`))) {
        selected[g.server] = true;
      }
    }
  }
  return selected;
}

/**
 * 把分组开关状态展开成具体工具名列表（写入 .md frontmatter 用）
 */
function expandToolGroupSelection(selection: Record<string, boolean>, groups: ToolGroup[]): string[] {
  const result: string[] = [];
  for (const g of groups) {
    if (!selection[g.server]) continue;
    if (g.server === 'sdk') {
      result.push(...g.tools.map(t => t.name));
    } else {
      result.push(`mcp__${g.server}__*`);
    }
  }
  return result;
}

export function AgentsTab() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;
  const toolGroups = useToolGroups();

  const [fileAgents, setFileAgents] = useState<AgentFileInfo[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editToolGroups, setEditToolGroups] = useState<Record<string, boolean>>({});
  const [editMaxTurns, setEditMaxTurns] = useState<number | undefined>();
  const [editPrompt, setEditPrompt] = useState('');
  const [isNewAgent, setIsNewAgent] = useState(false);

  const allAgents = useMemo(
    () => [...SDK_BUILTIN_AGENTS, ...fileAgents],
    [fileAgents],
  );

  const fileAgentNames = useMemo(
    () => new Set(fileAgents.map((a) => a.fileName)),
    [fileAgents],
  );

  const loadTemplates = useCallback(async () => {
    try {
      const result = await client.listAgentTemplates();
      if ('templates' in result && Array.isArray(result.templates)) {
        setTemplates(result.templates as unknown as AgentTemplate[]);
      }
    } catch (error) {
      console.warn('加载代理模板失败', error);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const result = await client.listAgentFiles({ workspacePath });
      if ('files' in result) {
        const agents: AgentFileInfo[] = [];
        for (const fileName of (result.files as string[])) {
          const contentResult = await client.readAgentFile({ workspacePath, fileName });
          const content = 'content' in contentResult ? contentResult.content as string | null : null;
          if (content) {
            agents.push(parseAgentFile(content, fileName, workspacePath));
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

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const selectAgent = (agentName: string) => {
    setSelectedAgent(agentName);
    setIsNewAgent(false);
    const agent = allAgents.find((a) => a.agentName === agentName);
    if (agent) {
      setEditName(agent.agentName);
      setEditDescription(agent.definition.description);
      setEditModel(agent.definition.model || '');
      setEditToolGroups(deriveToolGroupSelection(agent.definition.tools, toolGroups));
      setEditMaxTurns(agent.definition.maxTurns);
      setEditPrompt(agent.definition.prompt);
    }
  };

  const handleNew = () => {
    setSelectedAgent(null);
    setIsNewAgent(true);
    setEditName('');
    setEditDescription('');
    setEditModel('haiku');
    setEditToolGroups({ sdk: true });
    setEditMaxTurns(10);
    setEditPrompt('');
  };

  const handleSave = async () => {
    if (!workspacePath || !editName.trim()) return;
    setSaving(true);
    try {
      const tools = expandToolGroupSelection(editToolGroups, toolGroups);
      const lines = ['---'];
      if (editDescription) lines.push(`description: ${editDescription}`);
      if (editModel) lines.push(`model: ${editModel}`);
      if (editMaxTurns) lines.push(`maxTurns: ${editMaxTurns}`);
      if (tools.length > 0) {
        lines.push('tools:');
        for (const t of tools) lines.push(`  - ${t}`);
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

  const handleDelete = async (agentName: string) => {
    if (!workspacePath) return;
    const confirmed = await showConfirm('删除代理', `确定要删除代理 "${agentName}" 吗？`);
    if (!confirmed) return;
    await client.deleteAgentFile({ workspacePath, fileName: `${agentName}.md` });
    await loadAgents();
    if (selectedAgent === agentName) {
      setSelectedAgent(null);
      setIsNewAgent(false);
    }
  };

  const handleSubscribe = async (template: AgentTemplate, isResync: boolean) => {
    if (!workspacePath) return;
    if (isResync) {
      const ok = await showConfirm(
        '重新同步模板',
        `「重新同步」会覆盖你对 ${template.fileName} 的本地修改，确定继续吗？`,
      );
      if (!ok) return;
    }
    setBusyTemplate(template.fileName);
    try {
      const result = await client.subscribeAgentTemplate({
        workspacePath,
        fileName: template.fileName,
        overwrite: isResync,
      });
      if ('error' in result && result.error === 'AGENT_EXISTS') {
        const ok = await showConfirm(
          '代理已存在',
          `${template.fileName} 已存在，是否覆盖？`,
        );
        if (!ok) return;
        await client.subscribeAgentTemplate({
          workspacePath,
          fileName: template.fileName,
          overwrite: true,
        });
      } else if ('error' in result && result.error) {
        console.error('订阅失败:', result.error);
        return;
      }
      await loadAgents();
    } finally {
      setBusyTemplate(null);
    }
  };

  const toggleGroup = (server: string) => {
    setEditToolGroups((prev) => ({ ...prev, [server]: !prev[server] }));
  };

  const selectedIsBuiltin = allAgents.find((a) => a.agentName === selectedAgent)?.source === 'template';

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
      <div className="w-56 border-r flex flex-col">
        <div className="p-2 border-b flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">代理列表</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNew} title="新建代理">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* SDK 内置 */}
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
            SDK 内置（只读）
          </div>
          {SDK_BUILTIN_AGENTS.map((agent) => (
            <div
              key={`sdk-${agent.agentName}`}
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
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                SDK
              </span>
            </div>
          ))}

          {/* 可订阅模板 */}
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30 mt-1">
            可订阅模板
          </div>
          {templates.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">无可订阅模板</div>
          )}
          {templates.map((tpl) => {
            const subscribed = fileAgentNames.has(tpl.fileName);
            const busy = busyTemplate === tpl.fileName;
            return (
              <div
                key={`tpl-${tpl.fileName}`}
                className="flex items-center gap-2 px-3 py-2 text-sm border-b group"
              >
                <Bot className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{tpl.agentName}</div>
                  {tpl.description && (
                    <div className="text-[10px] text-muted-foreground truncate">{tpl.description}</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleSubscribe(tpl, subscribed)}
                  disabled={busy}
                  title={subscribed ? '重新同步（覆盖本地）' : '订阅到工作区'}
                >
                  {subscribed
                    ? <RotateCcw className="w-3.5 h-3.5" />
                    : <Download className="w-3.5 h-3.5" />}
                </Button>
              </div>
            );
          })}

          {/* 工作区代理 */}
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30 mt-1">
            当前工作区
          </div>
          {fileAgents.map((agent) => (
            <div
              key={`file-${agent.agentName}`}
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
            </div>
          ))}
          {fileAgents.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">暂无工作区代理</div>
          )}
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
                SDK 内置代理为只读。如需自定义，可创建同名工作区代理来覆盖。
              </p>
            )}

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

            <div className="space-y-1.5">
              <label className="text-sm font-medium">允许的工具包</label>
              <div className="space-y-2 border rounded-md p-3">
                {toolGroups.map((g) => (
                  <div key={g.server} className="flex items-start gap-2">
                    <Checkbox
                      id={`tg-${g.server}`}
                      checked={!!editToolGroups[g.server]}
                      onCheckedChange={() => toggleGroup(g.server)}
                      disabled={selectedIsBuiltin}
                      className="mt-0.5"
                    />
                    <label htmlFor={`tg-${g.server}`} className="text-sm flex-1 cursor-pointer">
                      <div className="font-medium">{g.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.tools.length} 个工具
                        {g.server !== 'sdk' && (
                          <span className="ml-1 font-mono opacity-70">
                            mcp__{g.server}__*
                          </span>
                        )}
                      </div>
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                整组勾选；保存时基础包写出全部工具名，MCP 包写通配符。
              </p>
            </div>

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
