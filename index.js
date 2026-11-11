#!/usr/bin/env node
// Starts the CigalPay MCP server over stdio (the way Claude Desktop, Claude Code,
// Cursor and most MCP clients launch local servers).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer(process.env);
await server.connect(new StdioServerTransport());
// stdout carries the protocol: log to stderr only.
console.error('CigalPay MCP server running on stdio');
