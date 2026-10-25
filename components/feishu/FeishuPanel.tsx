import { useEffect, useState } from 'react';
import { Bot, BellRing, Loader2, MessagesSquare, MessageSquare, RefreshCw, Terminal, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useFeishuStore } from '@/stores/feishu-store';
import { showConfirm } from '@/stores/confirm-store';
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
  { command: '/debug card', description: '发送卡片回调测试卡，验证按钮交互链路' },
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
  const refreshBotStatus = useFeishuStore((s) => s.refreshBotStatus);
  const initialize = useFeishuStore((s) => s.initialize);
  const topicChatId = useFeishuStore((s) => s.topicChatId);
  const createTopicChat = useFeishuStore((s) => s.createTopicChat);
  const resetTopicChat = useFeishuStore((s) => s.resetTopicChat);
  const notifyPush = useFeishuStore((s) => s.notifyPush);
  const setNotifyPush = useFeishuStore((s) => s.setNotifyPush);
  const [reconnecting, setReconnecting] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);

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
  const chatBindings = botStatus?.chatBindings ?? [];

  const handleResetTopicChat = async () => {
    const ok = await showConfirm(
      '重置话题工作群',
      '清除群内全部绑定并重发管理卡，群内旧话题保留但解绑，再发消息将创建新会话；不会新建群。',
    );
    if (!ok) return;
    setCreatingGroup(true);
    const res = await resetTopicChat();
    if (!res.success) {
      toast.error('重置话题工作群失败', { description: res.error });
    } else {
      toast.success('话题工作群已重置', { description: '管理卡已重发，旧话题已解绑' });
    }
    setCreatingGroup(false);
  };

  const handleCreateTopicChat = async (rebuild = false) => {
    if (rebuild) {
      const ok = await showConfirm(
        '新建话题工作群',
        '将创建一个全新的群并替换当前群；旧群可在飞书中自行删除，群内绑定过的会话仍保留在应用内。',
      );
      if (!ok) return;
    }
    setCreatingGroup(true);
    const res = await createTopicChat();
    if (!res.success) {
      toast.error(rebuild ? '重建话题工作群失败' : '创建话题工作群失败', { description: res.error });
    } else {
      toast.success(rebuild ? '话题工作群已重建' : '话题工作群已创建', {
        description: rebuild ? '已在新群发送管理卡，旧群绑定已解除' : '已发送邀请和管理卡，到飞书查看即可开始使用',
      });
    }
    setCreatingGroup(false);
  };

  return (
    <div className="h-full flex flex-col">
      {!configExists ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto py-6 px-6">
            <FeishuSetupGuide />
          </div>
        </div>
      ) : (
        <Tabs defaultValue="usage" className="h-full flex flex-col">
          <div className="w-full max-w-4xl mx-auto px-6 flex-shrink-0">
            <TabsList variant="underline" className="w-full justify-start">
              <TabsTrigger variant="underline" value="usage">使用</TabsTrigger>
              <TabsTrigger variant="underline" value="guide">配置引导</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="usage" className="flex-1 mt-0 overflow-y-auto data-[state=inactive]:hidden">
            <div className="max-w-4xl mx-auto py-6 px-6 flex flex-col gap-6">
              {/* 连接状态 */}
              <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                <Bot className="w-10 h-10 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{botName || '飞书 Bot'}</span>
                    <Badge variant={badge.variant} className={badge.className}>
                      {badge.label}
                    </Badge>
                  </div>
                  {connectionError ? (
                    <div className="text-xs text-destructive break-all">{connectionError}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {connectionState === 'connected' && '正在监听私聊与话题群消息'}
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
                {/* 左栏：绑定一览 */}
                <div className="lg:col-span-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                    <MessageSquare className="w-4 h-4" />
                    绑定一览
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="ml-auto text-muted-foreground"
                      title="刷新"
                      onClick={() => void refreshBotStatus()}
                    >
                      <RefreshCw />
                    </Button>
                  </div>
                  {botStatus?.status && (
                    <div className="rounded-lg border p-3 space-y-1 mb-3">
                      <div className="text-sm font-medium truncate">
                        {botStatus.status.workspaceName || '未选择工作区'}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {botStatus.status.conversationTitle ??
                          (botStatus.status.pendingNew ? '待新建：发送消息即创建' : '发送消息即创建')}
                      </div>
                    </div>
                  )}
                  {chatBindings.length > 0 ? (
                    <div className="space-y-3">
                      {chatBindings.map((chat) => (
                        <div key={chat.chatId} className="rounded-lg border overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                            <span className="text-sm font-medium truncate">
                              {chat.workspaceName ?? '工作区已删除'}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {chat.groupTitle ?? '待首次新建会话自动创建'}
                            </span>
                            <Badge
                              variant="outline"
                              className={`ml-auto shrink-0 ${
                                chat.hasManageCard
                                  ? 'text-green-600 border-green-600/40'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {chat.hasManageCard ? '管理卡已置顶' : '管理卡未发送'}
                            </Badge>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatUpdatedAt(chat.lastActiveAt)}
                            </span>
                          </div>
                          {chat.threadBindings.length > 0 ? (
                            <div className="divide-y">
                              {chat.threadBindings.map((b) => (
                                <div key={b.threadId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                                  <span
                                    className={`flex-1 truncate ${b.conversationTitle ? '' : 'text-muted-foreground'}`}
                                  >
                                    {b.conversationTitle ?? '会话已删除'}
                                  </span>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {formatUpdatedAt(b.lastActiveAt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground px-3 py-3 text-center">
                              群内暂无会话
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground border rounded-lg px-3 py-8 text-center">
                      在飞书话题群内发消息后自动出现在这里
                    </div>
                  )}
                </div>

                {/* 右栏：话题工作群 + 通知推送 + 命令参考 */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                      <MessagesSquare className="w-4 h-4" />
                      话题工作群
                    </div>
                    <div className="rounded-lg border p-3 text-xs space-y-2">
                      {topicChatId ? (
                        <>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-green-600 text-white border-green-600">
                              已创建
                            </Badge>
                            <span className="text-muted-foreground font-mono truncate">{topicChatId}</span>
                          </div>
                          <p className="text-muted-foreground">
                            群内直接聊天，无需命令。置顶的管理卡可切换工作区、话题，或打开已有会话。
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={creatingGroup || connectionState !== 'connected'}
                              onClick={() => void handleResetTopicChat()}
                            >
                              {creatingGroup ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                              重置本群
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              disabled={creatingGroup || connectionState !== 'connected'}
                              onClick={() => void handleCreateTopicChat(true)}
                            >
                              新建群
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <Button size="sm" disabled={creatingGroup || connectionState !== 'connected'} onClick={() => void handleCreateTopicChat()}>
                            {creatingGroup ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <MessagesSquare className="w-3.5 h-3.5 mr-1.5" />}
                            创建话题工作群
                          </Button>
                          <p className="text-muted-foreground">
                            创建一个话题形式群，把你拉入并自动发送置顶管理卡。需先连接并在飞书私聊机器人发过消息。
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                      <BellRing className="w-4 h-4" />
                      通知推送
                    </div>
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">推送到飞书</span>
                        <Switch
                          checked={notifyPush}
                          onCheckedChange={(v) => {
                            void setNotifyPush(v).then((res) => {
                              if (!res.success) {
                                toast.error('设置通知推送失败', { description: res.error });
                              }
                            });
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        重要事件（任务待审核/中断/失败、浏览器移交等）主动推送：有话题绑定的会话推进对应话题，其余私聊发送。
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                      <Terminal className="w-4 h-4" />
                      私聊命令
                    </div>
                    <div className="rounded-lg border divide-y">
                      {BOT_COMMANDS.map((cmd) => (
                        <div key={cmd.command} className="flex gap-3 px-3 py-1.5 text-sm">
                          <code className="text-primary font-mono w-20 flex-shrink-0">{cmd.command}</code>
                          <span className="text-xs text-muted-foreground">{cmd.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    在飞书中私聊机器人发送文本，将转发给当前对话的 Agent，回复以卡片消息返回。
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="guide" className="flex-1 mt-0 overflow-y-auto data-[state=inactive]:hidden">
            <div className="max-w-2xl mx-auto py-6 px-6">
              <FeishuSetupGuide />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
