// React Error Boundary 组件
// 捕获子组件树中的 JavaScript 错误，渲染降级 UI
// 支持 app 级（重新加载）和 page 级（返回首页 + 重新加载）两种降级模式
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { logToMain } from '@/lib/log-report';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 降级级别：app 级显示重新加载按钮，page 级显示返回首页按钮 */
  fallback?: 'app' | 'page';
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] 组件崩溃:', error, errorInfo);
    // 通过 IPC 发送到主进程记录日志（如果 IPC 可用）
    logToMain('error', `[ErrorBoundary] ${error.message}`, error.stack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.hash = '#/';
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback = 'page' } = this.props;
      const error = this.state.error;

      return (
        <div className="flex items-center justify-center min-h-[200px] p-6">
          <Alert variant="destructive" className="max-w-lg">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {fallback === 'app' ? '应用发生错误' : '页面发生错误'}
            </AlertTitle>
            <AlertDescription>
              <p className="mb-3">
                {error?.message || '发生了未知错误'}
              </p>
              <div className="flex gap-2">
                {fallback === 'app' ? (
                  <button
                    onClick={this.handleReload}
                    className="px-3 py-1.5 text-xs bg-destructive text-white rounded-md hover:opacity-90"
                  >
                    重新加载
                  </button>
                ) : (
                  <>
                    <button
                      onClick={this.handleGoHome}
                      className="px-3 py-1.5 text-xs bg-destructive text-white rounded-md hover:opacity-90"
                    >
                      返回首页
                    </button>
                    <button
                      onClick={this.handleReload}
                      className="px-3 py-1.5 text-xs border border-destructive text-destructive rounded-md hover:bg-destructive/10"
                    >
                      重新加载
                    </button>
                  </>
                )}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}
