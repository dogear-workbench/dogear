import type { BuiltinTaskId } from './types.js';
import {
  DEFAULT_GROUP_DIGEST_PROMPT,
  loadGroupDigestPrompt,
  saveGroupDigestPrompt,
} from '../memory/group-digest-prompt.js';
import {
  DEFAULT_REVIEW_PROMPT,
  loadReviewPrompt,
  saveReviewPrompt,
} from '../memory/review-prompt.js';
import {
  DEFAULT_CATEGORIZE_PROMPT,
  loadCategorizePrompt,
  saveCategorizePrompt,
} from '../memory/categorize-prompt.js';
import {
  DEFAULT_ORGANIZE_PROMPT,
  loadOrganizePrompt,
  saveOrganizePrompt,
} from '../memory/organize-prompt.js';

export interface BuiltinTaskMeta {
  id: BuiltinTaskId;
  label: string;
  loadPrompt: (configDir: string) => Promise<string>;
  savePrompt: (configDir: string, prompt: string) => Promise<void>;
  defaultPrompt: (configDir: string) => Promise<string>;
  tools: string[];
}

export const BUILTIN_TASK_IDS: readonly BuiltinTaskId[] = [
  'group_digest',
  'review',
  'categorize',
  'categorize_organize',
];

export const BUILTIN_LABELS: Record<BuiltinTaskId, string> = {
  group_digest: '组卡提炼',
  review: '复盘报告',
  categorize: '智能分类',
  categorize_organize: '分类整理',
};

export const BUILTIN_TASK_META: Record<BuiltinTaskId, BuiltinTaskMeta> = {
  group_digest: {
    id: 'group_digest',
    label: BUILTIN_LABELS.group_digest,
    loadPrompt: loadGroupDigestPrompt,
    savePrompt: saveGroupDigestPrompt,
    defaultPrompt: async () => DEFAULT_GROUP_DIGEST_PROMPT,
    tools: ['dogear__ReadGroupDigest', 'dogear__CleanTranscript', 'dogear__SaveGroupDigest', 'dogear__SaveGroupBackground', 'dogear__ListGroupFiles'],
  },
  review: {
    id: 'review',
    label: BUILTIN_LABELS.review,
    loadPrompt: loadReviewPrompt,
    savePrompt: saveReviewPrompt,
    defaultPrompt: async () => DEFAULT_REVIEW_PROMPT,
    tools: [
      'dogear__ListDigests',
      'dogear__ReadDigest',
      'dogear__TraceSource',
      'dogear__ReadReport',
      'dogear__WriteReport',
      'dogear__RecallMemory',
      'dogear__SaveMemory',
      'dogear__ForgetMemory',
      'dogear__GetCoreProfile',
      'dogear__UpdateCoreProfile',
    ],
  },
  categorize: {
    id: 'categorize',
    label: BUILTIN_LABELS.categorize,
    loadPrompt: loadCategorizePrompt,
    savePrompt: saveCategorizePrompt,
    defaultPrompt: async () => DEFAULT_CATEGORIZE_PROMPT,
    tools: ['dogear__ListCategories', 'dogear__SaveCategoryJoin', 'dogear__SaveCategoryNew', 'dogear__SaveCategoryMerge'],
  },
  categorize_organize: {
    id: 'categorize_organize',
    label: BUILTIN_LABELS.categorize_organize,
    loadPrompt: loadOrganizePrompt,
    savePrompt: saveOrganizePrompt,
    defaultPrompt: async () => DEFAULT_ORGANIZE_PROMPT,
    tools: ['dogear__ListCategories', 'dogear__PruneCategoryTags', 'dogear__SaveCategoryMerge'],
  },
};
