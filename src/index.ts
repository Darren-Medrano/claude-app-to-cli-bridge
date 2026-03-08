import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RealClaudeBackend } from "./backend.js";
import { createServer } from "./server.js";

async function main() {
  const backend = new RealClaudeBackend();
  const server = createServer(backend);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write("Fatal: " + String(err) + "\n");
  process.exit(1);
});
