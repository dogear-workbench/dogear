import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { PermissionMode } from '@/types/electron-api';
import type { ForkParams } from '@/stores/conversation-store';
import type { Message } from '../types';

interface UseAgentSessionParams {
  conversationId: string | null;
  forkParams: ForkParams | null;
  context: { bookId?: string; workspaceId?: string; chapterId?: string; selectedText?: string };
  useSdkResume: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
}

export function useAgentSession({
  conversationId,
  forkParams,
  context,
  useSdkResume,
  setMessages,
  setIsLoading,
}: UseAgentSessionParams) {
  // 监听 sessionRestartTrigger，变化时重建会话
  const sessionRestartTrigger = useConversationStore((s) => s.sessionRestartTrigger);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');

  // 同步 sessionId 到 ref
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 启动会话
  useEffect(() => {
    // 竞态保护：快速切换对话时，取消过时的异步操作结果
    let cancelled = false;

    const startSession = async () => {
      try {
        console.log('=== 启动基于 Query 的 Agent 会话 ===');
        console.log('conversationId:', conversationId);
        console.log('useSdkResume:', useSdkResume);

        // 自动确定项目根目录
        let projectRoot = '';
        if (typeof window !== 'undefined' && (window as any).process?.cwd) {
          projectRoot = (window as any).process.cwd();
        }

        // v4: 判断是否为 fork 模式
        let sdkSessionId: string | undefined;
        let forkSessionFlag: boolean | undefined;
        let resumeSessionAtFlag: string | undefined;

        if (forkParams) {
          // Fork 模式：使用父对话的 sdk_session_id + fork 参数
          sdkSessionId = forkParams.sdkSessionIdToResume;
          forkSessionFlag = true;
          resumeSessionAtFlag = forkParams.resumeSessionAt;
          console.log('🔀 Fork 模式启动:', { sdkSessionId, resumeSessionAt: resumeSessionAtFlag });
        } else if (conversationId) {
          // 正常 resume 模式
          try {
            const convResult = await client.getById({ conversationId, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
            if (cancelled) return; // 检查是否已被取消
            console.log('getById 结果:', convResult);
            if (convResult.conversation?.sdk_session_id) {
              sdkSessionId = convResult.conversation.sdk_session_id;
              console.log('✅ 找到 sdk_session_id，将 resume 会话:', sdkSessionId);
            } else {
              console.log('⚠️ 该对话没有 sdk_session_id，将创建新会话');
            }
          } catch (error) {
            console.error('❌ 获取 sdk_session_id 失败:', error);
          }
        }

        if (cancelled) return; // 在创建会话前再次检查

        // 检查 Profile 配置是否完整
        const { useSettingsStore } = await import('@/stores/settings-store');
        const { isProfileComplete } = await import('@/types/settings');
        const settingsState = useSettingsStore.getState();
        const activeId = settingsState.settings.ai.activeProfileId;
        const activeProfile = settingsState.settings.profiles[activeId];
        if (!activeProfile || !isProfileComplete(activeProfile)) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '当前模型方案未配置完整，请先前往设置页面完成配置（API Key、Base URL、模型映射）。',
            timestamp: Date.now(),
          }]);
          return;
        }

        const currentWorkspaceId = useWorkspaceStore.getState().workspace?.id;

        // 从当前对话获取 persona 和临时提示词
        const currentConv = useConversationStore.getState().selectedConversation;
        const personaId = currentConv?.persona_id || undefined;
        const tempPrompt = currentConv?.temp_prompt || undefined;

        const response = await client.createQueryBasedSession({
          allowedTools: ['Read', 'Glob', 'Grep'],
          context,
          enableSkills: true,
          projectRoot,
          conversationId: conversationId || undefined,
          workspaceId: currentWorkspaceId,
          resume: sdkSessionId,
          forkSession: forkSessionFlag,           // v4: 分叉参数
          resumeSessionAt: resumeSessionAtFlag,   // v4: 截断位置
          isForkNewConversation: forkParams?.isForkNewConversation, // v4: 区分分叉新对话/编辑重发
          personaId,
          tempPrompt,
        });

        // 关键：异步操作完成后检查是否已被取消（用户已切换到其他对话）
        if (cancelled) {
          // 会话已创建但不再需要，立即关闭
          if (response.sessionId) {
            console.log('会话已创建但被取消（用户快速切换），关闭:', response.sessionId);
            client.closeQueryBasedSession({ sessionId: response.sessionId });
          }
          return;
        }

        console.log('createSession 响应:', response);

        if (response.error) {
          console.error('❌ 启动会话失败:', response.error);
          return;
        }

        const newSessionId = response.sessionId!;
        setSessionId(newSessionId);
        // 同步后端初始权限模式到 UI
        if (response.permissionMode) {
          setPermissionMode(response.permissionMode as PermissionMode);
        }
        console.log('✅ 会话已启动:', {
          sessionId: newSessionId,
          mode: sdkSessionId ? '(resume)' : '(new)',
          sdkMode: useSdkResume ? 'SDK模式' : '数据库模式'
        });
        setIsSessionReady(true);

        // 同步到 session-store（标签页状态）
        if (conversationId) {
          useSessionStore.getState().updateSession(
            conversationId,
            newSessionId,
            response.permissionMode || 'default'
          );
        }

        // v4: 编辑重发模式下，如果有 editedMessage，会话 ready 后自动发送
        // 纯分叉新对话（isForkNewConversation=true）不自动发送，只加载历史等待用户输入
        if (forkParams?.editedMessage && !forkParams?.isForkNewConversation && newSessionId) {
          console.log('🔀 编辑重发模式: 自动发送编辑后的消息:', forkParams.editedMessage);
          // 稍微延迟确保会话已完全初始化
          setTimeout(async () => {
            if (cancelled) return; // 延迟执行前再次检查
            try {
              // 先添加用户消息到 UI
              setMessages(prev => [
                ...prev,
                {
                  role: 'user',
                  content: forkParams.editedMessage!,
                  timestamp: Date.now(),
                  forkPointSdkUuid: forkParams.resumeSessionAt,
                },
                {
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  isStreaming: true,
                  contentBlocks: [],
                }
              ]);
              setIsLoading(true);
              await client.sendQueryBasedSessionMessage({
                sessionId: newSessionId,
                content: forkParams.editedMessage!
              });
            } catch (error) {
              console.error('编辑重发模式自动发送失败:', error);
            }
          }, 500);
        } else if (forkParams?.isForkNewConversation) {
          // 纯分叉新对话：SDK fork 后会话文件中已包含截断历史，
          // 历史消息会通过上面的 loadHistory useEffect 自动加载展示
          console.log('🔀 纯分叉模式: 等待历史加载完成，用户自行输入新消息');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('❌ 启动会话异常:', error);
        }
      }
    };

    startSession();

    // 组件卸载或 conversationId/forkParams 变化时：标记取消 + 关闭旧会话
    return () => {
      cancelled = true;
      if (sessionIdRef.current) {
        console.log('关闭会话:', sessionIdRef.current);
        client.closeQueryBasedSession({ sessionId: sessionIdRef.current });
        sessionIdRef.current = null;
      }
      // 重置会话状态，避免残留的旧会话 ID 被后续操作使用
      setSessionId(null);
      setIsSessionReady(false);
    };
  }, [conversationId, forkParams, sessionRestartTrigger]); // 当 conversationId、forkParams 或 sessionRestartTrigger 变化时重启会话

  return { sessionId, sessionIdRef, isSessionReady, permissionMode, setPermissionMode };
}
