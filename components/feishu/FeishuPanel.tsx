import { useEffect, useState } from 'react';
import { Bot, Loader2, MessageSquare, RefreshCw, Terminal, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFeishuStore } from '@/stores/feishu-store';
import { FeishuSetupGuide } from './FeishuSetupGuide';
import type { FeishuConnectionState } from '@/types/feishu';

const BOT_COMMANDS = [
  { command: '/help', description: '显示帮助信息' },
  { command: '/status', description: '查看当前状态（工作区、对话、Agent）' },
  { command: '/ws', description: '列出所有工作区' },
  { command: '/ws <n>', description: '切换到第 n 个工作区' },
  { command: '/ls', description: '列出当前工作区的对话' },
  { command: '/use <n>', description: '切换到第 n 个对话' },
  { command: '/new', description: '新建对话' },
  { command: '/stop', description: '中断当前 Agent 执行' },
  { command: '/debug', description: '开关调试模式（显示权限请求）' },
];

const STATE_BADGE: Record<FeishuConnectionState, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  connected: { label: '已连接', variant: 'default', className: 'bg-green-600 hover:bg-green-600' },
  connecting: { label: '连接中', variant: 'secondary', className: 'bg-amber-500 text-white hover:bg-amber-500' },
  error: { label: '连接错误', variant: 'destructive' },
  disconnected: { label: '未连接', variant: 'outline' },
};

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FeishuPanel() {
  const configExists = useFeishuStore((s) => s.configExists);
  const botName = useFeishuStore((s) => s.botName);
  const connectionState = useFeishuStore((s) => s.connectionState);
  const connectionError = useFeishuStore((s) => s.connectionError);
  const botStatus = useFeishuStore((s) => s.botStatus);
  const reconnect = useFeishuStore((s) => s.reconnect);
  const disconnect = useFeishuStore((s) => s.disconnect);
  const resetConfig = useFeishuStore((s) => s.resetConfig);
  const botUseConversation = useFeishuStore((s) => s.botUseConversation);
  const initialize = useFeishuStore((s) => s.initialize);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleReconnect = async () => {
    setReconnecting(true);
    const res = await reconnect();
    if (!res.success) {
      toast.error('重连失败', { description: res.error });
    }
    setReconnecting(false);
  };

  const badge = STATE_BADGE[connectionState];

  return (
    <div className="h-full overflow-y-auto">
      {!configExists ? (
        <div className="max-w-2xl mx-auto py-6 px-6">
          <FeishuSetupGuide />
        </div>
      ) : (
        <div className="max-w-4xl mx-auto py-6 px-6 flex flex-col gap-6">
          {/* 连接状态 */}
          <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
            <Bot className="w-10 h-10 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{botName || '飞书 Bot'}</span>
                <Badge variant={badge.variant} className={`${badge.className || ''} text-[10px] px-1.5 py-0`}>
                  {badge.label}
                </Badge>
              </div>
              {connectionError ? (
                <div className="text-xs text-destructive break-all">{connectionError}</div>
              ) : (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {connectionState === 'connected' && '正在监听私聊消息'}
                  {connectionState === 'connecting' && '正在建立长连接...'}
                  {connectionState === 'disconnected' && '长连接未建立'}
                  {connectionState === 'error' && '连接异常'}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={reconnecting} onClick={() => void handleReconnect()}>
                {reconnecting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                重连
              </Button>
              <Button variant="outline" size="sm" onClick={() => void disconnect()}>
                <Unplug className="w-3.5 h-3.5 mr-1.5" />
                断开
              </Button>
              {(connectionState === 'error' || connectionState === 'disconnected') && (
                <Button
                  variant="outline"
                  size="sm"
                  title="清除已保存的凭证，回到配置引导"
                  onClick={() => void resetConfig()}
                >
                  重新配置
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 左栏：当前绑定 + 对话列表 */}
            <div className="lg:col-span-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                <MessageSquare className="w-4 h-4" />
                对话
              </div>
              {botStatus?.status && (
                <div className="text-xs text-muted-foreground mb-2">
                  <span>工作区: {botStatus.status.workspaceName || '未选择'}</span>
                  {botStatus.status.conversationTitle && (
                    <span className="ml-3">对话: {botStatus.status.conversationTitle}</span>
                  )}
                </div>
              )}
              {botStatus?.conversations && botStatus.conversations.length > 0 ? (
                <div className="rounded-lg border divide-y">
                  {botStatus.conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`flex items-center gap-3 px-3 py-2 text-sm ${
                        conv.id === botStatus.status.conversationId ? 'bg-muted/60' : 'hover:bg-muted/40'
                      }`}
                    >
                      <span className="text-muted-foreground w-5 text-right text-xs">{conv.index}.</span>
                      <span className="flex-1 truncate">{conv.title}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">{formatUpdatedAt(conv.updatedAt)}</span>
                      {conv.id === botStatus.status.conversationId ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">当前</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs shrink-0"
                          onClick={() => {
                            void botUseConversation(conv.index).then((res) => {
                              if (!res.success) {
                                toast.error('切换对话失败', { description: res.error });
                              }
                            });
                          }}
                        >
                          使用
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground border rounded-lg px-3 py-8 text-center">
                  没有可选对话，在飞书里发送 /new 新建
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                只显示最近更新的主会话（前 10 个），子会话与执行会话不在此列；编号与飞书内 /use 命令一致。
              </p>
            </div>

            {/* 右栏：命令参考 */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                <Terminal className="w-4 h-4" />
                Bot 命令参考
              </div>
              <div className="rounded-lg border divide-y text-xs">
                {BOT_COMMANDS.map((cmd) => (
                  <div key={cmd.command} className="flex gap-3 px-3 py-1.5">
                    <code className="text-primary font-mono w-20 flex-shrink-0">{cmd.command}</code>
                    <span className="text-muted-foreground">{cmd.description}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                在飞书中私聊机器人发送文本，将转发给当前对话的 Agent，回复以卡片消息返回。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
