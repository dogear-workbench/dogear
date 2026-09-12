import {
  AppWindow,
  Brain,
  Code,
  Cog,
  Globe,
  Newspaper,
  ScrollText,
  Search,
  StickyNote,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { AbilityPackType } from '../../../electron/main/tipc/ability';

/** 卡片/详情页图标：key → lucide 图标（纯 UI 选型，能力元数据仍以 getAbilityPacks 为准） */
export const PACK_ICONS: Record<string, LucideIcon> = {
  'workspace-rules': ScrollText,
  'global-rules': Globe,
  'core-profile': UserRound,
  memory: Brain,
  notes: StickyNote,
  'agent-collab': Users,
  stock: TrendingUp,
  article: Newspaper,
  browser: AppWindow,
  'web-mcp': Search,
  'code-workflow': Code,
};

export const SYSTEM_BEHAVIOR_ICON = Cog;

export function packIconOf(key: string): LucideIcon {
  return PACK_ICONS[key] ?? Cog;
}

export const PACK_TYPE_LABELS: Record<AbilityPackType, string> = {
  'prompt-only': '提示词',
  'segment-tools': '段 + 工具',
  'skill-packs': 'Skill + 工具包',
};
