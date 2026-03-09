# Claude CLI Bridge

An MCP server that lets the **Claude macOS desktop app** invoke **Claude CLI (Claude Code)** to perform real software engineering tasks — editing files, running commands, searching code, and more.

```
Claude Desktop App  →  MCP Server (stdio)  →  Claude CLI  →  reads/writes files, runs commands, etc.
```

## Tools

| Tool | Description |
|------|-------------|
| `claude_prompt` | Send a prompt in print mode. For questions, analysis, content generation. |
| `claude_code_task` | Delegate a coding task with full tool access (read/write/execute). Runs autonomously. |
| `claude_structured` | Get structured JSON output, optionally validated against a JSON Schema. |
| `claude_continue` | Continue the most recent conversation in a directory. For multi-step tasks. |
| `claude_resume` | Resume a specific session by ID. |
| `claude_status` | Check CLI version and health (`--version` + `doctor`). |

## Prerequisites

- **Claude CLI** installed at `~/.local/bin/claude` (or set `CLAUDE_CLI_PATH`)
- **Node.js** >= 18.0.0
- Claude CLI authenticated (`claude` in terminal, accept permissions)

## Setup

### As MCPB Extension

Install the `.mcpb` package in Claude Desktop (Settings → Extensions).

### Manual Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claude-cli-bridge": {
      "command": "node",
      "args": ["/path/to/claude-cli-bridge/dist/index.js"]
    }
  }
}
```

Then restart Claude Desktop.

## Development

```bash
npm install
npm run build    # Compile TypeScript
npm test         # Run 62 tests (InMemoryTransport, no CLI needed)
npm start        # Start the stdio server
```

## Architecture

- **Transport**: stdio (Claude Desktop spawns the server process)
- **Server**: Custom MCP server built with `@modelcontextprotocol/sdk`
- **Backend**: Pluggable interface — `RealClaudeBackend` (spawns CLI) and `MockClaudeBackend` (tests)
- **Sessions**: Supports one-shot (`claude_prompt`), multi-turn (`claude_continue`, `claude_resume`), and autonomous (`claude_code_task`)
- **Testing**: Full MCP protocol tests via `InMemoryTransport` — no real CLI invocation needed

## License

MIT
