/**
 * Agent capability configuration.
 *
 * This module defines which agents support specific features like session resume.
 * The configuration can be extended by forks to enable additional capabilities.
 *
 * For upstream (slopus): Only Claude supports resume
 * For forks: Can extend to include Codex, etc.
 */

export type AgentType = 'claude' | 'codex' | 'gemini';

/**
 * List of agents that support resuming sessions.
 *
 * To enable resume for additional agents (e.g., Codex in a fork),
 * simply add them to this array.
 *
 * Note: Codex resume requires a custom Codex build with MCP resume support.
 */
export const RESUMABLE_AGENTS: AgentType[] = [
    'claude',
    'codex', // Fork: Codex resume enabled (requires custom Codex build with MCP resume)
];

/**
 * Check if an agent type supports session resume.
 */
export function canAgentResume(agent: AgentType | undefined): boolean {
    if (!agent) return RESUMABLE_AGENTS.includes('claude'); // Default to claude
    return RESUMABLE_AGENTS.includes(agent);
}
