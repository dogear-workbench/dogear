/**
 * 契约通道校验（Agent 协作模式，Step 2）
 * 判断两个会话之间是否存在直接派出关系，允许通过 SendMessage / StopSession 通信。
 * 只认直接关系（不递归）：A 派 B 派 C，A 不能直接联系 C。
 */
import * as conversationService from './conversation-service.js';

export async function hasDirectContractChannel(
  fromSessionId: string,
  toSessionId: string,
): Promise<boolean> {
  const [fromRes, toRes] = await Promise.all([
    conversationService.getBySessionId(fromSessionId),
    conversationService.getBySessionId(toSessionId),
  ]);
  if (!fromRes || !toRes) return false;

  const { conv: from } = fromRes;
  const { conv: to } = toRes;

  if (to.contractMetadata?.parentSessionId === fromSessionId) return true; // from 派出了 to
  if (from.contractMetadata?.parentSessionId === toSessionId) return true; // to 派出了 from
  return false;
}
