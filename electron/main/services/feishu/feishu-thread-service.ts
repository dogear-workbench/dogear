import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { safeJsonWrite } from '../safe-json.js';

const { app } = electron;

// 群级绑定：飞书话题群 → 应用话题（group），管理卡挂在这层
export interface FeishuChatBinding {
  chatId: string;
  workspaceId: string;
  groupId?: string;
  manageCardId?: string;
  manageMessageId?: string;
  createdAt: string;
  lastActiveAt: string;
}

// 话题级绑定：飞书话题 → 应用会话，严格一对一
export interface FeishuThreadBinding {
  threadId: string;
  rootMessageId: string;
  chatId: string;
  workspaceId: string;
  conversationId: string;
  createdAt: string;
  lastActiveAt: string;
}

// 待绑定：状态卡「打开会话」后等待用户在新话题发首条消息
export interface FeishuPendingBinding {
  chatId: string;
  workspaceId: string;
  conversationId: string;
  expireAt: string;
}

interface ThreadsFile {
  version: 2;
  chatBindings: FeishuChatBinding[];
  threadBindings: FeishuThreadBinding[];
  pendingBindings: FeishuPendingBinding[];
}

export interface FeishuChatBindingInput {
  chatId: string;
  workspaceId: string;
  groupId?: string;
}

export interface FeishuThreadBindingInput {
  threadId: string;
  rootMessageId: string;
  chatId: string;
  workspaceId: string;
  conversationId: string;
}

export const PENDING_BINDING_TTL_MINUTES = 10;
const PENDING_TTL_MS = PENDING_BINDING_TTL_MINUTES * 60 * 1000;

function emptyFile(): ThreadsFile {
  return { version: 2, chatBindings: [], threadBindings: [], pendingBindings: [] };
}

function normalize(parsed: Partial<ThreadsFile>): ThreadsFile {
  if (parsed.version !== 2) return emptyFile();
  return {
    version: 2,
    chatBindings: Array.isArray(parsed.chatBindings)
      ? parsed.chatBindings.filter((b) => b?.chatId && b?.workspaceId)
      : [],
    threadBindings: Array.isArray(parsed.threadBindings)
      ? parsed.threadBindings.filter((b) => b?.threadId && b?.conversationId)
      : [],
    pendingBindings: Array.isArray(parsed.pendingBindings)
      ? parsed.pendingBindings.filter((b) => b?.chatId && b?.conversationId && b?.expireAt)
      : [],
  };
}

function getThreadsPath(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear', 'feishu', 'threads.json');
  }
  return path.join(process.cwd(), '.dogear', 'feishu', 'threads.json');
}

class FeishuThreadService {
  private cache: ThreadsFile | null = null;

  private async load(): Promise<ThreadsFile> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await fs.readFile(getThreadsPath(), 'utf-8')) as Partial<ThreadsFile>;
      this.cache = normalize(parsed);
    } catch {
      this.cache = emptyFile();
    }
    return this.cache;
  }

  private async save(file: ThreadsFile): Promise<void> {
    this.cache = file;
    await safeJsonWrite(getThreadsPath(), file);
  }

  readonly chatBindings = {
    getByChat: async (chatId: string): Promise<FeishuChatBinding | null> => {
      const file = await this.load();
      return file.chatBindings.find((b) => b.chatId === chatId) ?? null;
    },
    upsertChat: async (input: FeishuChatBindingInput): Promise<FeishuChatBinding> => {
      const file = await this.load();
      const now = new Date().toISOString();
      const existing = file.chatBindings.find((b) => b.chatId === input.chatId);
      const nextGroupId = input.groupId !== undefined ? input.groupId || undefined : existing?.groupId;
      const binding: FeishuChatBinding = existing
        ? { ...existing, workspaceId: input.workspaceId, groupId: nextGroupId, lastActiveAt: now }
        : {
            chatId: input.chatId,
            workspaceId: input.workspaceId,
            groupId: nextGroupId,
            createdAt: now,
            lastActiveAt: now,
          };
      await this.save({
        ...file,
        chatBindings: [binding, ...file.chatBindings.filter((b) => b.chatId !== input.chatId)],
      });
      return binding;
    },
    setManageCard: async (chatId: string, card: { manageCardId?: string; manageMessageId?: string }): Promise<void> => {
      const file = await this.load();
      const binding = file.chatBindings.find((b) => b.chatId === chatId);
      if (!binding) return;
      binding.manageCardId = card.manageCardId;
      binding.manageMessageId = card.manageMessageId;
      await this.save(file);
    },
    touch: async (chatId: string): Promise<void> => {
      const file = await this.load();
      const binding = file.chatBindings.find((b) => b.chatId === chatId);
      if (!binding) return;
      binding.lastActiveAt = new Date().toISOString();
      await this.save(file);
    },
    removeByChat: async (chatId: string): Promise<void> => {
      const file = await this.load();
      const chatBindings = file.chatBindings.filter((b) => b.chatId !== chatId);
      if (chatBindings.length === file.chatBindings.length) return;
      await this.save({ ...file, chatBindings });
    },
    listAll: async (): Promise<FeishuChatBinding[]> => {
      const file = await this.load();
      return [...file.chatBindings];
    },
  };

  readonly threadBindings = {
    byThread: async (threadId: string): Promise<FeishuThreadBinding | null> => {
      const file = await this.load();
      return file.threadBindings.find((b) => b.threadId === threadId) ?? null;
    },
    byConversation: async (workspaceId: string, conversationId: string): Promise<FeishuThreadBinding | null> => {
      const file = await this.load();
      return (
        file.threadBindings.find(
          (b) => b.workspaceId === workspaceId && b.conversationId === conversationId,
        ) ?? null
      );
    },
    firstByConversation: async (conversationId: string): Promise<FeishuThreadBinding | null> => {
      const file = await this.load();
      return file.threadBindings.find((b) => b.conversationId === conversationId) ?? null;
    },
    upsert: async (input: FeishuThreadBindingInput): Promise<FeishuThreadBinding> => {
      const file = await this.load();
      const now = new Date().toISOString();
      const existing = file.threadBindings.find((b) => b.threadId === input.threadId);
      const binding: FeishuThreadBinding = existing
        ? { ...existing, ...input, lastActiveAt: now }
        : { ...input, createdAt: now, lastActiveAt: now };
      await this.save({
        ...file,
        threadBindings: [binding, ...file.threadBindings.filter((b) => b.threadId !== input.threadId)],
      });
      return binding;
    },
    touch: async (threadId: string): Promise<void> => {
      const file = await this.load();
      const binding = file.threadBindings.find((b) => b.threadId === threadId);
      if (!binding) return;
      binding.lastActiveAt = new Date().toISOString();
      await this.save(file);
    },
    remove: async (threadId: string): Promise<void> => {
      const file = await this.load();
      const threadBindings = file.threadBindings.filter((b) => b.threadId !== threadId);
      if (threadBindings.length === file.threadBindings.length) return;
      await this.save({ ...file, threadBindings });
    },
    removeByChat: async (chatId: string): Promise<void> => {
      const file = await this.load();
      const threadBindings = file.threadBindings.filter((b) => b.chatId !== chatId);
      if (threadBindings.length === file.threadBindings.length) return;
      await this.save({ ...file, threadBindings });
    },
    listByChat: async (chatId: string): Promise<FeishuThreadBinding[]> => {
      const file = await this.load();
      return file.threadBindings.filter((b) => b.chatId === chatId);
    },
    boundConversationIds: async (): Promise<Set<string>> => {
      const file = await this.load();
      return new Set(file.threadBindings.map((b) => b.conversationId));
    },
  };

  readonly pendingBindings = {
    set: async (chatId: string, workspaceId: string, conversationId: string): Promise<void> => {
      const file = await this.load();
      const pending: FeishuPendingBinding = {
        chatId,
        workspaceId,
        conversationId,
        expireAt: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
      };
      await this.save({
        ...file,
        pendingBindings: [pending, ...file.pendingBindings.filter((b) => b.chatId !== chatId)],
      });
    },
    // 只读查询（不删除），过期视为不存在；状态卡展示态用它渲染待绑定提示行
    peek: async (chatId: string): Promise<FeishuPendingBinding | null> => {
      const file = await this.load();
      const hit = file.pendingBindings.find((b) => b.chatId === chatId);
      if (!hit || hit.expireAt <= new Date().toISOString()) return null;
      return hit;
    },
    consume: async (chatId: string): Promise<FeishuPendingBinding | null> => {
      const file = await this.load();
      const hit = file.pendingBindings.find((b) => b.chatId === chatId);
      if (!hit) return null;
      await this.save({ ...file, pendingBindings: file.pendingBindings.filter((b) => b !== hit) });
      if (hit.expireAt <= new Date().toISOString()) return null;
      return hit;
    },
    clear: async (chatId: string): Promise<void> => {
      const file = await this.load();
      if (!file.pendingBindings.some((b) => b.chatId === chatId)) return;
      await this.save({ ...file, pendingBindings: file.pendingBindings.filter((b) => b.chatId !== chatId) });
    },
  };
}

export const feishuThreadService = new FeishuThreadService();
