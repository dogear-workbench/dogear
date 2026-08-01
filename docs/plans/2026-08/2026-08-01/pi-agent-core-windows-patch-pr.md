# Upstream PR 草稿：pi-agent-core Windows 路径兼容

> 目标仓库：`github.com/earendil-works/pi`，子目录 `packages/agent`
> 对应 `@earendil-works/pi-agent-core`
> 当前验证版本：0.82.1

## Title

`fix(harness): make path utilities cross-platform on Windows`

## Summary

Four path utility functions and one FileInfo helper in the harness layer assume POSIX-only path separators (`/`). On Windows, where `path.resolve` returns `\`-separated paths, `loadSkills` crashes with `RangeError: path should be a \`path.relative()\`d string` from the `ignore` library, and even when it doesn't crash, `FileInfo.name` is the full absolute path instead of the basename — silently breaking skill discovery.

## Problem

### Symptom 1: `loadSkills` crashes on Windows

```
RangeError: path should be a `path.relative()`d string, but got "C:\dogear\.claude\skills\brainstorming/"
    at throwError (.../ignore/index.js:557:9)
    at checkPath (.../ignore/index.js:576:12)
    at Ignore.ignores (.../ignore/index.js:720:17)
    at loadSkillsFromDirInternal (.../pi-agent-core/dist/harness/skills.js:112:27)
```

Trigger: any Windows user calling `loadSkills(env, dirs)` where `dirs` contains a parent directory with skill subdirectories (the standard `.claude/skills/<name>/SKILL.md` layout). Flat layout (`dir/SKILL.md` directly) does **not** trigger this — only the recursive scan does.

### Symptom 2: `FileInfo.name` contains the full absolute path on Windows

Even after working around symptom 1, `loadSkills` silently returns 0 skills because the first-loop check `entry.name !== "SKILL.md"` never matches — `entry.name` is the full Windows path (`C:\...\SKILL.md`), not `"SKILL.md"`.

Affects every consumer of `NodeExecutionEnv.fileInfo()` / `.listDir()` on Windows.

## Root cause

Five spots in the harness layer compute path-derived values by splitting on or stripping `/` only:

| File | Function | Issue |
|------|----------|-------|
| `harness/skills.ts` | `joinEnvPath` | only strips trailing `/` |
| `harness/skills.ts` | `dirnameEnvPath` | only `lastIndexOf("/")` |
| `harness/skills.ts` | `basenameEnvPath` | only `lastIndexOf("/")` |
| `harness/skills.ts` | `relativeEnvPath` | `startsWith` only matches `/`-joined root; fallback doesn't strip absolute prefix |
| `harness/env/nodejs.ts` | `fileInfoFromStats` | `path.split("/").pop()` returns full path on Windows |
| `harness/prompt-templates.ts` | `basenameEnvPath` (duplicate) | only `lastIndexOf("/")` |

`NodeExecutionEnv` internally uses Node's `path.resolve`, which on Windows produces `\`-separated paths. The harness path utilities never normalize, so any `\` flows straight through and breaks the POSIX-only regex / split / indexOf logic.

## Fix

Normalize `\` to `/` at the start of each affected function. Minimal, no behavior change on POSIX systems.

```diff
 function joinEnvPath(base, child) {
-    return `${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
+    return `${base.replace(/\\/g, "/").replace(/\/+$/, "")}/${child.replace(/\\/g, "/").replace(/^\/+/, "")}`;
 }
 function dirnameEnvPath(path) {
-    const normalized = path.replace(/\/+$/, "");
+    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
     const slashIndex = normalized.lastIndexOf("/");
     return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
 }
 function basenameEnvPath(path) {
-    const normalized = path.replace(/\/+$/, "");
+    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
     const slashIndex = normalized.lastIndexOf("/");
     return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
 }
 function relativeEnvPath(root, path) {
-    const normalizedRoot = root.replace(/\/+$/, "");
-    const normalizedPath = path.replace(/\/+$/, "");
+    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
+    const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
     ...
 }
```

```diff
 function fileInfoFromStats(path, stats) {
     ...
     return ok({
-        name: path.replace(/\/+$/, "").split("/").pop() ?? path,
+        name: path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path,
         path,
         ...
     });
 }
```

(Same one-liner for the duplicate `basenameEnvPath` in `prompt-templates.ts`.)

## Reproduction (Windows)

```js
import { loadSkills } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';

const env = new NodeExecutionEnv({ cwd: process.cwd() });

// Any dir with subdirs containing SKILL.md triggers this on Windows
const { skills, diagnostics } = await loadSkills(env, ['C:\\Users\\me\\.claude\\skills']);
// Without patch: RangeError thrown
// With patch: skills array populated correctly
```

## Why this approach

- **Minimal**: each fix is a single `.replace(/\\/g, "/")` prepend; no logic change on POSIX.
- **At the source**: normalizes once at the boundary, downstream regex/split/indexOf all work unchanged.
- **No env wrapper shenanigans**: callers shouldn't have to wrap `NodeExecutionEnv` to make `loadSkills` work cross-platform.
- **Doesn't address WSL `/mnt/c/` paths**: that's a separate concern (different package, different function — `pi-coding-agent/utils/paths.js#resolvePath`). This PR is strictly about `\` separator handling in the harness layer.

## Test plan

- [ ] `loadSkills` round-trip on Windows + `<dir>/<name>/SKILL.md` layout → skills discovered
- [ ] `loadSkills` round-trip on macOS/Linux → unchanged behavior
- [ ] `NodeExecutionEnv.listDir` returns FileInfo with correct `name` (basename) on Windows
- [ ] `formatSkillInvocation` `References are relative to` segment shows correct dirname on Windows
- [ ] Existing vitest harness suite (`bun test:harness`) still green on POSIX

## Notes

- Discovered while integrating `loadSkills` into a Windows Electron app (Dogear)
- Local verification: applied as `bun patch` against `@earendil-works/pi-agent-core@0.82.1`, 8 skills discovered correctly post-fix, no RangeError
- Happy to add a vitest case if you point me at the preferred location/format for cross-platform path tests
