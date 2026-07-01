import { test, expect } from 'bun:test';
import { pushGroup, removeGroupEverywhere, appendDecision, newCategory } from './smart-category-store.ts';
import type { SmartCategoriesIndex } from '../../types.ts';

test('pushGroup 去重', () => {
  const c = newCategory('A', ['t1']);
  const c1 = pushGroup(c, 'grp1');
  const c2 = pushGroup(c1, 'grp1');
  expect(c2.groupIds).toEqual(['grp1']);
});

test('removeGroupEverywhere 从所有分类清除', () => {
  const idx: SmartCategoriesIndex = {
    categories: [
      { ...newCategory('A', ['t1']), groupIds: ['g1', 'g2'] },
      { ...newCategory('B', ['t2']), groupIds: ['g1', 'g3'] },
    ],
    recentDecisions: [],
  };
  const next = removeGroupEverywhere(idx, 'g1');
  expect(next.categories[0].groupIds).toEqual(['g2']);
  expect(next.categories[1].groupIds).toEqual(['g3']);
});

test('appendDecision 环形截断到 20 条', () => {
  let idx: SmartCategoriesIndex = { categories: [], recentDecisions: [] };
  for (let i = 0; i < 25; i++) {
    idx = appendDecision(idx, { time: `t${i}`, groupId: 'g', decision: 'match' });
  }
  expect(idx.recentDecisions).toHaveLength(20);
  expect(idx.recentDecisions[0].time).toBe('t24');
});

test('pushGroup 实际插入时 updatedAt 推进', async () => {
  const c = newCategory('A', ['t1']);
  await new Promise((r) => setTimeout(r, 5));
  const c1 = pushGroup(c, 'grp1');
  expect(c1.updatedAt > c.updatedAt).toBe(true);
});
