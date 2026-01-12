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
      if (!parsed.success) {
        logger.debug(`[sessionRegistry] Failed to parse session marker ${name}`, parsed.error);
        continue;
      }
      // Extra safety: only accept markers for our home dir.
      if (parsed.data.happyHomeDir !== configuration.happyHomeDir) continue;
      markers.push(parsed.data);
    } catch (e) {
      logger.debug(`[sessionRegistry] Failed to read or parse session marker ${name}`, e);
      // ignore unreadable marker
    }
  }
  return markers;
}
