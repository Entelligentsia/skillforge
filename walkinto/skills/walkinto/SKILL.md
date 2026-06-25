---
name: walkinto
description: "WalkInto.in virtual tour platform and helpdesk — authenticate, view profile, manage 360 tours, search the knowledge base, and run the support ticket lifecycle. Use this skill whenever the user mentions 'walkinto', a WalkInto account, virtual/360 tours, panorama uploads, tour analytics, OR the WalkInto helpdesk: support tickets, customer questions, knowledge-base/KB articles, replying to or triaging tickets, ticket status/priority/tags, or 'who am I on walkinto'."
---

# WalkInto

Interact with the user's WalkInto.in account and helpdesk. There are **two surfaces**, and they share one Bearer token stored at `~/.config/walkinto/token`:

1. **MCP tools (preferred).** The plugin wires up the WalkInto MCP server (~13 tools) over a bridge that reuses that same token. When logged in, the tools appear in your tool list namespaced under the `walkinto` server. Use them for every data operation below — they take structured arguments and return structured results, with no shell, paths, or flags.
2. **Bundled Node.js scripts (fallback + token lifecycle).** The same capabilities also exist as scripts in this skill's `scripts/` directory. Use them whenever the MCP tools aren't in your tool list, and for the things MCP structurally cannot do — **login** and **logout**, which mint and revoke the token the MCP bridge depends on.

A token belongs to one WalkInto user; some helpdesk actions additionally require that user to be **support staff (an admin)** and return a clear "requires an admin token" error otherwise.

> Terminology: throughout this skill, **support staff** means a human WalkInto helpdesk operator with admin rights — *not* an AI agent. (The underlying API names this role "agent"; you'll see that word in raw error text.) "You" here is the AI assistant acting on the logged-in user's behalf.

## Choosing a surface

- **Prefer the MCP tools** for tours, knowledge base, and tickets when they appear in your tool list. Inspect each tool's input schema for exact parameter names rather than guessing.
- **Otherwise just use the scripts** — they cover every data operation and need no setup. (The bridge reads the token at session start, so the `walkinto` tools may not be present until a reload. This needs no action and no explanation to the user — the scripts work identically. Don't surface bridge/MCP mechanics unless the user explicitly asks about them.)
- **Login** uses the `begin`/`complete` flow below (only `begin`'s link-click involves the user). **Logout** you just run.

## Authentication

Always run scripts with `--use-system-ca` to avoid TLS certificate errors (it adds the OS trust store, needed behind corporate proxies and for local endpoints):

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/<script>.js" [args]
```

### Check login state — `whoami.js` (always available)

Use the **script**, not the MCP tool, as the auth probe: it works even when the bridge is down (e.g. logged out at session start, when no `walkinto` tools exist to call).

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/whoami.js"
```

On success it returns JSON (`userId`, `profile.name`, `profile.email`, `profile.image`, `profile.location`) — greet the user by name. If it prints "Not logged in" or a token/401 error, guide the user through **Login**.

### Login — a two-step, click-to-approve flow

Login is split so the user just **clicks a link** instead of running an opaque command. Never run the full one-shot `login.js` (no subcommand) through Bash: it spawns a browser, long-polls for ~5 minutes, and writes a token — a pattern auto-mode blocks by design.

**Step 1 — `begin` (you run this).** It only prints an approval URL and saves a one-time pending code; no browser, no poll, no token write — so it is safe to run directly:

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/login.js" begin
```

Show the printed URL to the user as a clickable link, e.g. *"Click here to sign in to WalkInto, then click Approve: …/agent-auth/confirm?code=…"*. The user just clicks and approves in the browser — **they do not need to report back.**

**Step 2 — `complete` (run it right away; it waits for them).** Don't wait for the user to confirm. Run `complete` immediately: it polls the server (the same waiting monitor the old one-shot flow used) and captures the token automatically the moment approval lands — so no typed "done" is needed. Run it **in the background** so the conversation isn't blocked while the user clicks:

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/login.js" complete
```

It blocks until approval (up to ~5 min), then prints "Login successful!" and the profile — give the positive greeting then. If it times out (the user never approved), it exits cleanly; just offer to start again. (In the rare case auto-mode blocks the poll, fall back to running it with the `!` prefix; `${CLAUDE_PLUGIN_ROOT}` only resolves in-session, so use the absolute path in a separate terminal.)

`complete` prints "Login successful!" and the profile. Give the user a warm, positive confirmation that they're all set, plus a couple of concrete hints on what to do next — chosen to fit whatever they were trying to do. For example:

> You're all set, {name}! I can help with your WalkInto account now — for instance:
> - list or search your 360° tours,
> - look something up in the help center, or
> - check on (or open) a support ticket.

Don't mention bridges, MCP, or `/reload-plugins` — those mechanics aren't the user's concern.

### Logout — just run it

When the user asks to log out, run it directly — no need to involve them. It's an authenticated POST that revokes the token server-side, then deletes the local copy; nothing about it warrants the login treatment.

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/logout.js"
```

It prints "Logged out." (or notes if the server revoke failed but the local token was still removed). Confirm simply: **You're logged out of WalkInto.**

---

# Account & Tours

**Whoami** — prefer the MCP whoami tool for profile lookups during a session; use `whoami.js` as the auth probe (above).

**Tours** — search and list the user's 360 tours. Returns tour name, state (draft/published), view count, creation date, and tour ID. Supports filtering by name, state, and creation date.

- **Preferred:** the `walkinto` tours tool — check its schema for the name/state/date parameters.
- **Fallback (script):**

```bash
TOURS="${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tours.js"
node --use-system-ca "$TOURS"                                              # 20 most recent
node --use-system-ca "$TOURS" --name "office"                             # search by name
node --use-system-ca "$TOURS" --state published --created-after 2025-01-01 --json
```

Scripts have `--help` and accept `--json`. Run `--help` before constructing a command — do not guess flags.

---

# Helpdesk

**Roles.** Any logged-in user is a ticket **owner**: they can read the KB and create/list/search/view *their own* tickets. **Support staff** (an admin token) can additionally see *every* customer's ticket and reply, approve, note, and update. Staff-only actions fail fast with a permission error for non-admin tokens — surface that message rather than retrying.

**Codes** (accepted as names or numbers):
- status: `open`(2) `pending`(3) `resolved`(4) `closed`(5) `waiting`(6)
- priority: `low`(1) `medium`(2) `high`(3) `urgent`(4)

## Knowledge Base

Search ranked articles, then read one in full. Each search result carries `match_strength` 0..1 — the **same** normalized strength the auto-send gate recomputes server-side, so it tells you how well a reply citing that article would be grounded. An article's `category_slug` / `slug` identify it for reading and for citing in a reply.

Workflow: **search → read → cite**. Note the `category_slug/slug` of every article you rely on.

- **Preferred:** the `walkinto` KB search and KB read tools.
- **Fallback (script):**

```bash
KB="${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/kb.js"
node --use-system-ca "$KB" search --q "embed a tour on my website" --limit 5
node --use-system-ca "$KB" read general embed-image-gallery-as-tourcard   # category + slug
```

## Tickets

Read (owner sees own tickets; staff see all), create as the owner, and — for staff — reply/approve/note/update.

- **Preferred:** the `walkinto` ticket tools (list, search, view, create, reply, approve, note, update). Inspect schemas for parameters; the status/priority **codes** above apply.
- **Fallback (script):**

```bash
T="${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tickets.js"

# Read
node --use-system-ca "$T" list --status open --limit 10
node --use-system-ca "$T" search --q "panorama upload failing"   # ≥1 filter required
node --use-system-ca "$T" view <ticketId>                        # ticket + full thread

# Owner: open a ticket as yourself
node --use-system-ca "$T" create --subject "Embed not loading" --body "The iframe is blank."

# Support staff (admin token)
node --use-system-ca "$T" reply <ticketId> --body "Re-publish the tour to refresh the embed." \
     --confidence 0.9 --cite general/embed-image-gallery-as-tourcard
node --use-system-ca "$T" approve <ticketId> <messageId>   # send a held draft reply
node --use-system-ca "$T" note <ticketId> --body "Customer on legacy embed code."  # private
node --use-system-ca "$T" update <ticketId> --status resolved --priority low --add-tag embed
```

**Staff reply guidance** (the recommended grounded-answer loop, identical for the MCP tool and the script):
1. Search the KB for the customer's problem; read the top article(s).
2. Draft the reply from what the article actually says. Pass each article you used as a citation (`category_slug/slug`, repeatable).
3. Set confidence to your honest 0..1 self-assessment. The server **recomputes** KB match strength from the citations — you cannot inflate it. Weak match or low confidence ⇒ the reply is held as a draft, never sent.
4. The reply result reports the gate decision and reason. If it stayed a draft and you still want to send it, hand control to a human or approve it explicitly.

**Safety.** Reply and approve can send **real email** to a customer. Confirm the recipient and content with the user before approving, or before issuing a high-confidence cited reply that may auto-send. Notes are always private; updates never email.

---

## Environment

Set `WALKINTO_URL` to override the endpoint (default `https://walkinto.in`; e.g. `https://walkintolocal.in` for local). The token at `~/.config/walkinto/token` is shared across all scripts and the MCP bridge.
