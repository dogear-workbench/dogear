import React, { useMemo } from 'react';
import { useConversationStore } from '@/stores/conversation-store';
import { ConversationRow, type ConversationRowProps } from './ConversationRow';
import { ChildConversationRow } from './ChildConversationRow';

const EMPTY: never[] = [];

/**
 * 父行包装：自动挂载该父会话当前的子会话快照，并把 awaitCount 透传给 ConversationRow。
 * 仅当该对话是主会话（role!=='sub'）且有子会话时才渲染子行。
 */
export function ConversationRowWithChildren(props: ConversationRowProps) {
  const children = useConversationStore(
    (s) => s.childrenByParent[props.conv.id] ?? (EMPTY as never as import('@/types/delegation').ChildStateSnapshot[]),
  );

  const awaitCount = useMemo(
    () => children.filter((c) => c.status === 'running').length,
    [children],
  );

  return (
    <>
      <ConversationRow {...props} awaitCount={awaitCount} />
      {children.map((child) => (
        <ChildConversationRow
          key={child.childId}
          snapshot={child}
          parentIndent={props.indent ?? 8}
          parentNodeId={props.nodeId}
        />
      ))}
    </>
  );
}
