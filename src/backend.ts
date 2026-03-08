import { spawn } from "child_process";
import { homedir } from "os";
import { resolve } from "path";

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface BackendCall {
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface ClaudeBackend {
  execute(args: string[], cwd: string, timeoutMs: number): Promise<ExecuteResult>;
}

/**
 * Real backend: spawns the actual Claude CLI process.
 * Used in production when the MCP server is running for Claude Desktop.
 */
export class RealClaudeBackend implements ClaudeBackend {
  private cliBin: string;

  constructor(cliBin?: string) {
    this.cliBin =
      cliBin ||
      process.env.CLAUDE_CLI_PATH ||
      resolve(homedir(), ".local/bin/claude");
  }

  execute(args: string[], cwd: string, timeoutMs: number): Promise<ExecuteResult> {
    return new Promise((res) => {
      // Filter out CLAUDECODE env var to prevent nested session detection
      const env = { ...process.env };
      delete env.CLAUDECODE;

      let proc;
      try {
        proc = spawn(this.cliBin, args, {
          cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        res({ stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: 1 });
        return;
      }

      let stdout = "";
      let stderr = "";
      let resolved = false;

      const done = (result: ExecuteResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        res(result);
      };

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        done({ stdout, stderr: stderr + `\n[Timed out after ${timeoutMs / 1000}s]`, exitCode: null });
      }, timeoutMs);

      proc.on("close", (code) => {
        done({ stdout, stderr, exitCode: code });
      });

      proc.on("error", (err) => {
        done({ stdout, stderr: stderr + (stderr ? "\n" : "") + err.message, exitCode: 1 });
      });
    });
  }
}

/**
 * Mock backend: returns configurable responses and records all calls.
 * Used for testing the full MCP protocol without invoking the real CLI.
 */
export class MockClaudeBackend implements ClaudeBackend {
  public calls: BackendCall[] = [];
  private responses: Map<string, ExecuteResult> = new Map();
  private defaultResponse: ExecuteResult = {
    stdout: "Mock response from Claude CLI",
    stderr: "",
    exitCode: 0,
  };

  /** Set a response for a specific argument pattern (matched against args joined) */
  setResponse(pattern: string, result: ExecuteResult): void {
    this.responses.set(pattern, result);
  }

  /** Set the default response for unmatched calls */
  setDefaultResponse(result: ExecuteResult): void {
    this.defaultResponse = result;
  }

  /** Reset all calls and custom responses */
  reset(): void {
    this.calls = [];
    this.responses.clear();
  }

  async execute(args: string[], cwd: string, timeoutMs: number): Promise<ExecuteResult> {
    this.calls.push({ args, cwd, timeoutMs });

    const argsStr = args.join(" ");
    for (const [pattern, result] of this.responses) {
      if (argsStr.includes(pattern)) {
        return { ...result };
      }
    }

    return { ...this.defaultResponse };
  }
}
