import { useState, useEffect, useMemo, useCallback } from 'react';
import { rendererEvents } from '@/lib/events';
import { useSlashCommandStore, type SlashCommandInfo } from '@/stores/slash-command-store';

interface UseSlashCommandsParams {
  sessionId: string | null;
  input: string;
}

interface UseSlashCommandsReturn {
  /** 菜单是否打开 */
  isSlashMenuOpen: boolean;
  /** 过滤后的命令列表 */
  filteredCommands: SlashCommandInfo[];
  /** 当前过滤关键词（不含 /） */
  filterQuery: string;
  /** 选中命令 */
  handleSlashCommandSelect: (cmd: SlashCommandInfo) => string;
  /** 关闭菜单 */
  closeSlashMenu: () => void;
}

/**
 * 斜杠命令 Hook
 * 管理命令菜单的显示/隐藏、过滤、选择
 */
export function useSlashCommands({
  sessionId,
  input,
}: UseSlashCommandsParams): UseSlashCommandsReturn {
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const { allCommands, setCapabilities } = useSlashCommandStore();

  // 监听 sessionCapabilities 事件更新 store
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.sessionCapabilities.listen((data) => {
      if (data.sessionId !== sessionId) return;
      setCapabilities({
        sdkCommands: data.sdkCommands,
        tools: data.tools,
        skills: data.skills,
        mcpServers: data.mcpServers,
      });
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, setCapabilities]);

  // 检测输入是否匹配 / 开头模式
  const filterQuery = useMemo(() => {
    // 只在输入以 / 开头且只有一个 / 时打开菜单
    const match = input.match(/^\/(\S*)$/);
    return match ? match[1] : '';
  }, [input]);

  // 控制菜单开关
  useEffect(() => {
    const shouldOpen = input.startsWith('/') && !input.includes(' ');
    setIsSlashMenuOpen(shouldOpen);
  }, [input]);

  // 过滤命令列表
  const filteredCommands = useMemo(() => {
    if (!filterQuery && input === '/') {
      return allCommands;
    }
    if (!filterQuery) return [];
    const q = filterQuery.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
    );
  }, [allCommands, filterQuery, input]);

  // 选择命令：返回替换后的输入文本
  const handleSlashCommandSelect = useCallback((cmd: SlashCommandInfo): string => {
    setIsSlashMenuOpen(false);
    if (cmd.argumentHint) {
      // 有参数提示时，只填充命令名 + 空格，等待用户输入参数
      return `/${cmd.name} `;
    }
    // 无参数时，直接返回完整命令
    return `/${cmd.name}`;
  }, []);

  const closeSlashMenu = useCallback(() => {
    setIsSlashMenuOpen(false);
  }, []);

  return {
    isSlashMenuOpen,
    filteredCommands,
    filterQuery,
    handleSlashCommandSelect,
    closeSlashMenu,
  };
}
