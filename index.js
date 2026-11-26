#!/usr/bin/env node
// Starts the CigalPay MCP server.
//   cigalpay-mcp          over stdio (the way Claude Desktop, Claude Code, Cursor and
//                         most MCP clients launch local servers)
//   cigalpay-mcp --http   as a remote server (Streamable HTTP on PORT, default 8080),
//                         each request bringing its own credentials (see http.js)

if (process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http') {
    const { startHttpServer } = await import('./http.js');
    startHttpServer(process.env);
} else {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { createServer } = await import('./server.js');
    const server = createServer(process.env);
    await server.connect(new StdioServerTransport());
    // stdout carries the protocol: log to stderr only.
    console.error('CigalPay MCP server running on stdio');
}
