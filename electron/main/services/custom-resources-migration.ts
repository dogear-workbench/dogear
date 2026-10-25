/**
 * custom/ 统一自定义区一次性迁移：skills/ → custom/skills/；并清理话题状态卡退役后的死文件
 *
 * 幂等策略（绝不丢数据）：
 * - 旧不存在 → 跳过；新不存在 → rename（跨盘 EXDEV 时 copy + rm）
 * - 新已存在同名 → 旧侧改名 .legacy 留档并 console.warn，不自动合并
 * - skills/ 迁空后删除旧目录
 * - README.md 仅首次写入（wx flag），用户改过不覆盖
 */
import fs from 'node:fs/promises';
import path from 'node:path';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function movePath(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

async function migrateEntry(oldPath: string, newPath: string): Promise<void> {
  if (!(await pathExists(oldPath))) return;
  if (await pathExists(newPath)) {
    const legacyPath = `${oldPath}.legacy`;
    await fs.rename(oldPath, legacyPath);
    console.warn(`[custom-resources-migration] ${newPath} 已存在同名，旧侧保留为 ${legacyPath}，请手动合并`);
    return;
  }
  await movePath(oldPath, newPath);
}

async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length > 0) return;
    await fs.rmdir(dir);
  } catch {
    // 目录不存在或被占用删除失败均不影响启动
  }
}

const CUSTOM_README = `# custom/ — 用户自定义资源区

本目录是应用唯一由你自由修改的自定义区，整目录纳入设备同步（可在「设置 → 数据中心」关闭）。
应用内置资产不放在这里、不参与同步；有内置源的资产遵循「删除副本即回内置」。

## 目录结构

- skills/ — 自定义 skills（每项一个子目录，含 SKILL.md），在能力面板「自定义」分组勾选启用
- prompts/ — 自定义提示词模板（当前无内置消费者，供用户自建与手动引用）
- browser-extensions/ — 浏览器扩展自定义副本（从内置 extension/ 复制而来）；删除后浏览器加载回内置目录

## mcp.json（预留，本期未实现加载）

本目录预留 \`mcp.json\` 作为未来自定义 MCP server 的配置位。当前版本不会读取该文件，
创建它不会有任何效果。schema 将来会在此处补充说明，届时无需迁移已有文件。
`;

export async function migrateCustomResourcesIfNeeded(configDir: string): Promise<void> {
  const customDir = path.join(configDir, 'custom');
  await fs.mkdir(path.join(customDir, 'skills'), { recursive: true });
  await fs.mkdir(path.join(customDir, 'prompts'), { recursive: true });
  await fs.mkdir(path.join(customDir, 'browser-extensions'), { recursive: true });
  await fs.writeFile(path.join(customDir, 'README.md'), CUSTOM_README, { flag: 'wx' }).catch(() => {});

  const oldSkillsDir = path.join(configDir, 'skills');
  if (await pathExists(oldSkillsDir)) {
    for (const name of await fs.readdir(oldSkillsDir)) {
      await migrateEntry(path.join(oldSkillsDir, name), path.join(customDir, 'skills', name));
    }
    await removeDirIfEmpty(oldSkillsDir);
  }

  // 话题状态卡已退役：custom/prompts/state-extract-prompt.md 的唯一消费方已删，无论内容/版本标记直接清掉
  await fs.rm(path.join(customDir, 'prompts', 'state-extract-prompt.md'), { force: true });
}
