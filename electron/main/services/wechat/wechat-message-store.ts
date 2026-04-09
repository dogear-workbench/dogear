/**
 * 微信消息本地存储
 *
 * 存储路径：
 *   - 联系人列表：.dogear/wechat/contacts.json
 *   - 消息历史：.dogear/wechat/messages/{contactId}.jsonl（JSONL，每行一条）
 *
 * 联系人列表从收到的消息中自动派生，不单独维护。
 */

import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { safeJsonWrite } from '../safe-json.js';

const { app } = electron;

// ============================================================
// 类型（镜像，避免 rootDir 限制）
// ============================================================

export interface WechatMessage {
  id: string;
  contextToken: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: string;
  timestamp: number;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  isOutgoing: boolean;
}

export interface WechatContact {
  id: string;
  name: string;
  isGroup: boolean;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  contextToken?: string;
}

// ============================================================
// 工具
// ============================================================

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getContactsPath(): string {
  return path.join(getConfigDir(), 'wechat', 'contacts.json');
}

function getMessagesDir(): string {
  return path.join(getConfigDir(), 'wechat', 'messages');
}

function getMessagePath(contactId: string): string {
  // contactId 可能含特殊字符，做简单 hash 处理
  const safeId = contactId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getMessagesDir(), `${safeId}.jsonl`);
}

// ============================================================
// 消息存储服务
// ============================================================

class WechatMessageStore {
  /** 加载联系人列表 */
  async loadContacts(): Promise<WechatContact[]> {
    try {
      const content = await fs.readFile(getContactsPath(), 'utf-8');
      return JSON.parse(content) as WechatContact[];
    } catch {
      return [];
    }
  }

  /** 保存联系人列表 */
  async saveContacts(contacts: WechatContact[]): Promise<void> {
    await safeJsonWrite(getContactsPath(), contacts);
  }

  /** 更新/插入单个联系人 */
  async updateContact(contact: WechatContact): Promise<void> {
    const contacts = await this.loadContacts();
    const idx = contacts.findIndex(c => c.id === contact.id);
    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], ...contact };
    } else {
      contacts.push(contact);
    }
    await this.saveContacts(contacts);
  }

  /**
   * 追加消息（按 id 去重）
   * @returns 实际新增的消息数
   */
  async appendMessages(contactId: string, messages: WechatMessage[]): Promise<number> {
    const msgPath = getMessagePath(contactId);
    const dir = path.dirname(msgPath);
    await fs.mkdir(dir, { recursive: true });

    // 读取已有消息 ID 做去重
    const existingIds = new Set<string>();
    try {
      const content = await fs.readFile(msgPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as WechatMessage;
          if (msg.id) existingIds.add(msg.id);
        } catch { /* 跳过解析失败的行 */ }
      }
    } catch { /* 文件不存在 */ }

    const newMessages = messages.filter(m => !existingIds.has(m.id));
    if (newMessages.length === 0) return 0;

    const jsonl = newMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
    await fs.appendFile(msgPath, jsonl, 'utf-8');

    return newMessages.length;
  }

  /**
   * 加载指定联系人的消息
   * @param contactId 联系人 ID
   * @param limit 最多返回条数（默认 50）
   * @param before 只返回时间戳小于此值的消息（分页用）
   */
  async loadMessages(contactId: string, limit = 50, before?: number): Promise<WechatMessage[]> {
    const msgPath = getMessagePath(contactId);
    try {
      const content = await fs.readFile(msgPath, 'utf-8');
      const allMessages: WechatMessage[] = [];

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as WechatMessage;
          if (before && msg.timestamp >= before) continue;
          allMessages.push(msg);
        } catch { /* 跳过 */ }
      }

      // 按时间排序，取最后 limit 条
      allMessages.sort((a, b) => a.timestamp - b.timestamp);
      return allMessages.slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * 从消息中提取/更新联系人信息
   * 收到新消息时调用，自动维护联系人列表
   */
  async updateContactFromMessages(messages: WechatMessage[]): Promise<WechatContact[]> {
    const contacts = await this.loadContacts();
    const contactMap = new Map(contacts.map(c => [c.id, c]));

    for (const msg of messages) {
      if (msg.isOutgoing) continue; // bot 发出的消息不创建联系人

      const contactId = msg.isGroup ? (msg.groupId || msg.senderId) : msg.senderId;
      const contactName = msg.isGroup ? (msg.groupName || msg.senderName) : msg.senderName;

      const existing = contactMap.get(contactId);
      if (existing) {
        // 更新最后消息
        if (!existing.lastMessageAt || msg.timestamp > existing.lastMessageAt) {
          existing.lastMessage = msg.content.slice(0, 100);
          existing.lastMessageAt = msg.timestamp;
          existing.contextToken = msg.contextToken;
        }
        existing.unreadCount = (existing.unreadCount || 0) + 1;
        // 更新名称（可能昵称变了）
        if (contactName) existing.name = contactName;
      } else {
        contactMap.set(contactId, {
          id: contactId,
          name: contactName || contactId,
          isGroup: msg.isGroup,
          lastMessage: msg.content.slice(0, 100),
          lastMessageAt: msg.timestamp,
          unreadCount: 1,
          contextToken: msg.contextToken,
        });
      }
    }

    const updatedContacts = Array.from(contactMap.values());
    await this.saveContacts(updatedContacts);
    return updatedContacts;
  }

  /** 清除指定联系人的未读数 */
  async clearUnread(contactId: string): Promise<void> {
    const contacts = await this.loadContacts();
    const contact = contacts.find(c => c.id === contactId);
    if (contact) {
      contact.unreadCount = 0;
      await this.saveContacts(contacts);
    }
  }
}

export const wechatMessageStore = new WechatMessageStore();
