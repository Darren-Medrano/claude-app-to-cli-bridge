import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { homedir } from "os";
import { ClaudeBackend, ExecuteResult } from "./backend.js";

function formatResult(result: ExecuteResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push("[stderr]\n" + result.stderr);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    parts.push("[exit code: " + result.exitCode + "]");
  }
  return parts.join("\n\n") || "[no output]";
}

export function createServer(backend: ClaudeBackend): McpServer {
  const server = new McpServer({
    name: "claude-cli-bridge",
    version: "1.0.0",
  });

  // ── claude_prompt ─────────────────────────────────────────────────
  server.tool(
    "claude_prompt",
    "Send a prompt to Claude CLI in print mode and get the response. For questions, analysis, and content generation.",
    {
      prompt: z.string().describe("The prompt to send to Claude CLI"),
      workingDirectory: z
        .string()
        .optional()
        .describe("Directory context (defaults to home). Sets which project files are visible."),
      model: z.string().optional().describe('Model alias: "sonnet", "opus", "haiku"'),
      systemPrompt: z.string().optional().describe("Custom system prompt"),
      allowedTools: z
        .array(z.string())
        .optional()
        .describe('Tools to allow, e.g. ["Bash", "Read", "Edit"]'),
      maxBudgetUsd: z.number().optional().describe("Max dollar spend for this call"),
      timeoutSeconds: z.number().optional().describe("Timeout (default: 300)"),
    },
    async ({ prompt, workingDirectory, model, systemPrompt, allowedTools, maxBudgetUsd, timeoutSeconds }) => {
      const cwd = workingDirectory || homedir();
      const timeout = (timeoutSeconds ?? 300) * 1000;
      const args: string[] = [];

      if (model) args.push("--model", model);
      if (systemPrompt) args.push("--system-prompt", systemPrompt);
      if (allowedTools?.length) args.push("--allowedTools", ...allowedTools);
      if (maxBudgetUsd != null) args.push("--max-budget-usd", String(maxBudgetUsd));
      args.push("--print", prompt);

      const result = await backend.execute(args, cwd, timeout);
      return { content: [{ type: "text" as const, text: formatResult(result) }] };
    }
  );

  // ── claude_code_task ──────────────────────────────────────────────
  server.tool(
    "claude_code_task",
    "Delegate a real coding task to Claude CLI with full tool access (read/write files, run commands, etc). The CLI runs autonomously in the given directory.",
    {
      task: z.string().describe("Description of the coding task"),
      workingDirectory: z.string().describe("Project directory (absolute path)"),
      model: z.string().optional().describe('Model: "sonnet", "opus", "haiku"'),
      allowedTools: z
        .array(z.string())
        .optional()
        .describe("Specific tools to allow (default: all)"),
      maxBudgetUsd: z.number().optional().describe("Safety spending limit"),
      timeoutSeconds: z.number().optional().describe("Timeout (default: 600)"),
    },
    async ({ task, workingDirectory, model, allowedTools, maxBudgetUsd, timeoutSeconds }) => {
      const timeout = (timeoutSeconds ?? 600) * 1000;
      const args: string[] = [];

      if (model) args.push("--model", model);
      if (allowedTools?.length) args.push("--allowedTools", ...allowedTools);
      if (maxBudgetUsd != null) args.push("--max-budget-usd", String(maxBudgetUsd));
      args.push("--print", "--dangerously-skip-permissions", task);

      const result = await backend.execute(args, workingDirectory, timeout);
      return { content: [{ type: "text" as const, text: formatResult(result) }] };
    }
  );

  // ── claude_structured ─────────────────────────────────────────────
  server.tool(
    "claude_structured",
    "Get structured JSON output from Claude CLI. Useful for machine-readable responses.",
    {
      prompt: z.string().describe("The prompt"),
      workingDirectory: z.string().optional().describe("Directory context"),
      jsonSchema: z.string().optional().describe("JSON Schema to validate output against"),
      model: z.string().optional().describe("Model to use"),
      timeoutSeconds: z.number().optional().describe("Timeout (default: 300)"),
    },
    async ({ prompt, workingDirectory, jsonSchema, model, timeoutSeconds }) => {
      const cwd = workingDirectory || homedir();
      const timeout = (timeoutSeconds ?? 300) * 1000;
      const args: string[] = [];

      if (model) args.push("--model", model);
      if (jsonSchema) args.push("--json-schema", jsonSchema);
      args.push("--print", "--output-format", "json", prompt);

      const result = await backend.execute(args, cwd, timeout);
      return { content: [{ type: "text" as const, text: result.stdout || result.stderr || "[no output]" }] };
    }
  );

  // ── claude_continue ───────────────────────────────────────────────
  server.tool(
    "claude_continue",
    "Continue the most recent Claude CLI conversation in a directory. For multi-step tasks.",
    {
      prompt: z.string().describe("Follow-up prompt"),
      workingDirectory: z.string().describe("Directory of the previous conversation"),
      timeoutSeconds: z.number().optional().describe("Timeout (default: 300)"),
    },
    async ({ prompt, workingDirectory, timeoutSeconds }) => {
      const timeout = (timeoutSeconds ?? 300) * 1000;
      const args = ["--print", "--continue", "--dangerously-skip-permissions", prompt];

      const result = await backend.execute(args, workingDirectory, timeout);
      return { content: [{ type: "text" as const, text: formatResult(result) }] };
    }
  );

  // ── claude_resume ─────────────────────────────────────────────────
  server.tool(
    "claude_resume",
    "Resume a specific Claude CLI session by ID.",
    {
      sessionId: z.string().describe("Session ID to resume"),
      prompt: z.string().describe("Prompt to continue with"),
      workingDirectory: z.string().optional().describe("Working directory"),
      timeoutSeconds: z.number().optional().describe("Timeout (default: 300)"),
    },
    async ({ sessionId, prompt, workingDirectory, timeoutSeconds }) => {
      const cwd = workingDirectory || homedir();
      const timeout = (timeoutSeconds ?? 300) * 1000;
      const args = ["--print", "--resume", sessionId, "--dangerously-skip-permissions", prompt];

      const result = await backend.execute(args, cwd, timeout);
      return { content: [{ type: "text" as const, text: formatResult(result) }] };
    }
  );

  // ── claude_status ─────────────────────────────────────────────────
  server.tool(
    "claude_status",
    "Check Claude CLI version and health.",
    {},
    async () => {
      const [version, doctor] = await Promise.all([
        backend.execute(["--version"], homedir(), 10000),
        backend.execute(["doctor"], homedir(), 15000),
      ]);

      const text = [
        "Claude CLI Version: " + (version.stdout.trim() || "unknown"),
        "",
        "Doctor Output:",
        doctor.stdout || doctor.stderr || "[no output]",
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  return server;
}
