# WalkInto, in plain English

Your WalkInto account — your profile, your 360° tours, the help library, and your
support messages — all reachable just by **talking to Claude Code**. No menus to
hunt through, no commands to memorise. You ask; it does.

> **You:** Show me my tours from this spring.
>
> **Claude:** You have 6 tours created since March. The most-viewed is
> *Lakeside Cottage — Full Walkthrough* (1,240 views), published April 2nd.
> Three are still drafts. Want the full list?

That's the whole idea. The rest of this page shows you how to get set up once,
and the kinds of things you can say.

---

## Get set up — three small steps

You only do this once.

**1. Add WalkInto to Claude Code.** In Claude Code, type:

```
/plugin install walkinto@skillforge
/reload-plugins
```

**2. Sign in.** Just say:

> **You:** Sign me in to WalkInto.

Claude opens your web browser, you sign in with Google and click **Approve**, and
that's it — you're connected. Claude greets you by name when it's done.

**3. Start talking.** Ask for anything below in your own words.

That's all. Your sign-in is remembered, so you won't have to do this again until
you choose to sign out.

---

## Just say it

You don't need the exact wording — these are only examples. Say it however feels
natural and Claude will understand.

### 📸 Your tours

> *"List my tours."*
> *"Find my tour of the Riverside loft."*
> *"Which of my tours are still drafts?"*
> *"What did I publish this year, and how many views has each one had?"*

You'll get the tour's name, whether it's a draft or published, its view count,
and when you made it.

### 👤 Your account

> *"Who am I on WalkInto?"*
> *"What email is my account under?"*

A quick look at your profile — name, email, location.

### 💡 Help & answers

WalkInto has a built-in help library. Ask a question and Claude finds the right
article and explains it back to you in plain language.

> *"How do I embed a tour on my website?"*
> *"What's the best way to share a tour with a client?"*

### 💬 Your support messages

Have a question for the WalkInto team, or want to check on one you already sent?

> *"Open a support ticket — my embedded tour is showing up blank."*
> *"Do I have any open support tickets?"*
> *"What did support say about my upload problem?"*

---

## For the WalkInto support team

If you're a member of WalkInto's helpdesk staff, the same plain-English approach
covers your daily work too — reading every customer's tickets, drafting grounded
replies, leaving private notes, and updating status, priority, and tags.

> *"Show me all open tickets, newest first."*
> *"Draft a reply to ticket 4821 explaining how to re-publish to refresh an embed."*
> *"Mark this one resolved and tag it 'embed'."*

**A safety note worth knowing:** replies to customers go out as real email, so
Claude always writes a **draft first** and shows it to you before anything is
sent. A reply only goes out on its own when it's confidently backed by a help
article — otherwise it waits for your okay. Private notes and status changes
never email anyone.

---

## Good to know

- **Your sign-in stays put.** You stay connected between sessions. To disconnect,
  just say *"Sign me out of WalkInto."*
- **Nothing is sent without you.** Anything that would email a customer is shown
  to you as a draft first.
- **Stuck?** If Claude ever says you're not signed in, just ask it to sign you in
  again.

---

<details>
<summary>Under the hood (for the technically curious)</summary>

This plugin talks to your WalkInto account two ways: a set of bundled Node.js
scripts (`login`, `whoami`, `tours`, `kb`, `tickets`, `logout`) and the WalkInto
MCP server (13 tools), wired up automatically over a self-contained stdio bridge
that reuses the same sign-in token the scripts manage — no `claude mcp add`, no
token copied by hand.

- **Sign-in token** is stored at `~/.config/walkinto/token` (mode `0600`) and
  shared by every script and the bridge. `logout` revokes it server-side and
  deletes the local copy.
- **Roles are enforced by the server:** your token inherits your role. Support
  staff tokens unlock reply/approve/note/update; everyone else is scoped to their
  own tickets and the read-only tools.
- **Endpoint** defaults to `https://walkinto.in`; set `WALKINTO_URL` to override
  (e.g. `https://walkintolocal.in`).
- The MCP bridge ships as one tree-shaken file,
  `skills/walkinto/scripts/mcp-bridge.bundle.js`. Rebuild it from
  `mcp-bridge.js` with `npm install && npm run build:bridge`.

Full reference: [`skills/walkinto/SKILL.md`](skills/walkinto/SKILL.md).

</details>
