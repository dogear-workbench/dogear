import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { SettingRow, SettingsGroup } from './SettingsControls';

interface DepInfo {
  name: string;
  version: string | null;
  installed: boolean;
  required: boolean;
  description?: string;
  installable?: boolean;
}

export function EnvDepsSection() {
  const [envChecking, setEnvChecking] = useState(false);
  const [envChecked, setEnvChecked] = useState(false);
  const [envDeps, setEnvDeps] = useState<DepInfo[]>([]);
  const [installing, setInstalling] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    client.getPlatform()
      .then((platform) => setIsMac(platform === 'darwin'))
      .catch(() => {});
  }, []);

  const checkEnvironment = useCallback(async () => {
    setEnvChecking(true);
    try {
      const result = await client.checkEnvironment();
      setEnvDeps(result.dependencies as DepInfo[]);
      setEnvChecked(true);
    } catch (err) {
      console.error('环境检测失败:', err);
      toast.error('环境检测失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEnvChecking(false);
    }
  }, []);

  const handleInstallPythonDeps = async () => {
    setInstalling(true);
    try {
      const result = (await client.installPythonDeps()) as {
        success?: boolean;
        error?: string;
      };
      if (result.error) {
        toast.error('安装失败', { description: result.error });
      } else {
        toast.success('Python 依赖安装完成');
        await checkEnvironment();
      }
    } catch (err) {
      console.error('安装失败:', err);
      toast.error('安装失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInstalling(false);
    }
  };

  const pythonInstalled = envDeps.some((d) => d.name === 'Python' && d.installed);
  const missingPythonPkgs = envDeps.filter((d) => d.installable && !d.installed);
  const installedCount = envDeps.filter((d) => d.installed).length;

  return (
    <SettingsGroup id="about-env" title="环境依赖">
      <div className="rounded-md border">
        <SettingRow
          title="Python 与计算依赖"
          desc={
            envChecked
              ? `${installedCount}/${envDeps.length} 已安装 · 股票指标、选股、回测的运行环境，未装齐不影响其他功能`
              : '股票指标、选股、回测的运行环境，未装齐不影响其他功能'
          }
        >
          <Button variant="outline" size="sm" onClick={() => void checkEnvironment()} disabled={envChecking}>
            {envChecking ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : envChecked ? (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Search className="w-3.5 h-3.5 mr-1.5" />
            )}
            {envChecked ? '刷新' : '检查'}
          </Button>
        </SettingRow>

        {envChecked && (
          <>
            <div className="divide-y border-t">
              {envDeps.map((dep) => (
                <div key={dep.name} className="flex items-center gap-3 px-3 py-2.5">
                  {dep.installed ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  ) : dep.required ? (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium w-20 shrink-0">{dep.name}</span>
                  <span className="text-xs text-muted-foreground w-24 shrink-0">
                    {dep.installed ? dep.version : '未安装'}
                  </span>
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0.5 rounded-full shrink-0',
                      dep.required ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {dep.required ? '必需' : '可选'}
                  </span>
                  {dep.description && (
                    <span className="text-xs text-muted-foreground ml-auto truncate">
                      {dep.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {missingPythonPkgs.length > 0 && (
              <div className="px-3 py-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleInstallPythonDeps()}
                  disabled={installing || !pythonInstalled}
                  title={!pythonInstalled ? '请先安装 Python' : undefined}
                >
                  {installing ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  一键安装 Python 依赖
                </Button>
              </div>
            )}
            {isMac && !pythonInstalled && (
              <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                未检测到 Python？终端执行 brew install python3，或安装 Xcode Command Line Tools（xcode-select --install）
              </p>
            )}
          </>
        )}
      </div>
    </SettingsGroup>
  );
}
