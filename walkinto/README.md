# walkinto

WalkInto.in virtual-tour platform and helpdesk plugin for Claude Code — sign in once, then drive your account and the helpdesk either through bundled Node scripts or through the WalkInto MCP server (13 tools) that this plugin wires up automatically.

## Skills

| Skill | Trigger |
|-------|---------|
| [`walkinto`](skills/walkinto/SKILL.md) | WalkInto account, 360/virtual tours, or the WalkInto helpdesk: tickets, knowledge base, replies/triage |

## What it covers

| Area | Capabilities |
|------|-------------|
| **Account & tours** | `whoami` profile, search/list 360 tours by name/state |
| **Knowledge base** | Ranked KB search (with grounding strength), read full articles |
| **Tickets (owner)** | Create, list, search, view your own tickets |
| **Tickets (support staff)** | Reply (draft/auto-send gate), approve drafts, private notes, status/priority/tags |

## Installation

```
/plugin install walkinto@skillforge
/reload-plugins
```

Then authenticate:

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/login.js"
```

This opens a browser for Google sign-in and stores a Bearer token at `~/.config/walkinto/token` (mode `0600`). `logout.js` revokes it server-side and deletes the local copy.

## MCP server (the 13 tools)

The plugin declares an MCP server in [`.mcp.json`](.mcp.json) — a stdio bridge that connects to the WalkInto streamable-HTTP MCP endpoint (`${WALKINTO_URL}/mcp`) using the **same token `login.js` already manages**. Install the plugin and run `login.js`, and the tools light up with no `claude mcp add` and no token copied into `~/.claude.json`. On logout (or token expiry) the bridge fails clean.

The shipped bridge is a single self-contained file, `skills/walkinto/scripts/mcp-bridge.bundle.js` — no `node_modules`, no install step.

### Rebuilding the bridge bundle

The bundle is generated from `skills/walkinto/scripts/mcp-bridge.js` (the readable source, committed alongside it) by tree-shaking `@modelcontextprotocol/sdk` down to only what the bridge uses. To reproduce and diff it:

```bash
npm install        # build-time only; node_modules is gitignored
npm run build:bridge
```

## Environment

Set `WALKINTO_URL` to override the endpoint (default `https://walkinto.in`; e.g. `https://walkintolocal.in` for local). The token at `~/.config/walkinto/token` is shared across all scripts and the MCP bridge.

## Notes

- **Role scoping** is server-side: the token inherits the user's role. Admin/support-staff tokens unlock the reply/approve/note/update tools; owner tokens are scoped to their own tickets.
- The REST scripts (`whoami`, `tours`, `kb`, `tickets`) remain as a fallback for non-MCP contexts; `login`/`logout` own the token + server lifecycle.
