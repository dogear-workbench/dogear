import { describe, test, expect } from 'bun:test';
import {
  isUserPathChecked,
  isUserPathCoveredByAncestor,
  hasUserPathCheckedDescendant,
  toggleUserSyncPath,
  userSyncPathsListEqual,
  userSyncPathsForWorkspaces,
} from './user-sync-paths';

describe('isUserPathChecked（整树覆盖语义）', () => {
  test('自身在列 → 勾', () => {
    expect(isUserPathChecked(['docs'], 'docs')).toBe(true);
  });

  test('祖先在列 → 勾（子树覆盖）', () => {
    expect(isUserPathChecked(['docs'], 'docs/plans/a.md')).toBe(true);
  });

  test('自身与祖先都不在列 → 不勾', () => {
    expect(isUserPathChecked(['docs'], 'src')).toBe(false);
  });

  test('兄弟前缀不误判（docs2 与 docs 无关）', () => {
    expect(isUserPathChecked(['docs'], 'docs2/a.md')).toBe(false);
  });
});

describe('isUserPathCoveredByAncestor', () => {
  test('自身在列不算被祖先覆盖', () => {
    expect(isUserPathCoveredByAncestor(['docs'], 'docs')).toBe(false);
  });

  test('真祖先在列 → 覆盖', () => {
    expect(isUserPathCoveredByAncestor(['docs'], 'docs/sub')).toBe(true);
  });
});

describe('hasUserPathCheckedDescendant', () => {
  test('子孙在列 → 半选依据', () => {
    expect(hasUserPathCheckedDescendant(['docs/a.md'], 'docs')).toBe(true);
  });

  test('自身在列不算子孙', () => {
    expect(hasUserPathCheckedDescendant(['docs'], 'docs')).toBe(false);
  });
});

describe('toggleUserSyncPath', () => {
  test('on：追加自身并清掉子孙冗余条目', () => {
    expect(toggleUserSyncPath(['docs/a.md', 'src'], 'docs', true)).toEqual(['src', 'docs']);
  });

  test('off：移除自身及全部子孙', () => {
    expect(toggleUserSyncPath(['docs', 'docs/a.md', 'src'], 'docs', false)).toEqual(['src']);
  });

  test('on 已存在 → 幂等', () => {
    expect(toggleUserSyncPath(['docs'], 'docs', true)).toEqual(['docs']);
  });

  test('off 不存在 → 原样返回', () => {
    expect(toggleUserSyncPath(['src'], 'docs', false)).toEqual(['src']);
  });
});

describe('userSyncPathsListEqual', () => {
  test('顺序无关相等', () => {
    expect(userSyncPathsListEqual(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(userSyncPathsListEqual(['a'], ['a', 'b'])).toBe(false);
    expect(userSyncPathsListEqual([], [])).toBe(true);
  });
});

describe('userSyncPathsForWorkspaces', () => {
  test('缺省键回空数组', () => {
    expect(userSyncPathsForWorkspaces(undefined, 'ws-a')).toEqual([]);
    expect(userSyncPathsForWorkspaces({ 'ws-b': ['docs'] }, 'ws-a')).toEqual([]);
    expect(userSyncPathsForWorkspaces({ 'ws-a': ['docs'] }, 'ws-a')).toEqual(['docs']);
  });
});
