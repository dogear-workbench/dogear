/**
 * 会话启动时加载核心档案
 *
 * 文件不存在 / 为空 / 读取失败 → 返回 null，buildSystemPrompt 不拼接。
 * 文件超过 2000 字符 → 记警告日志，仍然返回完整内容。
 * 任何异常都 catch，避免记忆系统崩溃拖垮会话启动。
 */
import { getCoreProfile } from './memory-service.js';

const WARN_THRESHOLD = 2000;

/**
 * 加载核心档案并返回 systemPrompt 可直接拼接的字符串。
 * 返回 null 时调用方跳过拼接。
 */
export async function loadCoreProfileForSession(workspacePath: string): Promise<string | null> {
  if (!workspacePath) return null;

  try {
    const profile = await getCoreProfile(workspacePath);
    if (!profile) return null;
    const body = profile.content.trim();
    if (!body) return null;

    if (body.length > WARN_THRESHOLD) {
      console.warn(
        `[memory-loader] core-profile 超过 ${WARN_THRESHOLD} 字符（${body.length}），仍注入但建议精简`
      );
    }

    return `\n---\n\n## 用户画像（自动加载）\n\n${body}\n\n---\n`;
  } catch (err) {
    console.warn('[memory-loader] 加载 core-profile 失败，跳过注入:', err);
    return null;
  }
}
