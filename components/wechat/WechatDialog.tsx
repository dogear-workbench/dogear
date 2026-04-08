import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWechatStore } from '@/stores/wechat-store';
import { rendererEvents } from '@/lib/events';
import { QRCodeAuth } from './QRCodeAuth';
import { BotControlPanel } from './BotControlPanel';

interface WechatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WechatDialog({ open, onOpenChange }: WechatDialogProps) {
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
    loadBotStatus,
    handleAuthStatusChange,
    handleConnectionStatusChange,
  } = useWechatStore();

  // Dialog 打开时加载状态
  useEffect(() => {
    if (open) {
      loadAuthStatus();
      if (authState === 'connected') {
        loadBotStatus();
      }
    }
  }, [open, loadAuthStatus, loadBotStatus, authState]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>微信 Bot 控制</DialogTitle>
        </DialogHeader>
        {authState !== 'connected' ? (
          <QRCodeAuth authState={authState} qrCode={qrCode} onStartAuth={startAuth} />
        ) : (
          <BotControlPanel
            botName={botName}
            polling={polling}
            connectionError={connectionError}
            onDisconnect={disconnect}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
