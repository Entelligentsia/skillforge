---
name: error-handling
description: Use when writing or changing error handling — try/catch, raise/throw, Result or Option returns, validation, retries, resource cleanup, or how failures surface to users and API clients. Load before adding a catch block or deciding what an operation returns when it fails.
---

# Error Handling

Full rubric: `${CLAUDE_PLUGIN_ROOT}/docs/principles/errors.md`. Gate findings
cite these as `errors/<rule>`.

## The four decisions, in order

**1. Where does this fail?** Detect invalid input at the boundary where it
enters, while the context explaining it is still on the stack. A null check that
quietly substitutes a default for a required value converts a clear failure into
a mysterious one three layers away.

**2. Is this failure expected or exceptional?** Expected outcomes — cache miss,
user not found, end of input — are return values: `null`, `Option`, `Result`, a
sentinel. Exceptions are for the exceptional. Using them for routine flow makes
real failures indistinguishable from ordinary ones.

**3. Who decides what to do about it?** Low-level code reports; policy-level code
decides. A parser that logs a user-facing message, a repository with a hardcoded
retry, a library that calls `process.exit` — each removes a decision from every
caller. Report upward, decide where the context exists.

**4. What does the message carry?** Expected, received, and which operation:
`expected ISO-8601 date for field 'starts_at', got '13/2026'`. Never secrets,
tokens, or credential values — that is a security defect, not a style one.

## Non-negotiables

- **Never swallow.** An empty catch, or one that debug-logs and continues, turns
  a loud failure into silent wrong behavior. A deliberate ignore is legitimate
  *only* with a stated reason: `catch (ENOENT) { /* first run: no cache yet */ }`.
- **Preserve the cause.** Chain when wrapping (`cause`, `raise ... from`,
  wrapped errors). The original stack is the only record of where it broke.
- **Scope your resources.** `defer`, `with`, `try-with-resources`, `finally`,
  RAII — anything acquired must release on every path, including the throwing
  one. Cleanup written only on the happy path is a leak waiting for its first error.

## At the system boundary

Translate before it leaves: log the full detail with a correlation id, return a
message the caller can act on. Stack traces, SQL text, and internal paths in a
response are both a usability defect and an information disclosure.

## Structure

Guard-clause the exceptional cases and return early; keep the main path at the
outermost level. Three levels of nesting hiding a one-line happy path is a
readability defect the gate will flag as `functions/error-path-clarity`.
