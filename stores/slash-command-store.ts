import { create } from 'zustand';

/**
 * 斜杠命令信息
 */
export interface SlashCommandInfo {
  name: string;         // 不含 / 前缀
  description: string;
  argumentHint: string;
  source: 'sdk' | 'custom';
}

interface SlashCommandState {
  // --- 状态 ---
  /** SDK 返回的命令列表 */
  sdkCommands: SlashCommandInfo[];
  /** 自定义命令列表（静态定义） */
  customCommands: SlashCommandInfo[];
  /** 所有命令（SDK + 自定义） */
  allCommands: SlashCommandInfo[];
  /** SDK 工具列表 */
  tools: string[];
  /** SDK 技能列表 */
  skills: string[];
  /** MCP 服务器列表 */
  mcpServers: Array<{ name: string; status: string }>;

  // --- Actions ---
  /** 设置 SDK 命令列表 */
  setSdkCommands: (cmds: SlashCommandInfo[]) => void;
  /** 设置会话能力信息（从 sessionCapabilities 事件） */
  setCapabilities: (data: {
    sdkCommands: Array<{ name: string; description: string; argumentHint: string }>;
    tools: string[];
    skills: string[];
    mcpServers: Array<{ name: string; status: string }>;
  }) => void;
  /** 重置所有状态 */
  reset: () => void;
}

// 静态自定义命令
const CUSTOM_COMMANDS: SlashCommandInfo[] = [
  {
    name: 'search',
    description: '在当前书籍中搜索关键词',
    argumentHint: '<关键词>',
    source: 'custom',
  },
];

export const useSlashCommandStore = create<SlashCommandState>((set) => ({
  sdkCommands: [],
  customCommands: CUSTOM_COMMANDS,
  allCommands: [...CUSTOM_COMMANDS],
  tools: [],
  skills: [],
  mcpServers: [],

  setSdkCommands: (cmds) => {
    set((state) => ({
      sdkCommands: cmds,
      allCommands: [...cmds, ...state.customCommands],
    }));
  },

  setCapabilities: (data) => {
    const sdkCmds: SlashCommandInfo[] = data.sdkCommands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      argumentHint: cmd.argumentHint,
      source: 'sdk' as const,
    }));
    set((state) => ({
      sdkCommands: sdkCmds,
      allCommands: [...sdkCmds, ...state.customCommands],
      tools: data.tools,
      skills: data.skills,
      mcpServers: data.mcpServers,
    }));
  },

  reset: () => set({
    sdkCommands: [],
    allCommands: [...CUSTOM_COMMANDS],
    tools: [],
    skills: [],
    mcpServers: [],
  }),
}));
