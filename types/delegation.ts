/**
 * Agent 协作模式相关类型（Step 2：通信 API 重构）
 * 前端与主进程共用。主进程镜像在 electron/main/types.ts。
 */

export type ChildStatus =
  | 'running'      // 会话仍在跑
  | 'stopped';     // 不在跑（死因见 lastError）

/** stopped 时的死因（调度内部字段，不进快照） */
export type ChildTerminalReason = 'failed' | 'hang' | 'timeout' | 'cancelled' | 'no_delivery';

export interface DelegateSpec {
  /** 委派给新会话的任务描述（自然语言） */
  task: string;
  /** 建议新会话把交付物写到共享区的这个相对路径（内容较长时使用） */
  outputPath: string;
  /** 新会话标题，缺省由 bridge 生成 */
  title?: string;
  /** 子会话 Profile 名称或 id；未指定时用默认 Profile */
  profile?: string;
}

export interface ChildStateSnapshot {
  childId: string;
  parentConversationId: string;
  groupId: string;
  outputPath: string;
  /** 派遣时的任务描述（与 startChild 时 DelegateSpec.task 一致） */
  task: string;
  title: string;
  status: ChildStatus;
  /** 交付事实（dogear__SendMessage delivery:true 单调落上，与状态机独立） */
  delivered: boolean;
  startedAt: number;
  finishedAt?: number;
  /** stopped 时的死因文本 */
  lastError?: string;
  /** 实际命中的子会话 Profile 名（匹配不到时为 fallback 的「默认」） */
  profileName: string;
  /** 该会话自身的 Harness sessionId；attachConversation 完成、PiSession 启动后立即同步赋值 */
  sessionId?: string;
  /** 最近一次流事件时间戳（滑动 idle 计时打点，检测 hang 用） */
  lastActivityAt?: number;
}
