export type AgentType = 'claude' | 'codex' | 'gemini';

/**
 * Vendor-level resume support (NOT Happy session resume).
 *
 * This controls whether we are allowed to pass `--resume <vendorSessionId>` to the agent.
 *
 * NOTE: This branch includes Codex resume support and is expected to remain fork-only
 * unless/until upstream Codex gains a real resume mechanism.
 */
export const VENDOR_RESUME_SUPPORTED_AGENTS: AgentType[] = ['claude', 'codex'];

export function supportsVendorResume(agent: AgentType | undefined): boolean {
  // Undefined agent means "default agent" which is Claude in this CLI.
  if (!agent) return VENDOR_RESUME_SUPPORTED_AGENTS.includes('claude');
  return VENDOR_RESUME_SUPPORTED_AGENTS.includes(agent);
}

