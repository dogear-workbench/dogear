/**
 * 子会话派遣相关类型（Phase 2）
 * 前端与主进程共用。主进程镜像在 electron/main/types.ts。
 */

export type ChildStatus =
  | 'running'      // 子会话仍在跑
  | 'done'         // 已 SubmitDelivery
  | 'failed'       // agent 跑挂了或内部异常
  | 'timeout'      // 超过 subAgent.timeoutMinutes
  | 'cancelled'    // 用户/父会话主动停
  | 'no_delivery'; // 子会话自然结束但没调 SubmitDelivery

export interface DelegateSpec {
  /** 委派给子会话的任务描述（自然语言） */
  task: string;
  /** 子会话必须把交付物写到共享区的这个相对路径 */
  outputPath: string;
  /** 子会话标题，缺省由 bridge 生成 */
  title?: string;
}

export interface DeliveryResult {
  childId: string;
  status: ChildStatus;
  outputPath: string;
  title: string;
  /** SubmitDelivery 时由子 agent 写入的一句话总结 */
  summary?: string;
  /** failed / timeout / cancelled 时的原因 */
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
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
  startedAt: number;
  finishedAt?: number;
  summary?: string;
  errorMessage?: string;
}
