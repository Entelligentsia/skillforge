---
name: walkinto
description: "WalkInto.in virtual tour platform and helpdesk — authenticate, view profile, manage 360 tours, search the knowledge base, and run the support ticket lifecycle. Use this skill whenever the user mentions 'walkinto', a WalkInto account, virtual/360 tours, panorama uploads, tour analytics, OR the WalkInto helpdesk: support tickets, customer questions, knowledge-base/KB articles, replying to or triaging tickets, ticket status/priority/tags, or 'who am I on walkinto'."
---

# WalkInto

Interact with the user's WalkInto.in account and helpdesk through bundled Node.js scripts. All scripts live in this skill's `scripts/` directory and require no installation — just Node.js.

The scripts authenticate against the WalkInto agent API and store a Bearer token locally at `~/.config/walkinto/token`. A token belongs to one WalkInto user; some helpdesk actions additionally require that user to be **support staff (an admin)** — those are marked below and return a clear "requires an admin token" error otherwise.

> Terminology: throughout this skill, **support staff** means a human WalkInto helpdesk operator with admin rights — *not* an AI agent. (The underlying API names this role "agent"; you'll see that word in raw error text.) "You" here is the AI assistant acting on the logged-in user's behalf.

## Running scripts

Always invoke scripts with `--use-system-ca` to avoid TLS certificate errors:

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/<script>.js" [args]
```

Every multi-option script has `--help` and most have subcommands. **Run `--help` first** to discover flags and output shape before constructing a command — do not guess. Add `--json` to any command for raw, machine-parseable output.

## Before any data operation, check authentication

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/whoami.js"
```

If it prints "Not logged in" or a token error, run **Login**. On success it returns JSON (`userId`, `profile.name`, `profile.email`, `profile.image`, `profile.location`) — parse it and greet the user by name.

## Login / Logout

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/login.js"
```

Opens a browser for Google sign-in. Tell the user to click **Approve**. The script blocks until approval, then prints profile JSON. Confirm with: **Logged in to WalkInto as {name} ({email})**.

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/logout.js"
```

Revokes the token server-side, then deletes the local copy.

---

# Account & Tours

## Whoami

```bash
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/whoami.js"
```

## Tours

Search and list the user's 360 tours. Run `--help` for all options.

```bash
# List 20 most recent
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tours.js"
# Search by name
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tours.js" --name "office"
# Published tours created this year, raw JSON
node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tours.js" --state published --created-after 2025-01-01 --json
```

Returns: tour name, state (draft/published), view count, creation date, tour ID.

---

# Helpdesk

Two scripts cover the helpdesk: `kb.js` (knowledge base) and `tickets.js` (the ticket lifecycle). Both authenticate with the same token.

**Roles.** Any logged-in user is a ticket **owner**: they can read the KB and create/list/search/view *their own* tickets. **Support staff** (an admin token) can additionally see *every* customer's ticket and reply, approve, note, and update. Staff-only subcommands fail fast with a permission error for non-admin tokens — surface that message to the user rather than retrying.

**Codes** (accepted as names or numbers):
- status: `open`(2) `pending`(3) `resolved`(4) `closed`(5) `waiting`(6)
- priority: `low`(1) `medium`(2) `high`(3) `urgent`(4)

## Knowledge Base — `kb.js`

```bash
KB="${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/kb.js"

# Search ranked articles. Each carries match_strength 0..1 — the SAME normalized
# strength the auto-send gate recomputes server-side, so it tells you how well a
# reply citing that article would be grounded.
node --use-system-ca "$KB" search --q "embed a tour on my website" --limit 5

# Read one published article in full. category + slug come from a search result
# (its category_slug / slug). Returns article markdown (best for quoting) + HTML.
node --use-system-ca "$KB" read general embed-image-gallery-as-tourcard
```

Workflow: **search → read → cite**. Note the `category_slug/slug` of articles you relied on so you can pass them to `tickets.js reply --cite`.

## Tickets — `tickets.js`

Run `node --use-system-ca "${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tickets.js" --help` for the full reference. Subcommands:

```bash
T="${CLAUDE_PLUGIN_ROOT}/skills/walkinto/scripts/tickets.js"

# --- Read (owner sees own tickets; support staff see all) ---
node --use-system-ca "$T" list --status open --limit 10
node --use-system-ca "$T" search --q "panorama upload failing"   # ≥1 filter required
node --use-system-ca "$T" view <ticketId>                        # ticket + full thread

# --- Owner: open a ticket as yourself ---
node --use-system-ca "$T" create --subject "Embed not loading" --body "The iframe is blank."

# --- Support staff (admin token) ---
# Reply: ALWAYS drafts first. It auto-sends ONLY if the gate is enabled AND the
# cited KB match is strong AND --confidence is high; otherwise it stays a draft.
node --use-system-ca "$T" reply <ticketId> --body "Re-publish the tour to refresh the embed." \
     --confidence 0.9 --cite general/embed-image-gallery-as-tourcard
node --use-system-ca "$T" approve <ticketId> <messageId>   # send a held draft reply
node --use-system-ca "$T" note <ticketId> --body "Customer on legacy embed code."  # private
node --use-system-ca "$T" update <ticketId> --status resolved --priority low --add-tag embed
```

**Staff reply guidance** (the recommended grounded-answer loop):
1. `kb.js search` for the customer's problem; read the top article(s) with `kb.js read`.
2. Draft the reply from what the article actually says. Pass each article you used as `--cite category_slug/slug` (repeatable).
3. Set `--confidence` to your honest 0..1 self-assessment. The server **recomputes** KB match strength from the citations — you cannot inflate it. Weak match or low confidence ⇒ the reply is held as a draft, never sent.
4. The command prints the gate decision and reason. If it stayed a draft and you still want to send it, hand control to a human or run `approve <ticketId> <messageId>`.

**Safety.** `reply` and `approve` can send real email to a customer. Confirm the recipient and content with the user before approving or before issuing a high-confidence cited reply that may auto-send. `note` is always private; `update` never emails.

---

## Environment

Set `WALKINTO_URL` to override the API endpoint (default `https://walkinto.in`; e.g. `https://walkintolocal.in` for local). The token at `~/.config/walkinto/token` is shared across all scripts.
