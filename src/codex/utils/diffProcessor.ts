/**
 * Diff Processor - Handles turn_diff messages and tracks unified_diff changes
 * 
 * This processor tracks changes to the unified_diff field in turn_diff messages
 * and sends CodexDiff tool calls when the diff changes from its previous value.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@/ui/logger';
import { configuration } from '@/configuration';

export interface DiffToolCall {
    type: 'tool-call';
    name: 'CodexDiff';
    callId: string;
    input: {
        unified_diff: string;
    };
    id: string;
}

export interface DiffToolResult {
    type: 'tool-call-result';
    callId: string;
    output: {
        status: 'completed';
    };
    id: string;
}

export class DiffProcessor {
    private previousDiff: string | null = null;
    private sentDiff: string | null = null;
    private patchAppliedThisTurn: boolean = false;
    private onMessage: ((message: any) => void) | null = null;

    constructor(onMessage?: (message: any) => void) {
        this.onMessage = onMessage || null;
    }

    /**
     * Process a turn_diff message and check if the unified_diff has changed
     */
    processDiff(unifiedDiff: string): void {
        if (configuration.disableCodexDiffs) {
            this.previousDiff = unifiedDiff;
            logger.debug('[DiffProcessor] Codex diff emission disabled (HAPPY_DISABLE_CODEX_DIFFS/HAPPY_DISABLE_DIFFS)');
            return;
        }
        this.previousDiff = unifiedDiff;
        logger.debug('[DiffProcessor] Updated stored diff (buffered)');
    }

    /**
     * Emit the latest diff once (typically at end-of-turn) to avoid spamming intermediate updates.
     */
    flush(): void {
        if (configuration.disableCodexDiffs) {
            return;
        }
        if (this.patchAppliedThisTurn) {
            logger.debug('[DiffProcessor] Skipping CodexDiff flush because a patch was applied this turn');
            return;
        }
        const unifiedDiff = this.previousDiff;
        if (!unifiedDiff) {
            return;
        }
        if (this.sentDiff === unifiedDiff) {
            return;
        }
        logger.debug('[DiffProcessor] Flushing unified diff as CodexDiff tool call');

        const callId = randomUUID();
        const toolCall: DiffToolCall = {
            type: 'tool-call',
            name: 'CodexDiff',
            callId,
            input: { unified_diff: unifiedDiff },
            id: randomUUID(),
        };
        this.onMessage?.(toolCall);

        const toolResult: DiffToolResult = {
            type: 'tool-call-result',
            callId,
            output: { status: 'completed' },
            id: randomUUID(),
        };
        this.onMessage?.(toolResult);

        this.sentDiff = unifiedDiff;
    }

    /**
     * Reset the processor state (called on task_complete or turn_aborted)
     */
    reset(): void {
        logger.debug('[DiffProcessor] Resetting diff state');
        this.previousDiff = null;
        this.patchAppliedThisTurn = false;
    }

    /**
     * Mark that a structured patch was applied this turn; we can prefer CodexPatch diffs over turn diffs.
     */
    markPatchApplied(): void {
        this.patchAppliedThisTurn = true;
    }

    /**
     * Set the message callback for sending messages directly
     */
    setMessageCallback(callback: (message: any) => void): void {
        this.onMessage = callback;
    }

    /**
     * Get the current diff value
     */
    getCurrentDiff(): string | null {
        return this.previousDiff;
    }
}
