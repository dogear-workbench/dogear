import { test, expect } from 'bun:test';
import { pushConversation, removeConversationEverywhere, appendDecision, newCategory } from './smart-category-store.ts';
import type { SmartCategoriesIndex } from '../../types.ts';

test('pushConversation 去重', () => {
  const c = newCategory('A', ['t1']);
  const c1 = pushConversation(c, 'conv1');
  const c2 = pushConversation(c1, 'conv1');
  expect(c2.conversationIds).toEqual(['conv1']);
});

test('removeConversationEverywhere 从所有分类清除', () => {
  const idx: SmartCategoriesIndex = {
    categories: [
      { ...newCategory('A', ['t1']), conversationIds: ['c1', 'c2'] },
      { ...newCategory('B', ['t2']), conversationIds: ['c1', 'c3'] },
    ],
    recentDecisions: [],
  };
  const next = removeConversationEverywhere(idx, 'c1');
  expect(next.categories[0].conversationIds).toEqual(['c2']);
  expect(next.categories[1].conversationIds).toEqual(['c3']);
});

test('appendDecision 环形截断到 20 条', () => {
  let idx: SmartCategoriesIndex = { categories: [], recentDecisions: [] };
  for (let i = 0; i < 25; i++) {
    idx = appendDecision(idx, { time: `t${i}`, conversationId: 'c', decision: 'match' });
  }
  expect(idx.recentDecisions).toHaveLength(20);
  expect(idx.recentDecisions[0].time).toBe('t24');
});
