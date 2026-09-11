import type { BuiltinTaskId } from './types.js';
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
  'categorize',
  'categorize_organize',
];

export const BUILTIN_LABELS: Record<BuiltinTaskId, string> = {
  categorize: '补分类',
  categorize_organize: '分类整理',
};

export const BUILTIN_TASK_META: Record<BuiltinTaskId, BuiltinTaskMeta> = {
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
