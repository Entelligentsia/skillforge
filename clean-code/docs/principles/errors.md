# Principles — Error Handling

Rule slugs are cited as `errors/<rule>`. Error handling is where clean-code
review pays for itself: these defects are invisible in review-by-skim, survive
tests that only cover the happy path, and surface at 3am.

## errors/never-swallow

**Trigger:** a catch block that is empty, logs only at debug level and continues,
or returns a default that the caller cannot distinguish from success.

Prefer `blocker`. A swallowed exception converts a loud failure into silent
wrong behavior — the single most expensive trade in the codebase.

Not a violation: a documented, deliberate ignore with a stated reason —
`catch (ENOENT) { /* first run: no cache file yet */ }`. The reason is what
makes it legitimate, so a bare comment-free ignore stays a finding.

## errors/fail-fast

**Trigger:** invalid input detected but allowed to propagate — a null check that
substitutes a default for a required value, a parse failure that returns an
empty object, validation deferred until the value reaches storage.

Fail at the boundary where the problem is detectable, while the context that
explains it is still on the stack. Late failures cost debugging time
proportional to the distance travelled.

## errors/context-in-message

**Trigger:** an error raised or wrapped without the values needed to diagnose it
— `throw new Error("invalid input")`, `raise ValueError("failed")`.

The message must carry what was expected, what was received, and which
operation failed. `"expected ISO-8601 date for field 'starts_at', got '13/2026'"`
is actionable; `"invalid date"` sends someone to the debugger.

Never put secrets, tokens, or full credential values in messages — a finding in
the opposite direction, and a `blocker`.

## errors/preserve-the-cause

**Trigger:** catching an exception and raising a new one without chaining —
dropping the original stack, or stringifying it into the message.

Use the language's chaining mechanism (`cause`, `raise ... from err`, wrapped
errors). The original stack is the only record of where it actually broke.

## errors/handle-at-the-right-level

**Trigger:** a low-level utility deciding user-facing policy — a parser that
logs a user message, a repository that retries with a hardcoded backoff, a
library function calling `process.exit`.

Handle errors where the context exists to decide what to *do* about them.
Low-level code reports; policy-level code decides. A library that terminates the
process removes that choice from every caller — `blocker`.

## errors/no-control-flow-by-exception

**Trigger:** exceptions thrown for expected, routine outcomes — "user not found"
on a lookup that routinely misses, "cache miss", end-of-iteration.

Expected outcomes are return values (`null`, `Option`, `Result`, a sentinel).
Exceptions are for the exceptional; using them for flow makes the real failures
indistinguishable from routine ones.

## errors/resource-cleanup

**Trigger:** a resource acquired on a path where an early return, `throw`, or
branch can skip its release — file handles, locks, connections, transactions.

Use the language's scoped mechanism (`defer`, `with`, `try-with-resources`,
`finally`, RAII). Manual cleanup on the happy path only is a leak waiting for
the first error.

## errors/actionable-at-the-boundary

**Trigger:** an internal error surfaced verbatim to a user or API client —
stack traces, SQL text, internal paths in a 500 response.

At the system boundary, translate: log the full detail with a correlation id,
return a message that tells the caller what they can do. Leaking internals is
both a usability defect and an information-disclosure one.
