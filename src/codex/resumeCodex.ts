import os from 'node:os';
import fs from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { logger } from '@/ui/logger';

export interface CodexResumeResult {
    resumeTranscriptFile: string | null;
    resumeContext: string | null;
    resumeContextForUi: string | null;
    resumeExecSummary: string | null;
}

function getCodexSessionsRootDir(): string {
    const codexHomeDir = process.env.CODEX_HOME || join(os.homedir(), '.codex');
    return join(codexHomeDir, 'sessions');
}

function collectCodexSessionFilesRecursive(dir: string, acc: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectCodexSessionFilesRecursive(full, acc);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            acc.push(full);
        }
    }
    return acc;
}

function listCodexTranscriptFiles(): Array<{ file: string; mtimeMs: number }> {
    const rootDir = getCodexSessionsRootDir();
    const files = collectCodexSessionFilesRecursive(rootDir);
    const entries: Array<{ file: string; mtimeMs: number }> = [];
    for (const file of files) {
        try {
            const stat = fs.statSync(file);
            if (stat.isFile()) {
                entries.push({ file, mtimeMs: stat.mtimeMs });
            }
        } catch {
            // ignore
        }
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries;
}

export function findCodexResumeFile(sessionId: string | null): string | null {
    if (!sessionId) return null;
    const candidates = listCodexTranscriptFiles()
        .map((entry) => entry.file)
        .filter((full) => full.endsWith(`-${sessionId}.jsonl`));
    return candidates[0] || null;
}

async function resolveInitialCodexResumeTranscriptFile(resume: true | string | undefined): Promise<string | null> {
    if (!resume) {
        return null;
    }

    if (typeof resume === 'string') {
        try {
            const stat = fs.statSync(resume);
            if (stat.isFile()) {
                return resume;
            }
        } catch {
            // Not a file path; treat as session id
        }

        const resumeFile = findCodexResumeFile(resume);
        if (!resumeFile) {
            throw new Error(`Could not find Codex resume transcript for session: ${resume}`);
        }
        return resumeFile;
    }

    const candidates = listCodexTranscriptFiles();
    if (candidates.length == 0) {
        return null;
    }

    const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
    if (!hasTTY) {
        return candidates[0].file;
    }

    const shown = candidates.slice(0, 20);
    console.log('\nSelect a Codex session to resume:');
    for (let i = 0; i < shown.length; i++) {
        const entry = shown[i];
        const label = basename(entry.file);
        const when = new Date(entry.mtimeMs).toLocaleString();
        console.log(`  ${i + 1}) ${label}  (${when})`);
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question('Enter number (or press Enter to start fresh): ')).trim();
        if (!answer) {
            return null;
        }
        const idx = Number.parseInt(answer, 10);
        if (!Number.isFinite(idx) || idx < 1 || idx > shown.length) {
            throw new Error(`Invalid selection: ${answer}`);
        }
        return shown[idx - 1].file;
    } finally {
        rl.close();
    }
}

function parseCodexSessionMetaFromTranscript(file: string): { sessionId: string | null; cwd: string | null } {
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const lines = raw.split('\n');
        const limit = Math.min(lines.length, 200);
        for (let i = 0; i < limit; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
                const parsed = JSON.parse(line) as any;
                if (parsed?.type === 'session_meta' && parsed?.payload && typeof parsed.payload === 'object') {
                    const sessionId = typeof parsed.payload.id === 'string' ? parsed.payload.id : null;
                    const cwd = typeof parsed.payload.cwd === 'string' ? parsed.payload.cwd : null;
                    return { sessionId, cwd };
                }
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }
    return { sessionId: null, cwd: null };
}

async function generateCodexExecResumeSummary(opts: {
    sessionId: string;
    cwd: string;
    prompt: string;
}): Promise<string | null> {
    return await new Promise((resolve) => {
        const args = [
            'exec',
            '--json',
            '-s',
            'read-only',
            '-C',
            opts.cwd,
            'resume',
            opts.sessionId,
            opts.prompt,
        ];

        const child = spawn('codex', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });

        child.on('close', () => {
            try {
                const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
                let best: string | null = null;
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line) as any;
                        if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
                            best = parsed.item.text;
                        }
                    } catch {
                        // ignore non-json
                    }
                }
                if (best && best.trim()) {
                    resolve(best.trim());
                    return;
                }

                // If codex emitted a clear error, surface it via null (caller will fallback)
                if (stderr.includes('Session not found')) {
                    resolve(null);
                    return;
                }

                resolve(null);
            } catch {
                resolve(null);
            }
        });

        child.on('error', () => {
            resolve(null);
        });
    });
}

function buildCodexResumeContextFromTranscript(file: string, opts?: { tailCount?: number }): string {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n');

    type Msg = { role: 'user' | 'assistant'; text: string };
    const messages: Msg[] = [];

    let sessionMeta: any = null;
    const MAX_MESSAGE_CHARS = 8000;

    function pushMessage(role: Msg['role'], text: string): void {
        const trimmed = text.trim();
        if (!trimmed) return;

        const last = messages[messages.length - 1];
        if (last && last.role === role && last.text === trimmed) {
            return;
        }

        const clipped = trimmed.length > MAX_MESSAGE_CHARS
            ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}\n…[truncated]`
            : trimmed;

        messages.push({ role, text: clipped });
    }

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line) as any;

            if (parsed?.type === 'session_meta' && parsed?.payload && typeof parsed.payload === 'object') {
                sessionMeta = parsed.payload;
                continue;
            }

            // Codex sessions primarily store messages as `response_item` entries.
            if (parsed?.type === 'response_item' && parsed?.payload && typeof parsed.payload === 'object') {
                const payload = parsed.payload as any;
                if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
                    const role: Msg['role'] = payload.role === 'assistant' ? 'assistant' : 'user';
                    const content = payload.content;
                    const parts: string[] = [];
                    if (Array.isArray(content)) {
                        for (const c of content) {
                            if (c && typeof c === 'object' && typeof c.text === 'string') {
                                parts.push(c.text);
                            }
                        }
                    } else if (typeof content === 'string') {
                        parts.push(content);
                    }
                    if (parts.length > 0) {
                        pushMessage(role, parts.join('\n'));
                    }
                    continue;
                }
            }

            if (parsed?.type === 'event_msg' && parsed?.payload && typeof parsed.payload === 'object') {
                const payload = parsed.payload;
                if (payload.type === 'user_message' && typeof payload.message === 'string') {
                    pushMessage('user', payload.message);
                }
                if (payload.type === 'agent_message' && typeof payload.message === 'string') {
                    pushMessage('assistant', payload.message);
                }
            }
        } catch {
            // ignore
        }
    }

    const tailCount = Math.max(0, Math.min(100, opts?.tailCount ?? 30));
    const tail = tailCount === 0 ? [] : messages.slice(-tailCount);
    const headerParts: string[] = [];
    if (sessionMeta?.cwd) headerParts.push(`cwd: ${sessionMeta.cwd}`);
    if (sessionMeta?.git?.branch) headerParts.push(`git.branch: ${sessionMeta.git.branch}`);
    if (sessionMeta?.git?.commit_hash) headerParts.push(`git.commit: ${sessionMeta.git.commit_hash}`);
    if (sessionMeta?.model_provider) headerParts.push(`provider: ${sessionMeta.model_provider}`);

    const header = headerParts.length > 0 ? headerParts.join(' | ') : 'previous session';

    const body = tail
        .map((m) => `--- ${m.role} ---\n${m.text}`)
        .join('\n\n');

    return `${header}\n\n${body}`.trim();
}

export async function resumeCodex(resume: true | string | undefined): Promise<CodexResumeResult> {
    const initialResumeTranscriptFile = await resolveInitialCodexResumeTranscriptFile(resume);
    if (!initialResumeTranscriptFile) {
        return {
            resumeTranscriptFile: null,
            resumeContext: null,
            resumeContextForUi: null,
            resumeExecSummary: null,
        };
    }

    try {
        const meta = parseCodexSessionMetaFromTranscript(initialResumeTranscriptFile);
        const sessionId = meta.sessionId;
        const cwd = meta.cwd || process.cwd();

        const execSummary = sessionId
            ? await generateCodexExecResumeSummary({
                sessionId,
                cwd,
                prompt: [
                    'Write a compaction-style resume of the resumed session.',
                    '',
                    'Output markdown with these sections:',
                    '- Goal',
                    '- Current state',
                    '- Key decisions',
                    '- Files/paths mentioned (if any)',
                    '- Open questions / blockers (if any)',
                    '- Next steps (prioritized)',
                    '',
                    'Keep it concise, factual, and actionable. No preamble.',
                ].join('\n'),
            })
            : null;

        const transcriptTail = buildCodexResumeContextFromTranscript(initialResumeTranscriptFile, { tailCount: 30 });
        const transcriptTailForUi = buildCodexResumeContextFromTranscript(initialResumeTranscriptFile, { tailCount: 8 });

        const summaryBlock = execSummary
            ? `## Resume summary (from codex exec resume)\n\n${execSummary}`
            : null;

        const resumeContext = [
            summaryBlock,
            `## Recent messages (from transcript)\n\n${transcriptTail}`,
        ].filter(Boolean).join('\n\n');

        const resumeContextForUi = [
            `**Resume context injected**`,
            `- Transcript: ${initialResumeTranscriptFile}`,
            '',
            summaryBlock,
            `## Recent messages (from transcript; last 8)\n\n${transcriptTailForUi}`,
        ].filter(Boolean).join('\n');

        logger.debug('[Codex][resume] Loaded resume context', {
            transcript: initialResumeTranscriptFile,
            hasExecSummary: Boolean(execSummary),
        });

        return {
            resumeTranscriptFile: initialResumeTranscriptFile,
            resumeContext,
            resumeContextForUi,
            resumeExecSummary: execSummary,
        };
    } catch (e) {
        logger.debug('[Codex][resume] Failed to build resume context', e);
        return {
            resumeTranscriptFile: null,
            resumeContext: null,
            resumeContextForUi: null,
            resumeExecSummary: null,
        };
    }
}

