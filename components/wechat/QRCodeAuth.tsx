import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WechatAuthState, WechatQRCode } from '@/types/wechat';

interface QRCodeAuthProps {
  authState: WechatAuthState;
  qrCode: WechatQRCode | null;
  onStartAuth: () => void;
}

export function QRCodeAuth({ authState, qrCode, onStartAuth }: QRCodeAuthProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!qrCode?.imgUrl) {
      setQrDataUrl(null);
      return;
    }
    // 将 iLink 返回的 URL 字符串渲染成二维码图片
    QRCode.toDataURL(qrCode.imgUrl, { width: 192, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [qrCode?.imgUrl]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <QrCode className="w-12 h-12 text-muted-foreground" />
      <h2 className="text-lg font-medium">连接微信</h2>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        通过 iLink 协议接收微信消息。扫码后你的微信账号将作为 Bot 接收消息。
      </p>

      {authState === 'disconnected' && (
        <Button onClick={onStartAuth} className="mt-2">
          获取 QR 码
        </Button>
      )}

      {authState === 'qr_pending' && !qrCode && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          获取 QR 码中...
        </div>
      )}

      {authState === 'qr_pending' && qrCode && (
        <div className="flex flex-col items-center gap-3">
          <div className="border rounded-lg p-4 bg-white">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="微信扫码登录" className="w-48 h-48" />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">请用手机微信扫描二维码</p>
        </div>
      )}

      {authState === 'scanning' && (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">已扫描，请在手机上确认...</p>
        </div>
      )}

      {authState === 'expired' && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">QR 码已过期或 Token 已失效</p>
          <Button onClick={onStartAuth} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            重新获取
          </Button>
        </div>
      )}
    </div>
  );
}
