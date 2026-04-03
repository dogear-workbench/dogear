import { useEffect } from 'react';
import { Unplug, Wifi, WifiOff, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWechatStore } from '@/stores/wechat-store';
import { rendererEvents } from '@/lib/events';
import { QRCodeAuth } from '@/components/wechat/QRCodeAuth';

export default function WechatPage() {
  const {
    authState,
    qrCode,
    botName,
    polling,
    connectionError,
    loadAuthStatus,
    startAuth,
    disconnect,
    startPolling,
    handleAuthStatusChange,
    handleConnectionStatusChange,
  } = useWechatStore();

  // 初始化
  useEffect(() => { loadAuthStatus(); }, [loadAuthStatus]);

  // 认证成功后启动轮询
  useEffect(() => {
    if (authState === 'connected') {
      startPolling();
    }
  }, [authState, startPolling]);

  // 监听 renderer events
  useEffect(() => {
    const unsubs = [
      rendererEvents.wechatAuthStatus.listen((data) => {
        handleAuthStatusChange(data.state, data.botName, data.errorMessage);
      }),
      rendererEvents.wechatConnectionStatus.listen((data) => {
        handleConnectionStatusChange(data.polling, data.lastPollAt, data.errorMessage);
      }),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [handleAuthStatusChange, handleConnectionStatusChange]);

  // 未认证：显示 QR 码
  if (authState !== 'connected') {
    return (
      <div className="h-screen flex flex-col bg-background">
        <header className="flex items-center px-4 h-12 border-b shrink-0">
          <h1 className="text-sm font-medium">微信遥控</h1>
        </header>
        <QRCodeAuth authState={authState} qrCode={qrCode} onStartAuth={startAuth} />
      </div>
    );
  }

  // 已认证：只显示连接状态
  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
        <h1 className="text-sm font-medium">{botName || '微信遥控'}</h1>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={disconnect} className="text-xs gap-1">
          <Unplug className="w-3.5 h-3.5" />
          断开
        </Button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        <Bot className="w-16 h-16 text-muted-foreground" />

        {/* 连接状态 */}
        {connectionError ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-destructive">
              <WifiOff className="w-5 h-5" />
              <span className="text-sm font-medium">连接断开</span>
            </div>
            <p className="text-xs text-muted-foreground max-w-xs text-center">{connectionError}</p>
          </div>
        ) : polling ? (
          <div className="flex items-center gap-2 text-green-600">
            <Wifi className="w-5 h-5" />
            <span className="text-sm font-medium">已连接，正在监听消息</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2Icon className="w-5 h-5 animate-spin" />
            <span className="text-sm">连接中...</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center max-w-xs">
          在手机微信向 Bot 发送消息即可远程控制 Dogear。
          {'\n'}发送 /help 查看可用命令。
        </p>
      </div>
    </div>
  );
}

// 内联 Loader2 避免额外 import
function Loader2Icon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
