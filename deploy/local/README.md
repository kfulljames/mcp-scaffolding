# Local (non-Docker) deployment

For editor/CLI integration over stdio, or for running the HTTP transport directly on your
machine without a container.

```bash
cp .env.example .env
# Edit .env — for the demo server, at minimum set MOCKVENDOR_API_KEY to any value.
npm ci
npm run dev        # stdio by default per .env.example; fast inner loop, no build step
```

## Pointing an MCP client at stdio

Most stdio-based MCP clients (Claude Desktop, editor extensions) invoke a command directly.
Example client config:

```json
{
  "mcpServers": {
    "example-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-scaffold/dist/src/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "READ_ONLY": "true",
        "MCP_PRESETS": "service-desk",
        "SERVER_NAME": "example-mcp-server",
        "SERVER_VERSION": "0.1.0",
        "VENDOR_BASE_URL": "https://api.example-vendor.test",
        "MOCKVENDOR_API_KEY": "demo-not-a-real-secret"
      }
    }
  }
}
```

Run `npm run build` first — the client launches the compiled `dist/src/index.js`, not the
TypeScript source.

## Smoke-testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npm run dev
```

Opens a UI to list tools, inspect schemas, and call them by hand — the fastest way to sanity
check a new tool before writing its automated tests. See `docs/ADDING-A-TOOL.md` step 10.
