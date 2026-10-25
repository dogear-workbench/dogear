import { test, expect } from 'bun:test';
import { isSimilarTopic, topicSimilarity, bigramDice } from './memory-similarity.js';

test('slug 前缀扩充场景判相似（bun-test vs bun-test-config）', () => {
  expect(
    isSimilarTopic(
      { slug: 'bun-test', title: 'bun test 配置坑', keywords: ['bun', 'test'] },
      { slug: 'bun-test-config', title: 'bun test 配置', keywords: ['bun', 'test', 'config'] },
    ),
  ).toBe(true);
});

test('同 slug 判不相似（覆盖写入路径，不进查重）', () => {
  expect(
    isSimilarTopic(
      { slug: 'a', title: '甲', keywords: ['x'] },
      { slug: 'a', title: '乙', keywords: ['y'] },
    ),
  ).toBe(false);
});

test('无关主题判不相似', () => {
  expect(
    isSimilarTopic(
      { slug: 'window-state', title: '窗口位置记忆', keywords: ['electron', '窗口'] },
      { slug: 'memory-system', title: '记忆系统', keywords: ['召回', '记忆'] },
    ),
  ).toBe(false);
});

test('标题撞词但主体不同：字面包含不等于相似', () => {
  const sim = topicSimilarity(
    { slug: 'ui-window-position', title: '窗口位置记忆', keywords: ['electron'] },
    { slug: 'memory-recall', title: '记忆召回策略', keywords: ['recall'] },
  );
  expect(sim).toBeLessThan(0.5);
});

test('bigramDice：完全一致为 1，无关为 0', () => {
  expect(bigramDice('股票估值偏好', '股票估值偏好')).toBe(1);
  expect(bigramDice('股票估值偏好', '窗口位置管理')).toBeLessThan(0.3);
});
