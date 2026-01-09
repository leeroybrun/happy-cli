# Happy

Code on the go controlling claude code from your mobile device.

Free. Open source. Code anywhere.

## Fork additions (leeroybrun)

This fork tracks upstream (`slopus/happy-cli`) and adds a few features used by **Happy Stacks**.

- **Resume from UI (Claude + Codex)**: accepts a `resume` session id from the mobile/web UI and forwards it to the spawned agent via `--resume`.
- **Codex resume by session id (codex-reply)**: allows resuming a Codex session from a session id using the `codex-reply` MCP tool.
  - Requires a Codex build that provides the `codex-reply` MCP tool call. See: https://github.com/leeroybrun/codex/tree/feat/mcp-codex-reply-session-recovery
  - Set `HAPPY_CODEX_BIN` to point at that Codex binary.
- **Execpolicy approvals + MCP tool calls**: support for execpolicy approval flows and forwarding MCP tool calls (upstream PR: https://github.com/slopus/happy-cli/pull/102)

## Installation

```bash
npm install -g happy-coder
```

## Usage

```bash
happy
```

This will:
1. Start a Claude Code session
2. Display a QR code to connect from your mobile device
3. Allow real-time session sharing between Claude Code and your mobile app

## Commands

- `happy auth` – Manage authentication
- `happy codex` – Start Codex mode
- `happy connect` – Store AI vendor API keys in Happy cloud
- `happy notify` – Send a push notification to your devices
- `happy daemon` – Manage background service
- `happy doctor` – System diagnostics & troubleshooting

## Options

- `-h, --help` - Show help
- `-v, --version` - Show version
- `-m, --model <model>` - Claude model to use (default: sonnet)
- `-p, --permission-mode <mode>` - Permission mode: auto, default, or plan
- `--claude-env KEY=VALUE` - Set environment variable for Claude Code (e.g., for [claude-code-router](https://github.com/musistudio/claude-code-router))
- `--claude-arg ARG` - Pass additional argument to Claude CLI

## Environment Variables

- `HAPPY_SERVER_URL` - Custom server URL (default: https://api.cluster-fluster.com)
- `HAPPY_WEBAPP_URL` - Custom web app URL (default: https://app.happy.engineering)
- `HAPPY_HOME_DIR` - Custom home directory for Happy data (default: ~/.happy)
- `HAPPY_CODEX_BIN` - Path to the `codex` binary to use for Codex mode (useful for custom Codex builds)
- `HAPPY_DISABLE_CAFFEINATE` - Disable macOS sleep prevention (set to `true`, `1`, or `yes`)
- `HAPPY_EXPERIMENTAL` - Enable experimental features (set to `true`, `1`, or `yes`)

## Requirements

- Node.js >= 20.0.0
  - Required by `eventsource-parser@3.0.5`, which is required by
  `@modelcontextprotocol/sdk`, which we used to implement permission forwarding
  to mobile app
- Claude CLI installed & logged in (`claude` command available in PATH)

## License

MIT
