import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockClaudeBackend } from "./backend.js";
import { createServer } from "./server.js";
import assert from "node:assert";

// ── Helpers ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: unknown) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name}`);
    console.log(`    ${msg}`);
  }
}

async function createTestEnv() {
  const mock = new MockClaudeBackend();
  const server = createServer(mock);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, mock, server };
}

// ── Tests ───────────────────────────────────────────────────────────

console.log("\n🧪 Claude CLI Bridge MCP Server Tests\n");

console.log("── Server Initialization ──");

await test("server responds to initialize handshake", async () => {
  const { client } = await createTestEnv();
  // If we got here, the handshake succeeded
  assert.ok(client, "Client connected successfully");
});

console.log("\n── Tool Discovery ──");

await test("server exposes all 6 tools", async () => {
  const { client } = await createTestEnv();
  const { tools } = await client.listTools();
  assert.strictEqual(tools.length, 6);
});

await test("tool names are correct", async () => {
  const { client } = await createTestEnv();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepStrictEqual(names, [
    "claude_code_task",
    "claude_continue",
    "claude_prompt",
    "claude_resume",
    "claude_status",
    "claude_structured",
  ]);
});

await test("each tool has a description", async () => {
  const { client } = await createTestEnv();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 10, `${tool.name} missing description`);
  }
});

await test("each tool has an input schema", async () => {
  const { client } = await createTestEnv();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
  }
});

console.log("\n── claude_prompt ──");

await test("sends prompt and returns mock response", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "Hello from mock CLI", stderr: "", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Say hello" },
  });

  assert.ok(result.content);
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("Hello from mock CLI"), `Got: ${text}`);
});

await test("passes correct CLI args for prompt", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Test prompt" },
  });

  assert.strictEqual(mock.calls.length, 1);
  const call = mock.calls[0];
  assert.ok(call.args.includes("--print"), "Should include --print");
  assert.ok(call.args.includes("Test prompt"), "Should include the prompt text");
});

await test("passes model flag when specified", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", model: "opus" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--model"), "Should include --model");
  assert.ok(call.args.includes("opus"), "Should include model name");
});

await test("passes system prompt when specified", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", systemPrompt: "You are a pirate" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--system-prompt"), "Should include --system-prompt");
  assert.ok(call.args.includes("You are a pirate"), "Should include system prompt text");
});

await test("uses custom working directory", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", workingDirectory: "/tmp/myproject" },
  });

  assert.strictEqual(mock.calls[0].cwd, "/tmp/myproject");
});

await test("formats stderr in output", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "OK", stderr: "warning: something", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Test" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("[stderr]"), "Should include stderr label");
  assert.ok(text.includes("warning: something"), "Should include stderr content");
});

await test("formats non-zero exit code in output", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "", stderr: "error", exitCode: 1 });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Fail" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("[exit code: 1]"), "Should include exit code");
});

console.log("\n── claude_code_task ──");

await test("sends task with dangerously-skip-permissions", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Fix the bug", workingDirectory: "/tmp/project" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--dangerously-skip-permissions"), "Should skip permissions");
  assert.ok(call.args.includes("--print"), "Should use print mode");
  assert.ok(call.args.includes("Fix the bug"), "Should include the task");
  assert.strictEqual(call.cwd, "/tmp/project");
});

await test("uses 600s default timeout for code tasks", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Big task", workingDirectory: "/tmp" },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 600_000);
});

await test("respects custom timeout", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Quick task", workingDirectory: "/tmp", timeoutSeconds: 30 },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 30_000);
});

console.log("\n── claude_structured ──");

await test("uses json output format", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: '{"result": "ok"}', stderr: "", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Get data" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--output-format"), "Should include --output-format");
  assert.ok(call.args.includes("json"), "Should specify json format");

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes('"result"'), "Should return JSON content");
});

await test("passes json-schema when specified", async () => {
  const { client, mock } = await createTestEnv();
  const schema = '{"type":"object","properties":{"name":{"type":"string"}}}';

  await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Get name", jsonSchema: schema },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--json-schema"), "Should include --json-schema");
  assert.ok(call.args.includes(schema), "Should include the schema");
});

console.log("\n── claude_continue ──");

await test("uses --continue flag", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_continue",
    arguments: { prompt: "Keep going", workingDirectory: "/tmp/project" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--continue"), "Should include --continue");
  assert.ok(call.args.includes("--dangerously-skip-permissions"), "Should skip permissions");
});

console.log("\n── claude_resume ──");

await test("uses --resume with session ID", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_resume",
    arguments: { sessionId: "abc-123", prompt: "Continue this" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--resume"), "Should include --resume");
  assert.ok(call.args.includes("abc-123"), "Should include session ID");
});

console.log("\n── claude_status ──");

await test("calls --version and doctor", async () => {
  const { client, mock } = await createTestEnv();
  mock.setResponse("--version", { stdout: "2.1.71 (Claude Code)", stderr: "", exitCode: 0 });
  mock.setResponse("doctor", { stdout: "All checks passed", stderr: "", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_status",
    arguments: {},
  });

  assert.strictEqual(mock.calls.length, 2, "Should make 2 backend calls");
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("2.1.71"), "Should include version");
  assert.ok(text.includes("All checks passed"), "Should include doctor output");
});

console.log("\n── Pattern Matching Responses ──");

await test("mock returns specific response for matched pattern", async () => {
  const { client, mock } = await createTestEnv();
  mock.setResponse("special-prompt", {
    stdout: "Special response!",
    stderr: "",
    exitCode: 0,
  });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "This is a special-prompt test" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("Special response!"), `Got: ${text}`);
});

console.log("\n── Empty/Edge Cases ──");

await test("handles empty output gracefully", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "", stderr: "", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Silent" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.strictEqual(text, "[no output]");
});

await test("handles allowed tools array", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", allowedTools: ["Bash", "Read"] },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--allowedTools"), "Should include --allowedTools");
  assert.ok(call.args.includes("Bash"), "Should include Bash");
  assert.ok(call.args.includes("Read"), "Should include Read");
});

await test("handles maxBudgetUsd", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", maxBudgetUsd: 0.5 },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--max-budget-usd"), "Should include --max-budget-usd");
  assert.ok(call.args.includes("0.5"), "Should include budget value");
});

console.log("\n── Nullish Coalescing Edge Cases ──");

await test("timeoutSeconds: 0 does not fall through to default", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", timeoutSeconds: 0 },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 0, "Should pass 0ms timeout, not default");
});

await test("claude_prompt custom timeout passes through", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", timeoutSeconds: 60 },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 60_000);
});

console.log("\n── claude_code_task (extended) ──");

await test("claude_code_task passes model flag", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Refactor", workingDirectory: "/tmp", model: "haiku" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--model"), "Should include --model");
  assert.ok(call.args.includes("haiku"), "Should include model name");
});

await test("claude_code_task passes allowedTools", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Test", workingDirectory: "/tmp", allowedTools: ["Bash", "Edit"] },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--allowedTools"), "Should include --allowedTools");
  assert.ok(call.args.includes("Bash"), "Should include Bash");
  assert.ok(call.args.includes("Edit"), "Should include Edit");
});

await test("claude_code_task passes maxBudgetUsd", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Build", workingDirectory: "/tmp", maxBudgetUsd: 1.0 },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--max-budget-usd"), "Should include --max-budget-usd");
  assert.ok(call.args.includes("1"), "Should include budget value");
});

console.log("\n── claude_structured (extended) ──");

await test("claude_structured falls back to stderr when stdout empty", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "", stderr: "Parse error", exitCode: 1 });

  const result = await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Bad query" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("Parse error"), `Should fall back to stderr, got: ${text}`);
});

await test("claude_structured passes model", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Data", model: "sonnet" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--model"), "Should include --model");
  assert.ok(call.args.includes("sonnet"), "Should include model name");
});

console.log("\n── claude_continue (extended) ──");

await test("claude_continue passes prompt and cwd correctly", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_continue",
    arguments: { prompt: "Next step", workingDirectory: "/home/user/project" },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("Next step"), "Should include the prompt");
  assert.strictEqual(call.cwd, "/home/user/project", "Should use provided cwd");
});

console.log("\n── claude_resume (extended) ──");

await test("claude_resume defaults cwd to homedir when not provided", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_resume",
    arguments: { sessionId: "xyz-789", prompt: "Go on" },
  });

  const call = mock.calls[0];
  // homedir() varies, but should not be empty
  assert.ok(call.cwd.length > 0, "Should have a non-empty cwd");
  assert.ok(call.args.includes("xyz-789"), "Should include session ID");
  assert.ok(call.args.includes("Go on"), "Should include prompt");
});

await test("claude_resume passes custom working directory", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_resume",
    arguments: { sessionId: "s1", prompt: "Hi", workingDirectory: "/opt/app" },
  });

  assert.strictEqual(mock.calls[0].cwd, "/opt/app");
});

console.log("\n── Arg Ordering ──");

await test("--print and prompt are last args in claude_prompt", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Do something", model: "opus", systemPrompt: "Be brief" },
  });

  const call = mock.calls[0];
  const printIdx = call.args.indexOf("--print");
  const promptIdx = call.args.indexOf("Do something");
  assert.ok(printIdx < promptIdx, "--print should come before prompt");
  assert.strictEqual(promptIdx, call.args.length - 1, "Prompt should be last arg");
});

await test("--dangerously-skip-permissions present in claude_code_task", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Deploy", workingDirectory: "/tmp" },
  });

  const call = mock.calls[0];
  const dspIdx = call.args.indexOf("--dangerously-skip-permissions");
  const taskIdx = call.args.indexOf("Deploy");
  assert.ok(dspIdx >= 0, "Should have --dangerously-skip-permissions");
  assert.ok(taskIdx > dspIdx, "Task should come after --dangerously-skip-permissions");
});

console.log("\n── formatResult Edge Cases ──");

await test("exitCode: 0 does NOT produce exit code line", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "Success output", stderr: "", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Test" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.strictEqual(text, "Success output", "Should be exactly stdout with no exit code decoration");
});

await test("exitCode: null does NOT produce exit code line", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "Partial", stderr: "\n[Timed out after 5s]", exitCode: null });

  const result = await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Test" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(!text.includes("[exit code"), "Should NOT include exit code line for null");
  assert.ok(text.includes("Timed out"), "Should include timeout message from stderr");
});

console.log("\n── Empty Array / Zero Value Edge Cases ──");

await test("allowedTools: [] (empty array) does NOT add --allowedTools flag", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", allowedTools: [] },
  });

  const call = mock.calls[0];
  assert.ok(!call.args.includes("--allowedTools"), "Should NOT include --allowedTools for empty array");
});

await test("maxBudgetUsd: 0 DOES add --max-budget-usd flag", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", maxBudgetUsd: 0 },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--max-budget-usd"), "Should include --max-budget-usd for 0");
  assert.ok(call.args.includes("0"), "Should include value 0");
});

await test("claude_code_task: allowedTools: [] does NOT add flag", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Test", workingDirectory: "/tmp", allowedTools: [] },
  });

  const call = mock.calls[0];
  assert.ok(!call.args.includes("--allowedTools"), "Should NOT include --allowedTools for empty array");
});

await test("claude_code_task: maxBudgetUsd: 0 DOES add flag", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Test", workingDirectory: "/tmp", maxBudgetUsd: 0 },
  });

  const call = mock.calls[0];
  assert.ok(call.args.includes("--max-budget-usd"), "Should include --max-budget-usd for 0");
});

console.log("\n── Default Timeout Verification ──");

await test("claude_prompt defaults to 300s timeout", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello" },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 300_000);
});

await test("claude_continue defaults to 300s timeout", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_continue",
    arguments: { prompt: "Next", workingDirectory: "/tmp" },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 300_000);
});

await test("claude_resume defaults to 300s timeout", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_resume",
    arguments: { sessionId: "s1", prompt: "Go" },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 300_000);
});

await test("claude_structured defaults to 300s timeout", async () => {
  const { client, mock } = await createTestEnv();

  await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Data" },
  });

  assert.strictEqual(mock.calls[0].timeoutMs, 300_000);
});

console.log("\n── claude_structured Output Behavior ──");

await test("claude_structured returns only stdout when both stdout and stderr present", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: '{"ok":true}', stderr: "some warning", exitCode: 0 });

  const result = await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Get JSON" },
  });

  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.strictEqual(text, '{"ok":true}', "Should return raw stdout, not stderr");
});

console.log("\n── claude_status Internals ──");

await test("claude_status: --version call uses correct args and 10s timeout", async () => {
  const { client, mock } = await createTestEnv();
  mock.setResponse("--version", { stdout: "2.1.71", stderr: "", exitCode: 0 });
  mock.setResponse("doctor", { stdout: "OK", stderr: "", exitCode: 0 });

  await client.callTool({ name: "claude_status", arguments: {} });

  // Find which call has --version
  const versionCall = mock.calls.find((c) => c.args.includes("--version"));
  const doctorCall = mock.calls.find((c) => c.args.includes("doctor"));
  assert.ok(versionCall, "Should have a --version call");
  assert.ok(doctorCall, "Should have a doctor call");
  assert.strictEqual(versionCall.timeoutMs, 10_000, "--version timeout should be 10s");
  assert.strictEqual(doctorCall.timeoutMs, 15_000, "doctor timeout should be 15s");
});

await test("claude_status: version empty shows 'unknown'", async () => {
  const { client, mock } = await createTestEnv();
  mock.setResponse("--version", { stdout: "", stderr: "", exitCode: 1 });
  mock.setResponse("doctor", { stdout: "All OK", stderr: "", exitCode: 0 });

  const result = await client.callTool({ name: "claude_status", arguments: {} });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("unknown"), "Should show 'unknown' when version stdout is empty");
});

await test("claude_status: doctor falls back to stderr", async () => {
  const { client, mock } = await createTestEnv();
  mock.setResponse("--version", { stdout: "2.1.71", stderr: "", exitCode: 0 });
  mock.setResponse("doctor", { stdout: "", stderr: "Doctor failed", exitCode: 1 });

  const result = await client.callTool({ name: "claude_status", arguments: {} });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("Doctor failed"), "Should show doctor stderr when stdout empty");
});

await test("claude_status: doctor shows [no output] when both empty", async () => {
  const { client, mock } = await createTestEnv();
  mock.setResponse("--version", { stdout: "2.1.71", stderr: "", exitCode: 0 });
  mock.setResponse("doctor", { stdout: "", stderr: "", exitCode: 0 });

  const result = await client.callTool({ name: "claude_status", arguments: {} });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("[no output]"), "Should show [no output] when doctor has no output");
});

console.log("\n── Security: Negative Assertions ──");

await test("claude_prompt does NOT include --dangerously-skip-permissions", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({
    name: "claude_prompt",
    arguments: { prompt: "Hello", model: "opus", allowedTools: ["Bash"] },
  });
  const call = mock.calls[0];
  assert.ok(!call.args.includes("--dangerously-skip-permissions"), "claude_prompt must NOT skip permissions");
});

await test("claude_structured does NOT include --dangerously-skip-permissions", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({
    name: "claude_structured",
    arguments: { prompt: "Get data", model: "sonnet" },
  });
  const call = mock.calls[0];
  assert.ok(!call.args.includes("--dangerously-skip-permissions"), "claude_structured must NOT skip permissions");
});

console.log("\n── Arg Ordering: continue/resume/structured ──");

await test("claude_continue: prompt is last arg, --print is first", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({
    name: "claude_continue",
    arguments: { prompt: "Next step", workingDirectory: "/tmp" },
  });
  const call = mock.calls[0];
  assert.strictEqual(call.args[0], "--print", "--print should be first arg");
  assert.strictEqual(call.args[call.args.length - 1], "Next step", "Prompt should be last arg");
  assert.ok(call.args.includes("--dangerously-skip-permissions"), "Should include --dangerously-skip-permissions");
});

await test("claude_resume: prompt is last arg, --print is first, session ID follows --resume", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({
    name: "claude_resume",
    arguments: { sessionId: "abc-123", prompt: "Continue", workingDirectory: "/tmp" },
  });
  const call = mock.calls[0];
  assert.strictEqual(call.args[0], "--print", "--print should be first arg");
  assert.strictEqual(call.args[call.args.length - 1], "Continue", "Prompt should be last arg");
  const resumeIdx = call.args.indexOf("--resume");
  assert.strictEqual(call.args[resumeIdx + 1], "abc-123", "Session ID should follow --resume");
  assert.ok(call.args.includes("--dangerously-skip-permissions"), "Should include --dangerously-skip-permissions");
});

await test("claude_code_task: task is the absolute last arg", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({
    name: "claude_code_task",
    arguments: { task: "Deploy it", workingDirectory: "/tmp", model: "opus", maxBudgetUsd: 5 },
  });
  const call = mock.calls[0];
  assert.strictEqual(call.args[call.args.length - 1], "Deploy it", "Task should be the absolute last arg");
});

console.log("\n── formatResult Additional Combos ──");

await test("formatResult: only stdout with non-zero exit code", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "partial output", stderr: "", exitCode: 2 });
  const result = await client.callTool({ name: "claude_prompt", arguments: { prompt: "Test" } });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("partial output"), "Should include stdout");
  assert.ok(text.includes("[exit code: 2]"), "Should include exit code");
  assert.ok(!text.includes("[stderr]"), "Should NOT include stderr section");
});

await test("formatResult: only stderr with exit code 0", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "", stderr: "warning only", exitCode: 0 });
  const result = await client.callTool({ name: "claude_prompt", arguments: { prompt: "Test" } });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.ok(text.includes("[stderr]"), "Should include stderr section");
  assert.ok(text.includes("warning only"), "Should include stderr content");
  assert.ok(!text.includes("[exit code"), "Should NOT include exit code for 0");
});

await test("formatResult: both empty with non-zero exit code", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "", stderr: "", exitCode: 2 });
  const result = await client.callTool({ name: "claude_prompt", arguments: { prompt: "Test" } });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.strictEqual(text, "[exit code: 2]", "Should be only the exit code");
});

console.log("\n── claude_structured Edge Cases ──");

await test("claude_structured: both empty returns [no output]", async () => {
  const { client, mock } = await createTestEnv();
  mock.setDefaultResponse({ stdout: "", stderr: "", exitCode: 0 });
  const result = await client.callTool({ name: "claude_structured", arguments: { prompt: "Test" } });
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.strictEqual(text, "[no output]", "Should return [no output] when both empty");
});

console.log("\n── Default Working Directory ──");

await test("claude_prompt defaults cwd to homedir", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({ name: "claude_prompt", arguments: { prompt: "Hello" } });
  const { homedir } = await import("os");
  assert.strictEqual(mock.calls[0].cwd, homedir(), "Should default to homedir()");
});

await test("claude_resume defaults cwd to homedir (strict)", async () => {
  const { client, mock } = await createTestEnv();
  await client.callTool({ name: "claude_resume", arguments: { sessionId: "s1", prompt: "Go" } });
  const { homedir } = await import("os");
  assert.strictEqual(mock.calls[0].cwd, homedir(), "Should default to homedir()");
});

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
} else {
  console.log("\n✅ All tests passed!\n");
}
