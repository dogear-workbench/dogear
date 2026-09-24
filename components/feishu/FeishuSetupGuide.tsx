import { useState } from 'react';
import { ExternalLink, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { client } from '@/lib/client';
import { useFeishuStore } from '@/stores/feishu-store';
import type { FeishuTestResult } from '@/types/feishu';

const PLATFORM_URL = 'https://open.feishu.cn/app';

interface GuideStep {
  title: string;
  detail: React.ReactNode;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    title: '打开飞书开放平台并登录',
    detail: (
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void openPlatform()}>
        <ExternalLink className="w-3 h-3 mr-1" />
        打开飞书开放平台
      </Button>
    ),
  },
  {
    title: '创建企业自建应用',
    detail: <span>进入开发者后台，点击「创建企业自建应用」，填写名称与描述。</span>,
  },
  {
    title: '添加应用能力——机器人',
    detail: <span>在应用详情页左侧「添加应用能力」中，添加「机器人」能力。</span>,
  },
  {
    title: '权限管理——开通权限',
    detail: (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">im:message.p2p_msg:readonly</code>
          <span className="text-muted-foreground">读取用户发给机器人的单聊消息</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">im:message:send_as_bot</code>
          <span className="text-muted-foreground">以应用的身份发消息</span>
        </div>
        <p className="text-muted-foreground">勾选后需发布新版本生效。</p>
      </div>
    ),
  },
  {
    title: '事件与回调——订阅消息事件',
    detail: (
      <div className="space-y-1">
        <span>选择「使用长连接接收事件」，订阅事件：</span>
        <div>
          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">im.message.receive_v1</code>
        </div>
      </div>
    ),
  },
  {
    title: '创建版本并发布',
    detail: <span>创建版本并发布应用，可用范围需包含你自己。</span>,
  },
  {
    title: '复制凭证',
    detail: <span>在「凭证与基础信息」页面复制 App ID 与 App Secret，填入下方。</span>,
  },
];

async function openPlatform(): Promise<void> {
  try {
    const res = await client['feishu:openPlatform']({ url: PLATFORM_URL });
    if ('error' in res && res.error) {
      toast.error('打开浏览器失败', { description: res.error });
    }
  } catch (error) {
    toast.error('打开浏览器失败', { description: String(error) });
  }
}

export function FeishuSetupGuide() {
  const testConnection = useFeishuStore((s) => s.testConnection);
  const saveAndConnect = useFeishuStore((s) => s.saveAndConnect);

  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FeishuTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setTestResult({ ok: false, error: '请先填写 App ID 和 App Secret' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const res = await testConnection(appId, appSecret);
    setTestResult(res);
    setTesting(false);
  };

  const handleSave = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setSaveError('请先填写 App ID 和 App Secret');
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await saveAndConnect(appId, appSecret);
    if (!res.success) {
      setSaveError(res.error || '连接失败，请重试');
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2.5">
        {GUIDE_STEPS.map((step, i) => (
          <div key={step.title} className="flex gap-2.5">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-sm font-medium">{step.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{step.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="feishu-app-id" className="text-xs">App ID</Label>
          <Input
            id="feishu-app-id"
            placeholder="cli_xxxxxxxx"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="feishu-app-secret" className="text-xs">App Secret</Label>
          <Input
            id="feishu-app-secret"
            type="password"
            placeholder="应用凭证页面的 App Secret"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            autoComplete="off"
          />
        </div>

        {testResult && (
          <div
            className={`flex items-start gap-1.5 text-xs rounded-md p-2.5 ${
              testResult.ok ? 'text-green-600 bg-green-500/10' : 'text-destructive bg-destructive/10'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            )}
            <span>
              {testResult.ok
                ? `连接成功${testResult.botName ? `：${testResult.botName}` : ''}`
                : testResult.error || '测试失败，请重试'}
            </span>
          </div>
        )}

        {saveError && (
          <div className="flex items-start gap-1.5 text-xs text-destructive rounded-md p-2.5 bg-destructive/10">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={testing || saving} onClick={() => void handleTest()}>
            {testing && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            测试连接
          </Button>
          <Button size="sm" className="flex-1" disabled={testing || saving} onClick={() => void handleSave()}>
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            保存并连接
          </Button>
        </div>
      </div>
    </div>
  );
}
