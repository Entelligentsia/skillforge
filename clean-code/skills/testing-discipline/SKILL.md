---
name: testing-discipline
description: Use when writing or modifying tests — choosing what to assert, naming test cases, handling async waits, designing fixtures, or deciding which paths of a change need coverage. Load before writing the first assertion, not after the suite goes red.
---

# Testing Discipline

Full rubric: `${CLAUDE_PLUGIN_ROOT}/docs/principles/tests.md`. Gate findings
cite these as `tests/<rule>`.

## Assert what the caller can see

Return values, persisted state, messages emitted. Not private fields, not
internal call counts. A test coupled to implementation fails on every refactor
and stays green through real regressions — it costs maintenance and proves
nothing.

Mock-invocation assertions are legitimate only when the interaction *is* the
contract: the email must be sent, the card must be charged exactly once.

## The name is the specification

`refund_fails_when_order_already_settled` — scenario and expectation, so a
reader scanning a failure list never has to open the body. `test1`, `testUser`,
and `itWorks` are findings.

## One reason to fail

Several assertions describing one behavior from different angles: fine. Several
*scenarios* in one test: not — the failure name stops being a diagnosis. Use
table-driven cases for variations.

## Determinism is not negotiable

No wall-clock time, real network, unseeded randomness, paths outside a temp dir,
or dependence on test order. A flaky test trains the team to ignore failures,
which quietly disables the entire suite.

**Never sleep to wait for async work.** A fixed delay is either flaky or slow,
usually both across machines. Await the real signal, poll with a deadline, or use
the framework's synchronisation primitive.

## No logic in the test body

`if`, loops deciding assertions, try/catch — a test with branches has untested
branches of its own. Iterating a fixture table is fine; branching on the result
is not.

## Fixtures

Make the causal value obvious. Builders with sensible defaults, and only the
field that drives the assertion set explicitly — a reader should see immediately
which input produces the expected output. Never share mutable fixtures across
tests; that reintroduces order dependence.

## Covering a change

Cover the branches, boundaries, and error paths the change itself introduces —
those specifically, not coverage as a percentage. When you skip one deliberately
(no test infrastructure, generated code, covered indirectly), say so rather than
leaving it silent.

Never disable a failing test to make a suite green. Fix it, or fix the code it
caught.
