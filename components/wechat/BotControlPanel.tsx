import { Bot, Terminal, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWechatStore } from '@/stores/wechat-store';

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

interface BotControlPanelProps {
  botName: string | null;
  polling: boolean;
  connectionError: string | null;
  onDisconnect: () => void;
}

export function BotControlPanel({ botName, polling, connectionError, onDisconnect }: BotControlPanelProps) {
  const autoInitData = useWechatStore((s) => s.autoInitData);
  const botUseConversation = useWechatStore((s) => s.botUseConversation);

  return (
    <div className="flex flex-col gap-4">
      {/* 连接状态 */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
        <Bot className="w-8 h-8 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{botName || '微信 Bot'}</div>
          {connectionError ? (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <WifiOff className="w-3 h-3" />
              <span>连接断开: {connectionError}</span>
            </div>
          ) : polling ? (
            <div className="flex items-center gap-1 text-xs text-green-600">
              <Wifi className="w-3 h-3" />
              <span>已连接，正在监听消息</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">连接中...</div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-xs">
          断开
        </Button>
      </div>

      {/* 当前工作区/对话状态 */}
      {autoInitData?.status && (
        <div className="text-xs text-muted-foreground px-1">
          <span>工作区: {autoInitData.status.workspaceName || '未选择'}</span>
          {autoInitData.status.conversationTitle && (
            <span className="ml-3">对话: {autoInitData.status.conversationTitle}</span>
          )}
        </div>
      )}

      {/* 对话列表 */}
      {autoInitData?.conversations && autoInitData.conversations.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground px-1">对话列表</div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {autoInitData.conversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm"
              >
                <span className="text-muted-foreground w-5 text-right text-xs">{conv.index}.</span>
                <span className="flex-1 truncate">{conv.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => { botUseConversation(conv.index); }}
                >
                  使用
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bot 命令参考 */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-1">
          <Terminal className="w-3 h-3" />
          Bot 命令参考
        </div>
        <div className="space-y-0 text-xs">
          {BOT_COMMANDS.map((cmd) => (
            <div key={cmd.command} className="flex gap-2 px-2 py-1 rounded hover:bg-muted/30">
              <code className="text-primary font-mono w-20 flex-shrink-0">{cmd.command}</code>
              <span className="text-muted-foreground">{cmd.description}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground px-2 pt-1">
          直接发送文本消息将转发给当前对话的 Agent。
        </p>
      </div>
    </div>
  );
}
