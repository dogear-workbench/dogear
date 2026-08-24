import { test, expect } from 'bun:test';
import { matchByThreshold, pickRedistributeCandidates, normalizeTag, normalizeTags, collectSweepTargets } from './smart-category-engine.ts';
import type { SmartCategory, DigestTags } from '../../types.ts';

const cats: SmartCategory[] = [
  { id: 'c1', name: '产品', anchorTags: ['产品-Dashboard', 'UI重构'], groupIds: [], createdAt: '', updatedAt: '' },
  { id: 'c2', name: '股票', anchorTags: ['股票-估值'], groupIds: [], createdAt: '', updatedAt: '' },
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
  const more = [...cats, { id: 'c3', name: '代码', anchorTags: ['UI重构'], groupIds: ['x'], createdAt: '', updatedAt: '' }];
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

test('normalizeTag 剥前后缀 dash', () => {
  expect(normalizeTag('/ Dashboard')).toBe('Dashboard');
  expect(normalizeTag('React/')).toBe('React');
  expect(normalizeTag('-- hello --')).toBe('hello');
});

test('normalizeTag 纯空白返回空字符串', () => {
  expect(normalizeTag('   ')).toBe('');
  expect(normalizeTag('')).toBe('');
});

test('normalizeTags 处理 scores 冲突（保留较大分数 + 过滤空标签）', () => {
  const t = normalizeTags({
    primary: '产品-Dashboard',
    secondary: ['', '   ', '产品/Dashboard'],
    scores: {
      '产品 / Dashboard': 0.5,
      '产品/Dashboard': 0.8,
      '产品-Dashboard': 0.6,
      '   ': 0.9, // 空标签的 score 应被过滤
    },
  });
  expect(t.secondary).toEqual(['产品-Dashboard']); // 空标签过滤掉
  expect(t.scores).toEqual({ '产品-Dashboard': 0.8 }); // 三个 key 归一化为同一个，取 max
});

test('matchByThreshold primary 与 secondary 重复时不双计', () => {
  const singleCat: SmartCategory[] = [
    { id: 'c1', name: 'A', anchorTags: ['t1'], groupIds: [], createdAt: '', updatedAt: '' },
  ];
  const tags: DigestTags = {
    primary: 't1',
    secondary: ['t1'], // 重复
    scores: { t1: 0.6 },
  };
  const r = matchByThreshold(tags, singleCat, 0.5);
  expect(r).toHaveLength(1);
  expect(r[0].score).toBeCloseTo(0.6); // 不是 1.2
});

test('pickRedistributeCandidates 同 overlap 时按 id 字典序', () => {
  const tieCats: SmartCategory[] = [
    { id: 'c_b', name: 'B', anchorTags: ['t1'], groupIds: [], createdAt: '', updatedAt: '' },
    { id: 'c_a', name: 'A', anchorTags: ['t1'], groupIds: [], createdAt: '', updatedAt: '' },
    { id: 'c_c', name: 'C', anchorTags: ['t1'], groupIds: [], createdAt: '', updatedAt: '' },
  ];
  const r = pickRedistributeCandidates(tieCats, ['t1']);
  expect(r).toHaveLength(2);
  expect(r.map((x) => x.categoryId)).toEqual(['c_a', 'c_b']); // 字典序前两个
});

test('collectSweepTargets 差集：归档/已挂载剔除，无 tags 只计数', () => {
  const entries = [
    { groupId: 'g1', hasTags: true, archived: false, digestPath: '/p/g1/digest.md' },
    { groupId: 'g2', hasTags: true, archived: false, digestPath: '/p/g2/digest.md' },
    { groupId: 'g3', hasTags: false, archived: false, digestPath: '/p/g3/digest.md' },
    { groupId: 'g4', hasTags: true, archived: true, digestPath: '/p/g4/digest.md' },
    { groupId: 'g5', hasTags: false, archived: true, digestPath: '/p/g5/digest.md' },
  ];
  const r = collectSweepTargets(entries, new Set(['g1']));
  expect(r.sweep).toEqual([{ groupId: 'g2', digestPath: '/p/g2/digest.md' }]);
  expect(r.noTags).toBe(1);
  expect(r.archived).toBe(2);
});

test('collectSweepTargets 差集为空返回空 sweep', () => {
  const entries = [{ groupId: 'g1', hasTags: true, archived: false, digestPath: '/p/g1/digest.md' }];
  const r = collectSweepTargets(entries, new Set(['g1']));
  expect(r.sweep).toEqual([]);
  expect(r.noTags).toBe(0);
  expect(r.archived).toBe(0);
});

test('collectSweepTargets 已挂载的无 tags 组不计 noTags', () => {
  const entries = [{ groupId: 'g1', hasTags: false, archived: false, digestPath: '/p/g1/digest.md' }];
  const r = collectSweepTargets(entries, new Set(['g1']));
  expect(r.sweep).toEqual([]);
  expect(r.noTags).toBe(0);
});
