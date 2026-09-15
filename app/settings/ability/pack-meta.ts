import type { AbilityPackType } from '../../../electron/main/tipc/ability';

export const PACK_TYPE_LABELS: Record<AbilityPackType, string> = {
  'prompt-only': '提示词',
  'segment-tools': '段 + 工具',
  'skill-packs': 'Skill + 工具包',
};
