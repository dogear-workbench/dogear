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
});
export type HandshakeHello = z.infer<typeof HandshakeHelloSchema>;

export const ManifestRequestBodySchema = z.object({
  hello: HandshakeHelloSchema,
  entries: z.array(FileEntrySchema),
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
