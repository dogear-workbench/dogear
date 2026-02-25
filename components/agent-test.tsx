'use client';

/**
 * Agent 测试组件
 * 用于测试 Agent 框架的基础功能
 */

import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useState, useEffect, useCallback } from 'react';

// 任务状态枚举
enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// 任务类型枚举
enum TaskType {
  CHAT = 'chat',
  SUMMARIZE = 'summarize',
  ANALYZE_BOOK = 'analyze_book',
  READING_ASSIST = 'reading_assist'
}

interface TaskUpdate {
  taskId: string;
  status: TaskStatus;
  result?: any;
  error?: string;
}

export default function AgentTest() {
  const [taskId, setTaskId] = useState<string>('');
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [taskResult, setTaskResult] = useState<any>(null);
  const [taskError, setTaskError] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<any>(null);
  const [selectedTaskType, setSelectedTaskType] = useState<TaskType>(TaskType.CHAT);
  const [inputText, setInputText] = useState('');

  // 监听任务更新
  useEffect(() => {
    const cleanup = rendererEvents.agentTaskUpdate.listen((update: TaskUpdate) => {
      console.log('任务更新:', update);
      if (update.taskId === taskId) {
        setTaskStatus(update.status);
        setTaskResult(update.result);
        setTaskError(update.error || '');
      }
    });

    return () => {
      cleanup();
    };
  }, [taskId]);

  // 获取 Agent 状态
  const fetchAgentStatus = useCallback(async () => {
    try {
      const status = await client.getStatus();
      setAgentStatus(status);
    } catch (error) {
      console.error('获取 Agent 状态失败:', error);
    }
  }, []);

  useEffect(() => {
    fetchAgentStatus();
    const interval = setInterval(fetchAgentStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchAgentStatus]);

  // 提交任务
  const submitTask = async () => {
    try {
      let task: any = {
        type: selectedTaskType,
        payload: {}
      };

      // 根据任务类型设置负载
      switch (selectedTaskType) {
        case TaskType.CHAT:
          task.payload = {
            messages: [
              { role: 'user', content: inputText || '你好,请介绍一下你自己' }
            ]
          };
          break;

        case TaskType.SUMMARIZE:
          task.payload = {
            text: inputText || '这是一段需要摘要的文本...'
          };
          break;

        case TaskType.ANALYZE_BOOK:
          task.payload = {
            bookId: inputText || 'test-book-id'
          };
          break;

        case TaskType.READING_ASSIST:
          task.payload = {
            text: inputText || '需要解释的文本',
            action: 'explain'
          };
          break;
      }

      const result = await client.submitTask({ task });
      setTaskId(result.taskId);
      setTaskStatus(TaskStatus.PENDING);
      setTaskResult(null);
      setTaskError('');
    } catch (error) {
      console.error('提交任务失败:', error);
      setTaskError(String(error));
    }
  };

  // 取消任务
  const cancelTask = async () => {
    if (!taskId) return;

    try {
      await client.cancelTask({ taskId });
      setTaskStatus(TaskStatus.CANCELLED);
    } catch (error) {
      console.error('取消任务失败:', error);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Agent 框架测试</h1>

      {/* Agent 状态 */}
      <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <h2 className="text-xl font-semibold mb-2">Agent 状态</h2>
        {agentStatus && (
          <div className="space-y-1 text-sm">
            <p>Worker 数量: {agentStatus.workers} / {agentStatus.maxWorkers}</p>
            <p>队列中的任务: {agentStatus.queuedTasks}</p>
            <p>正在执行的任务: {agentStatus.activeTasks}</p>
          </div>
        )}
      </div>

      {/* 任务提交 */}
      <div className="mb-6 p-4 bg-white dark:bg-gray-900 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">提交任务</h2>

        <div className="space-y-4">
          {/* 任务类型选择 */}
          <div>
            <label className="block text-sm font-medium mb-2">
              任务类型:
            </label>
            <select
              value={selectedTaskType}
              onChange={(e) => setSelectedTaskType(e.target.value as TaskType)}
              className="w-full p-2 border rounded"
            >
              <option value={TaskType.CHAT}>对话 (CHAT)</option>
              <option value={TaskType.SUMMARIZE}>摘要 (SUMMARIZE)</option>
              <option value={TaskType.ANALYZE_BOOK}>书籍分析 (ANALYZE_BOOK)</option>
              <option value={TaskType.READING_ASSIST}>阅读辅助 (READING_ASSIST)</option>
            </select>
          </div>

          {/* 输入文本 */}
          <div>
            <label className="block text-sm font-medium mb-2">
              输入内容:
            </label>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full p-2 border rounded"
              rows={4}
              placeholder="根据任务类型输入相应的内容..."
            />
          </div>

          {/* 按钮 */}
          <div className="flex gap-2">
            <button
              onClick={submitTask}
              disabled={taskStatus === TaskStatus.IN_PROGRESS}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
            >
              提交任务
            </button>
            <button
              onClick={cancelTask}
              disabled={!taskId || taskStatus === TaskStatus.COMPLETED || taskStatus === TaskStatus.FAILED || taskStatus === TaskStatus.CANCELLED}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400"
            >
              取消任务
            </button>
          </div>
        </div>
      </div>

      {/* 任务状态 */}
      {taskId && (
        <div className="p-4 bg-white dark:bg-gray-900 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">任务状态</h2>

          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-medium">任务 ID:</span> {taskId}
            </p>
            <p className="text-sm">
              <span className="font-medium">状态:</span>{' '}
              <span className={`px-2 py-1 rounded text-xs ${
                taskStatus === TaskStatus.COMPLETED ? 'bg-green-100 text-green-800' :
                taskStatus === TaskStatus.FAILED ? 'bg-red-100 text-red-800' :
                taskStatus === TaskStatus.IN_PROGRESS ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {taskStatus || '未知'}
              </span>
            </p>

            {taskError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-sm font-medium text-red-800">错误:</p>
                <p className="text-sm text-red-600">{taskError}</p>
              </div>
            )}

            {taskResult && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
                <p className="text-sm font-medium text-green-800">结果:</p>
                <pre className="text-sm text-green-600 overflow-auto mt-2">
                  {JSON.stringify(taskResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
