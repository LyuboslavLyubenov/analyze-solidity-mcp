#!/usr/bin/env node

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import registerAnalyzeFn from "./tools/analyze-fn";
import { readFileSync } from "fs";

const MCPServerName = "analyze-solidity-mcp";

// Check if the script is being run as a CLI tool by checking process.argv
const isCliMode = process.argv.length > 2 && !process.argv[1].includes('cli.js');

// Debug information
console.log("Process argv:", process.argv);
console.log("Is CLI mode:", isCliMode);

if (isCliMode) {
  console.log("Running as CLI tool");
  // Handle CLI arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log("Usage: analyze-solidity-mcp &lt;solidity-file&gt;");
    process.exit(1);
  }
  
  const filePath = args[0];
  
  try {
    const sourceCode = readFileSync(filePath, 'utf8');
    console.log(`Analyzing Solidity file: ${filePath}`);
    // Here you would call your analysis function
    console.log("Analysis complete (placeholder output)");
  } catch (error) {
    console.error("Error reading file:", error);
    process.exit(1);
  }
} else {
  console.log("Running as MCP server");
  // Start as MCP server
  const app = express();
  app.use(express.json());

  function getServer() {
    const server = new McpServer({
      name: MCPServerName,
      version: "0.1.0",
    });

    registerAnalyzeFn(server);

    return server;
  }

  app.post("/mcp", async (req, res) => {
    try {
      const server = getServer();
      const transport: StreamableHTTPServerTransport =
        new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
      res.on("close", () => {
        console.log("Request closed");
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, (err) => {
    console.log(`${MCPServerName} MCP HTTP server listening on port ${PORT}`);
    console.error(err);
  });
}
