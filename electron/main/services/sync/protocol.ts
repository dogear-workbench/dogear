import { z } from 'zod';

export const SYNC_APP_ID = 'dogear';

/** 默认服务端口；占用时由启动方退避随机端口，实际端口以 mDNS 广播为准。网段扫描兑底也只探测此端口 */
export const DEFAULT_SYNC_PORT = 47210;
// v2：同步范围可配置化（excludes 对称过滤，shadow-git 与 .conflict-* 默认不再同步）
// v3：墓碑删除传播（/manifest 双向携墓碑 + DELETE /file 删除端点）
// v4：工作区外部数据进同步（__ws-external__/{wsid}/ 虚拟路径：tasks.json + 文章库 + 用户勾选子树）；
//     与旧版对端同步时双向过滤虚拟路径条目（防旧端把虚拟路径当普通路径落到 configDir 下成垃圾目录）
export const SYNC_PROTOCOL_VERSION = 4;

export const FileEntrySchema = z.object({
  relPath: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  hash: z.string().length(64).optional(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type HashedFileEntry = FileEntry & { hash: string };

export const HandshakeHelloSchema = z.object({
  appId: z.literal(SYNC_APP_ID),
  protocolVersion: z.number().int(),
  appVersion: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1).optional(),
  /** 本端数据目录绝对路径：对端折算 sessions flat-cwd 目录名用；仅在 /manifest 授权端点携带（/info、/pair-request 剥离防未授权探测） */
  dataDirPath: z.string().min(1).optional(),
});
export type HandshakeHello = z.infer<typeof HandshakeHelloSchema>;

/** 工作区映射条目（对端 local→remote 视角）；remoteWsid 缺省 = 同 id 直通 */
export const WorkspaceMapEntrySchema = z.object({
  remoteWsid: z.string().min(1).optional(),
  enabled: z.boolean(),
});
export type WorkspaceMapEntry = z.infer<typeof WorkspaceMapEntrySchema>;

/** 对端工作区概要（待映射区/已映射区展示用，轻量统计） */
export const WorkspaceMetaSchema = z.object({
  wsid: z.string().min(1),
  name: z.string().optional(),
  conversationCount: z.number().int().nonnegative().optional(),
  lastUpdated: z.number().nonnegative().optional(),
});
export type WorkspaceMetaItem = z.infer<typeof WorkspaceMetaSchema>;

/** 删除墓碑：relPath → { 删除时刻, 执行删除的设备 }；key 为记录端视角路径，接收方负责映射折算 */
export const TombstoneSchema = z.object({
  deletedAt: z.number(),
  deviceId: z.string().min(1),
});
export type Tombstone = z.infer<typeof TombstoneSchema>;

export const ManifestRequestBodySchema = z.object({
  hello: HandshakeHelloSchema,
  entries: z.array(FileEntrySchema),
  /** 请求方自己的 workspaceMap（供对端反向学习）；旧版无此字段 */
  workspaceMap: z.record(z.string(), WorkspaceMapEntrySchema).optional(),
  /** 请求方删除墓碑（v3）；删除由请求方经 DELETE /file 驱动，对端当前不据此执行删除，协议对称预留 */
  tombstones: z.record(z.string(), TombstoneSchema).optional(),
});
export type ManifestRequestBody = z.infer<typeof ManifestRequestBodySchema>;


export const CandidateHashSchema = z.object({
  relPath: z.string().min(1),
  hash: z.string().length(64),
});
export type CandidateHash = z.infer<typeof CandidateHashSchema>;

export const ManifestResponseBodySchema = z.object({
  hello: HandshakeHelloSchema,
  entries: z.array(FileEntrySchema),
  candidateHashes: z.array(CandidateHashSchema),
  /** 响应方（对端）针对请求者的 workspaceMap（对端 local→remote 视角）；旧版无此字段 */
  workspaceMap: z.record(z.string(), WorkspaceMapEntrySchema).optional(),
  /** 响应方工作区概要（待映射区展示名称/会话数/最后更新） */
  workspaceMeta: z.array(WorkspaceMetaSchema).optional(),
  /** 响应方（对端）删除墓碑（v3）；缺省 = 旧版对端，删除传播禁用 */
  tombstones: z.record(z.string(), TombstoneSchema).optional(),
});
export type ManifestResponseBody = z.infer<typeof ManifestResponseBodySchema>;

export const FileDeleteRequestSchema = z.object({
  relPath: z.string().min(1),
  /** 请求方基线中该文件的内容 hash：接收端本文件 hash 一致（未改）才允许删除 */
  expectedHash: z.string().length(64),
});
export type FileDeleteRequest = z.infer<typeof FileDeleteRequestSchema>;

export const FilePullRequestSchema = z.object({
  relPath: z.string().min(1),
});
export type FilePullRequest = z.infer<typeof FilePullRequestSchema>;

export const FilePushMetaSchema = z.object({
  relPath: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
});
export type FilePushMeta = z.infer<typeof FilePushMetaSchema>;

export const PairRequestBodySchema = z.object({
  hello: HandshakeHelloSchema,
  code: z.string().regex(/^\d{6}$/),
  /** 发起方服务监听端口：确认端据此回写对端地址记忆（旧版对端缺省则不记录） */
  listenPort: z.number().int().positive().optional(),
});
export type PairRequestBody = z.infer<typeof PairRequestBodySchema>;

export const PairResponseBodySchema = z.object({
  accepted: z.boolean(),
  reason: z.string().optional(),
  secret: z.string().length(64).optional(),
  hello: HandshakeHelloSchema,
});
export type PairResponseBody = z.infer<typeof PairResponseBodySchema>;

export const AuthHeaders = {
  deviceId: 'x-dogear-device-id',
  secret: 'x-dogear-secret',
  fileMeta: 'x-dogear-file-meta',
} as const;

export type DiffConflict = { local: FileEntry; remote: FileEntry };
export type SkippedEntry = { relPath: string; reason: string };

export interface DiffResult {
  pull: FileEntry[];
  push: FileEntry[];
  conflict: DiffConflict[];
  skipped: SkippedEntry[];
  same: number;
  /** 本端已删（墓碑命中）、对端仍有文件：需驱动对端删除或报删改冲突（对端改过则保守保留对端版本） */
  deletePropagation: FileEntry[];
  /** 对端已删（对端墓碑命中）、本端仍有文件：本端未改则跟随删除，改过则保守保留本端版本 */
  peerDeleted: FileEntry[];
}
