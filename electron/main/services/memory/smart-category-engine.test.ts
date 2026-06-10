import { test, expect } from 'bun:test';
import { matchByThreshold, pickRedistributeCandidates, normalizeTag, normalizeTags } from './smart-category-engine.ts';
import type { SmartCategory, DigestTags } from '../../types.ts';

const cats: SmartCategory[] = [
  { id: 'c1', name: '产品', anchorTags: ['产品-Dashboard', 'UI重构'], conversationIds: [], createdAt: '', updatedAt: '' },
  { id: 'c2', name: '股票', anchorTags: ['股票-估值'], conversationIds: [], createdAt: '', updatedAt: '' },
];

test('matchByThreshold 命中单个分类', () => {
  const tags: DigestTags = {
    primary: '产品-Dashboard',
    secondary: ['UI重构'],
    scores: { '产品-Dashboard': 0.8, 'UI重构': 0.4 },
  };
  const r = matchByThreshold(tags, cats, 0.5);
  expect(r).toHaveLength(1);
  expect(r[0].categoryId).toBe('c1');
  expect(r[0].score).toBeCloseTo(1.2);
});

test('matchByThreshold 阈值过滤', () => {
  const tags: DigestTags = {
    primary: '股票-估值',
    secondary: [],
    scores: { '股票-估值': 0.3 },
  };
  expect(matchByThreshold(tags, cats, 0.5)).toEqual([]);
});

test('matchByThreshold 命中多个分类（多标签归类）', () => {
  const tags: DigestTags = {
    primary: '产品-Dashboard',
    secondary: ['股票-估值'],
    scores: { '产品-Dashboard': 0.6, '股票-估值': 0.6 },
  };
  const r = matchByThreshold(tags, cats, 0.5);
  expect(r.map((x) => x.categoryId).sort()).toEqual(['c1', 'c2']);
});

test('pickRedistributeCandidates 只返回邻近 2 个分类', () => {
  const more = [...cats, { id: 'c3', name: '代码', anchorTags: ['UI重构'], conversationIds: ['x'], createdAt: '', updatedAt: '' }];
  const r = pickRedistributeCandidates(more, ['UI重构', '产品-Dashboard']);
  expect(r).toHaveLength(2);
  expect(r.map((x) => x.categoryId).sort()).toEqual(['c1', 'c3']);
});

test('normalizeTag 统一分隔符', () => {
  expect(normalizeTag('  产品 / Dashboard ')).toBe('产品-Dashboard');
  expect(normalizeTag('股票--估值')).toBe('股票-估值');
});

test('normalizeTags 整体归一化', () => {
  const t = normalizeTags({
    primary: '产品 / Dashboard',
    secondary: ['UI 重构'],
    scores: { '产品 / Dashboard': 0.8, 'UI 重构': 0.5 },
  });
  expect(t.primary).toBe('产品-Dashboard');
  expect(t.secondary).toEqual(['UI-重构']);
  expect(t.scores).toEqual({ '产品-Dashboard': 0.8, 'UI-重构': 0.5 });
});
