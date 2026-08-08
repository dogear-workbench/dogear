/**
 * Skill 模板服务（旧入口，已迁移到 skill-template-service.ts）
 *
 * 保留此文件仅为 IPC 层 import 路径兼容，实际逻辑全部委托给通用模板服务。
 * 注意：本服务**不**控制工具包是否注册——MCP server `dogear-stock-analysis`
 * 由 conversation-runtime-service 按 `enabledToolPacks` 注册，与 SKILL.md
 * 是否订阅完全独立。
 */

export {
  listSkillTemplates,
  subscribeSkillTemplate,
  restoreSkillTemplate,
  getTemplateContent,
} from './skill-template-service.js';
export type { SkillTemplateMeta } from './skill-template-service.js';
