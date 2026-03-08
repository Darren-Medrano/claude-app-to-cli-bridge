# Claude App to CLI Bridge

An MCP server bridge that lets the **Claude macOS desktop app** invoke **Claude CLI (Claude Code)** to perform real software engineering tasks — editing files, running commands, searching code, and more.

## How It Works

This uses [steipete/claude-code-mcp](https://github.com/steipete/claude-code-mcp), an open-source MCP server that exposes a `claude_code` tool. When you ask Claude Desktop to do a coding task, it can delegate that work to Claude CLI running locally on your Mac.

```
Claude Desktop App  →  MCP Server (stdio)  →  Claude CLI  →  reads/writes files, runs commands, etc.
```

## Setup (Already Configured)

The MCP server has been added to your Claude Desktop config at:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Configuration:
```json
{
  "mcpServers": {
    "claude-code-bridge": {
      "command": "npx",
      "args": ["-y", "@steipete/claude-code-mcp@latest"],
      "env": {
        "CLAUDE_CLI_NAME": "/Users/office/.local/bin/claude"
      }
    }
  }
}
```

## Prerequisites

- **Claude CLI** installed at `~/.local/bin/claude` (v2.1.71+)
- **Node.js** v20+
- Claude CLI authenticated and permissions pre-accepted

## Usage

1. **Restart the Claude macOS app** (quit and reopen)
2. In Claude Desktop, you'll now have access to the `claude_code` tool
3. Ask Claude to do coding tasks and it will delegate to Claude CLI

### Example prompts in Claude Desktop:

- "Use claude_code to fix the TypeScript errors in ~/myproject/src/index.ts"
- "Use claude_code to add dark mode to my React app in ~/myproject"
- "Use claude_code to review the code in ~/myproject and suggest improvements"
- "Use claude_code to write tests for ~/myproject/src/utils.ts"

## Troubleshooting

### MCP server not showing up
- Quit and reopen Claude Desktop after editing the config
- Check `~/Library/Logs/Claude/` for error logs

### Claude CLI not found
- Verify: `which claude` should return `/Users/office/.local/bin/claude`
- Make sure `CLAUDE_CLI_NAME` env var in config points to the right path

### Permission errors
- Run `claude` in terminal first and accept any permission prompts
- The MCP server uses `--dangerously-skip-permissions` for non-interactive use

## Architecture

The bridge uses the **Model Context Protocol (MCP)** standard:
- **Transport**: stdio (Claude Desktop spawns the server process)
- **Server**: `@steipete/claude-code-mcp` (npm package, run via npx)
- **Backend**: Spawns Claude CLI processes for each request
- **Model**: One-shot execution (no persistent sessions)
