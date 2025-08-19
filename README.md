# Lyubos Toolbox Solidity MCP Server


https://github.com/user-attachments/assets/70ebb4af-7930-4158-b1af-bc851835b6a6


This repository contains an MCP (Model Context Protocol) server for analyzing Solidity contracts. Currently, it provides full function context analysis.

## Features

- Extracts and analyzes Solidity function contexts
- Provides detailed information about function parameters, visibility, modifiers, and body

## Usage

To run the MCP server, you can use Docker. The port can be specified via an environment variable.

### Docker

1. Build the Docker image:
```bash
docker build -t analyze-solidity-mcp .
```

2. Run the container with a custom port (default is 3000):
```bash
docker run -e PORT=8080 -p 8080:8080 analyze-solidity-mcp
```

