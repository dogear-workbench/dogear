import { z } from 'zod';

export const SYNC_APP_ID = 'dogear';
export const SYNC_PROTOCOL_VERSION = 1;

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

export const ManifestRequestBodySchema = z.object({
  hello: HandshakeHelloSchema,
  entries: z.array(FileEntrySchema),
  /** 请求方自己的 workspaceMap（供对端反向学习）；旧版无此字段 */
  workspaceMap: z.record(z.string(), WorkspaceMapEntrySchema).optional(),
});
export type ManifestRequestBody = z.infer<typeof ManifestRequestBodySchema>;;

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
});
export type ManifestResponseBody = z.infer<typeof ManifestResponseBodySchema>;

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
}
