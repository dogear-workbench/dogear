/**
 * 视觉路由：主会话（无视觉模型）收到用户图片时，静默转派一次性视觉任务识图，
 * 描述文本替换原图进入主会话上下文。子会话/已标记视觉能力的模型不在此拦截。
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { PiSession } from './pi-session.js';
import { runOnce } from '../pi/run-once.js';
import { resolvePiModel } from '../pi/provider.js';
import { loadSettings } from '../../services/settings-service.js';
import { mainLogger } from '../logger.js';
import type { AppSettings, ModelSelection } from '../../services/settings-types.js';

export interface IncomingImage {
  media_type: string;
  data: string;
}

const logger = mainLogger.child('vision-shunt');

const VISION_PROMPT = [
  '请完整描述图片内容，供无法看图的主模型使用：',
  '1) 图片主体与场景；',
  '2) 图中出现的所有文字（照录原文，保持原有结构）；',
  '3) 界面元素、图表与数据要点；',
  '4) 其他重要细节。',
  '多张图片逐张描述，用「图 1」「图 2」区分。只输出描述本身，不要建议或评论。',
].join('\n');

function emitStatus(session: PiSession, status: string): void {
  session.emit('message', { type: 'status', status, timestamp: Date.now() });
}

function toImageContent(images: IncomingImage[]): ImageContent[] {
  return images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.media_type }));
}

/** 模型清单条目的视觉能力标记（未标记 = 假定无视觉，走转派兜底） */
function modelSupportsVision(profiles: AppSettings['profiles'], selection: ModelSelection | null): boolean {
  if (!selection) return false;
  const entry = profiles[selection.profileId]?.piModels?.find((m) => m.id === selection.tier);
  return entry?.supportsVision === true;
}

/** 识图转派目标：显式 visionModelSelection 优先，否则取模型清单里第一个标记 supportsVision 的模型 */
function resolveVisionSelection(appSettings: AppSettings): ModelSelection | null {
  const explicit = appSettings.ai.visionModelSelection;
  if (explicit) return explicit;
  for (const profile of Object.values(appSettings.profiles)) {
    const hit = profile.piModels?.find((m) => m.supportsVision === true);
    if (hit) return { profileId: profile.id, tier: hit.id };
  }
  return null;
}

/**
 * 带图消息路由。返回 null = 无需转派（无图/子会话/当前模型有视觉），调用方走原逻辑；
 * 返回 blocks = 替换后的纯文本块（描述注入），调用方直接 sendMessage。
 */
export async function routeImageMessage(params: {
  session: PiSession;
  textBlocks: ContentBlockParam[];
  images: IncomingImage[];
}): Promise<ContentBlockParam[] | null> {
  const { session, textBlocks, images } = params;
  if (images.length === 0) return null;
  if (session.getRole() !== 'main') return null;

  const appSettings = await loadSettings();
  if (modelSupportsVision(appSettings.profiles, session.getCurrentModelSelection())) return null;

  const visionSelection = resolveVisionSelection(appSettings);
  if (!visionSelection) {
    emitStatus(session, '当前模型无视觉能力，且未配置识图转派模型（设置 → 基础设置，或在模型清单为视觉模型勾选「视觉」），图片无法识读');
    return textBlocks.length > 0
      ? textBlocks
      : [{ type: 'text', text: '[系统] 本消息只包含图片，当前模型无视觉能力且未配置识图转派模型，无法处理。请配置识图模型后重新发送。' }];
  }

  emitStatus(session, `当前模型无视觉能力，图片已转派 ${visionSelection.tier} 识图中…`);

  try {
    const { model, profile } = resolvePiModel(appSettings, visionSelection, null, null);
    const result = await runOnce({
      prompt: VISION_PROMPT,
      images: toImageContent(images),
      tools: [],
      model,
      profile,
      maxTurns: 1,
    });
    if (!result.ok || !result.lastText) {
      const reason = result.ok ? '模型未返回描述' : result.error;
      logger.warn('识图转派失败:', reason);
      emitStatus(session, `识图转派失败：${reason}；消息已按纯文本发送，图片未进入上下文`);
      return textBlocks.length > 0
        ? textBlocks
        : [{ type: 'text', text: '[系统] 本消息只包含图片，识图转派失败，无法处理。请重新发送或改用文字描述。' }];
    }

    emitStatus(session, '识图完成，已把图片描述注入会话上下文');
    const descriptionBlock: ContentBlockParam = {
      type: 'text',
      text: `[系统] 本消息附带 ${images.length} 张图片。当前主模型无视觉能力，已自动转派视觉模型（${visionSelection.tier}）识读，描述如下：\n<image_description>\n${result.lastText}\n</image_description>`,
    };
    return [descriptionBlock, ...textBlocks];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('识图转派异常:', message);
    emitStatus(session, `识图转派失败：${message}；消息已按纯文本发送，图片未进入上下文`);
    return textBlocks.length > 0
      ? textBlocks
      : [{ type: 'text', text: '[系统] 本消息只包含图片，识图转派失败，无法处理。请重新发送或改用文字描述。' }];
  }
}
