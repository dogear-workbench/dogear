import { describe, test, expect } from 'bun:test';
import {
  isUserPathChecked,
  isUserPathCoveredByAncestor,
  hasUserPathCheckedDescendant,
  toggleUserSyncPath,
  userSyncPathsListEqual,
  userSyncPathsForWorkspaces,
  buildSyncGitIndex,
  classifyGitPath,
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

describe('classifyGitPath（git 分组归类）', () => {
  const index = buildSyncGitIndex(
    ['src/index.ts', 'README.md', 'src/lib/util.ts'],
    ['node_modules', 'src/temp.log', 'dist'],
  );

  test('ignored 精确命中（折叠目录或文件）→ 外层', () => {
    expect(classifyGitPath('node_modules', index)).toBe('ignored');
    expect(classifyGitPath('dist', index)).toBe('ignored');
  });

  test('有 managed 后代的目录 → 折叠组（即使也含 ignored 后代）', () => {
    expect(classifyGitPath('src', index)).toBe('managed');
    expect(classifyGitPath('src/lib', index)).toBe('managed');
  });

  test('仅含 ignored 后代的目录 → 外层', () => {
    const onlyIgnored = buildSyncGitIndex(['a.ts'], ['pkg/sub/x.log']);
    expect(classifyGitPath('pkg', onlyIgnored)).toBe('ignored');
    expect(classifyGitPath('pkg/sub', onlyIgnored)).toBe('ignored');
  });

  test('两集合外（并发新文件）→ 保守归折叠组', () => {
    expect(classifyGitPath('newfile.txt', index)).toBe('managed');
    expect(classifyGitPath('newdir', index)).toBe('managed');
  });

  test('兄弟前缀不误判（docs2 与 docs 无关）', () => {
    const idx = buildSyncGitIndex(['docs/a.md'], []);
    expect(classifyGitPath('docs2', idx)).toBe('managed');
    expect(classifyGitPath('docs2/a.md', idx)).toBe('managed');
  });
});
