
import { client } from '@/lib/client';
import { useEffect, useState } from 'react';

/**
 * Agent 监控窗口页面
 * 实时显示 Agent 管理器的运行状态、Worker 信息和任务队列
 */

// Worker 详细信息接口
interface WorkerDetail {
  workerId: string;
  isReady: boolean;
  currentTaskId: string | null;
  lastActivity: number;
  createdAt: number;
  idleTime: number;
}

// 队列任务信息接口
interface QueuedTask {
  id: string;
  type: string;
  status: string;
  createdAt: number;
}

// 详细状态接口
interface DetailedStatus {
  config: {
    maxWorkers: number;
    workerIdleTimeout: number;
    taskRetryLimit: number;
  };
  workers: WorkerDetail[];
  queuedTasks: QueuedTask[];
  summary: {
    totalWorkers: number;
    activeWorkers: number;
    idleWorkers: number;
    queuedTasksCount: number;
  };
}

export default function AgentMonitorPage() {
  const [status, setStatus] = useState<DetailedStatus | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // 加载详细状态
  useEffect(() => {
    const loadStatus = async () => {
      try {
        const detailedStatus = await client.getDetailedStatus();
        if (detailedStatus) {
          setStatus(detailedStatus);
          setLastUpdate(new Date());
        }
      } catch (error) {
        console.error('获取 Agent 详细状态失败:', error);
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, 2000); // 每 2 秒更新

    return () => clearInterval(interval);
  }, []);

  // 格式化时间戳
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN');
  };

  // 格式化持续时间
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  // 获取任务类型显示名称
  const getTaskTypeName = (type: string) => {
    const typeNames: Record<string, string> = {
      'chat': '对话',
      'summarize': '摘要',
      'analyze_book': '书籍分析',
      'reading_assist': '阅读辅助'
    };
    return typeNames[type] || type;
  };

  // 获取状态颜色
  const getStatusColor = (isReady: boolean, currentTaskId: string | null) => {
    if (!isReady) return 'bg-yellow-500';
    if (currentTaskId) return 'bg-green-500';
    return 'bg-blue-500';
  };

  // 获取状态文本
  const getStatusText = (isReady: boolean, currentTaskId: string | null) => {
    if (!isReady) return '初始化中';
    if (currentTaskId) return '执行中';
    return '空闲';
  };

  if (!status) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* 头部 */}
      <div className="flex-none p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Agent 监控面板</h1>
          <div className="text-xs text-gray-400">
            最后更新: {formatTime(lastUpdate.getTime())}
          </div>
        </div>

        {/* 概览统计 */}
        <div className="mt-4 grid grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">总 Workers</div>
            <div className="text-2xl font-bold text-blue-400">
              {status.summary.totalWorkers} / {status.config.maxWorkers}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">活动 Workers</div>
            <div className="text-2xl font-bold text-green-400">
              {status.summary.activeWorkers}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">空闲 Workers</div>
            <div className="text-2xl font-bold text-yellow-400">
              {status.summary.idleWorkers}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">队列任务</div>
            <div className="text-2xl font-bold text-purple-400">
              {status.summary.queuedTasksCount}
            </div>
          </div>
        </div>

        {/* 配置信息 */}
        <div className="mt-3 text-xs text-gray-500 flex items-center space-x-4">
          <span>空闲超时: {formatDuration(status.config.workerIdleTimeout)}</span>
          <span>重试限制: {status.config.taskRetryLimit}</span>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex">
          {/* 左侧: Workers 列表 */}
          <div className="w-1/2 p-4 border-r border-gray-700 overflow-auto">
            <h2 className="text-lg font-semibold mb-3 flex items-center">
              <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
              Workers ({status.workers.length})
            </h2>
            <div className="space-y-3">
              {status.workers.map((worker) => (
                <div
                  key={worker.workerId}
                  className="bg-gray-800 rounded-lg p-4 border border-gray-700"
                >
                  {/* Worker 头部 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`w-3 h-3 rounded-full ${getStatusColor(
                          worker.isReady,
                          worker.currentTaskId
                        )}`}
                      ></span>
                      <span className="font-mono text-sm">
                        {worker.workerId}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {getStatusText(worker.isReady, worker.currentTaskId)}
                    </span>
                  </div>

                  {/* Worker 详细信息 */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">状态:</span>
                      <span className={worker.isReady ? 'text-green-400' : 'text-yellow-400'}>
                        {worker.isReady ? '就绪' : '未就绪'}
                      </span>
                    </div>

                    {worker.currentTaskId && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">当前任务:</span>
                        <span className="font-mono text-xs text-blue-400">
                          {worker.currentTaskId}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between">
                      <span className="text-gray-400">空闲时间:</span>
                      <span className={worker.idleTime > 30000 ? 'text-yellow-400' : 'text-gray-300'}>
                        {formatDuration(worker.idleTime)}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-gray-400">创建时间:</span>
                      <span className="text-gray-300">{formatTime(worker.createdAt)}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-gray-400">最后活动:</span>
                      <span className="text-gray-300">{formatTime(worker.lastActivity)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧: 任务队列 */}
          <div className="w-1/2 p-4 overflow-auto">
            <h2 className="text-lg font-semibold mb-3 flex items-center">
              <span className="w-2 h-2 bg-purple-500 rounded-full mr-2"></span>
              任务队列 ({status.queuedTasks.length})
            </h2>
            {status.queuedTasks.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <div className="text-4xl mb-2">📭</div>
                <p>队列为空</p>
              </div>
            ) : (
              <div className="space-y-3">
                {status.queuedTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="bg-gray-800 rounded-lg p-4 border border-gray-700"
                  >
                    {/* 任务头部 */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="bg-purple-600 text-xs px-2 py-1 rounded">
                          #{index + 1}
                        </span>
                        <span className="text-sm font-mono">{task.id}</span>
                      </div>
                      <span className="text-xs bg-gray-700 px-2 py-1 rounded">
                        {getTaskTypeName(task.type)}
                      </span>
                    </div>

                    {/* 任务详情 */}
                    <div className="space-y-1 text-sm text-gray-400">
                      <div className="flex justify-between">
                        <span>类型:</span>
                        <span className="text-gray-300">{task.type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>状态:</span>
                        <span className="text-blue-400">{task.status}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>创建时间:</span>
                        <span className="text-gray-300">{formatTime(task.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
