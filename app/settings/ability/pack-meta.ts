import type { AbilityPackType } from '../../../electron/main/tipc/ability';
import type { SceneOverviewResult } from '../../../electron/main/tipc/ability-scene';

export type AbilityCategoryMeta = SceneOverviewResult['categories'][number];

export const PACK_TYPE_LABELS: Record<AbilityPackType, string> = {
  'prompt-only': '提示词',
  'segment-tools': '段 + 工具',
  'skill-packs': 'Skill + 工具包',
};

/** getSceneOverview 不可用时的分组兜底；label 与注册表 ABILITY_CATEGORIES 保持同步 */
export const CATEGORY_FALLBACK: readonly AbilityCategoryMeta[] = [
  { key: 'system', label: '系统功能', description: '' },
  { key: 'context-memory', label: '上下文与记忆', description: '' },
  { key: 'extension', label: '扩展能力', description: '' },
];
