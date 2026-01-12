import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';

const DaemonSessionMarkerSchema = z.object({
  pid: z.number().int().positive(),
  happySessionId: z.string(),
  happyHomeDir: z.string(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  flavor: z.enum(['claude', 'codex', 'gemini']).optional(),
  startedBy: z.string().optional(),
  cwd: z.string().optional(),
  metadata: z.any().optional(),
});

export type DaemonSessionMarker = z.infer<typeof DaemonSessionMarkerSchema>;

const PersistedHappySessionSchema = z.object({
  sessionId: z.string(),
  encryptionKeyBase64: z.string(),
  encryptionVariant: z.union([z.literal('legacy'), z.literal('dataKey')]),
  metadata: z.any(),
  metadataVersion: z.number().int().nonnegative(),
  agentState: z.any().nullable(),
  agentStateVersion: z.number().int().nonnegative(),
  flavor: z.enum(['claude', 'codex', 'gemini']),
  vendorResume: z.string().optional(),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type PersistedHappySession = z.infer<typeof PersistedHappySessionSchema>;

function sessionsDir(): string {
  return join(configuration.happyHomeDir, 'sessions');
}

function daemonSessionsDir(): string {
  return join(configuration.happyHomeDir, 'tmp', 'daemon-sessions');
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

export async function writeSessionMarker(marker: Omit<DaemonSessionMarker, 'createdAt' | 'updatedAt' | 'happyHomeDir'> & { createdAt?: number; updatedAt?: number }): Promise<void> {
  await ensureDir(daemonSessionsDir());
  const now = Date.now();
  const payload: DaemonSessionMarker = DaemonSessionMarkerSchema.parse({
    ...marker,
    happyHomeDir: configuration.happyHomeDir,
    createdAt: marker.createdAt ?? now,
    updatedAt: marker.updatedAt ?? now,
  });

  const filePath = join(daemonSessionsDir(), `pid-${payload.pid}.json`);
  await writeJsonAtomic(filePath, payload);
}

export async function removeSessionMarker(pid: number): Promise<void> {
  const filePath = join(daemonSessionsDir(), `pid-${pid}.json`);
  try {
    await unlink(filePath);
  } catch {
    // ignore
  }
}

export async function listSessionMarkers(): Promise<DaemonSessionMarker[]> {
  await ensureDir(daemonSessionsDir());
  const entries = await readdir(daemonSessionsDir());
  const markers: DaemonSessionMarker[] = [];
  for (const name of entries) {
    if (!name.startsWith('pid-') || !name.endsWith('.json')) continue;
    const full = join(daemonSessionsDir(), name);
    try {
      const raw = await readFile(full, 'utf-8');
      const parsed = DaemonSessionMarkerSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) continue;
      // Extra safety: only accept markers for our home dir.
      if (parsed.data.happyHomeDir !== configuration.happyHomeDir) continue;
      markers.push(parsed.data);
    } catch {
      // ignore unreadable marker
    }
  }
  return markers;
}

export async function writePersistedHappySession(session: {
  id: string;
  metadata: any;
  metadataVersion: number;
  agentState: any | null;
  agentStateVersion: number;
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
}, extra: { flavor: 'claude' | 'codex' | 'gemini'; vendorResume?: string | null }): Promise<void> {
  await ensureDir(sessionsDir());
  const now = Date.now();

  const persisted: PersistedHappySession = PersistedHappySessionSchema.parse({
    sessionId: session.id,
    encryptionKeyBase64: Buffer.from(session.encryptionKey).toString('base64'),
    encryptionVariant: session.encryptionVariant,
    metadata: session.metadata,
    metadataVersion: session.metadataVersion,
    agentState: session.agentState ?? null,
    agentStateVersion: session.agentStateVersion,
    flavor: extra.flavor,
    vendorResume: extra.vendorResume ?? undefined,
    createdAt: now,
    updatedAt: now,
  });

  const filePath = join(sessionsDir(), `${persisted.sessionId}.json`);
  await writeJsonAtomic(filePath, persisted);
}

export async function readPersistedHappySession(sessionId: string): Promise<PersistedHappySession | null> {
  const filePath = join(sessionsDir(), `${sessionId}.json`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = PersistedHappySessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data;
  } catch (e) {
    logger.debug('[sessionRegistry] Failed to read persisted session', e);
    return null;
  }
}

