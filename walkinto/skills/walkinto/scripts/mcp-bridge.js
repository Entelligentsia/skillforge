'use strict';

/**
 * mcp-bridge.js — stdio ↔ streamable-HTTP MCP bridge.
 *
 * Exposes the WalkInto MCP server to a local stdio MCP client (Claude Code).
 * The server speaks streamable HTTP at `POST {baseUrl}/mcp`: Bearer-authenticated,
 * stateless (a fresh server+transport per request), tools-only (GET/DELETE → 405).
 *
 * The bridge reuses the token and baseUrl that login.js / config.js already
 * manage — no new config surface. It connects upstream as an SDK Client, then
 * exposes a local stdio Server that mirrors the remote's identity and proxies the
 * two tools-only methods (tools/list, tools/call) straight through.
 *
 * Declared in the plugin's .mcp.json; spawned by Claude Code at session start.
 */

var config = require('./config');
var { Client } = require('@modelcontextprotocol/sdk/client/index.js');
var { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
var { Server } = require('@modelcontextprotocol/sdk/server/index.js');
var { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
var { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

async function main() {
  var token = config.getToken();
  if (!token) {
    console.error('Not logged in — run login.js first.');
    process.exit(1);
    return;
  }

  // 1. Connect upstream. connect() runs the MCP initialize handshake, so after it
  //    resolves the remote's capabilities and identity are known. The remote
  //    returns 405 for GET /mcp; the client treats that as "no server→client SSE
  //    stream" per spec and proceeds — fine, since the server is stateless.
  var endpoint = new URL('/mcp', config.baseUrl);
  var upstream = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: 'Bearer ' + token } }
  });
  var client = new Client({ name: 'walkinto-mcp-bridge', version: '1.0.0' });
  await client.connect(upstream);

  // 2. Expose a local stdio server that mirrors the remote's identity + tool
  //    capability, so the downstream client sees the real WalkInto server.
  var serverInfo = client.getServerVersion() || { name: 'walkinto-mcp', version: '1.0.0' };
  var capabilities = client.getServerCapabilities() || {};
  var server = new Server(serverInfo, {
    capabilities: { tools: capabilities.tools || {} }
  });

  // 3. Proxy the tools-only surface straight through to the upstream client.
  server.setRequestHandler(ListToolsRequestSchema, function(request) {
    return client.listTools(request.params);
  });
  server.setRequestHandler(CallToolRequestSchema, function(request) {
    return client.callTool(request.params);
  });

  // 4. If the upstream connection drops (token revoked, network, server restart),
  //    exit so Claude Code can respawn the bridge — which re-reads the token.
  upstream.onclose = function() { process.exit(0); };

  await server.connect(new StdioServerTransport());
}

main().catch(function(err) {
  console.error('mcp-bridge: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
