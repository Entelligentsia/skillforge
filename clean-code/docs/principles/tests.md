# Principles — Tests

Rule slugs are cited as `tests/<rule>`. Tests are reviewed as production code,
because they are read more often than they are written and a bad test is worse
than no test — it consumes maintenance while proving nothing.

## tests/asserts-behavior-not-implementation

**Trigger:** a test that asserts on internal calls, private state, or mock
invocation counts where the observable outcome would do.

A test coupled to implementation fails on every refactor and passes through real
regressions. Assert what the caller can see: return values, persisted state,
messages emitted. Mock-call assertions are legitimate only when the *interaction
itself* is the contract — an email must be sent, a payment must be charged once.

## tests/one-reason-to-fail

**Trigger:** a single test exercising several distinct behaviors, so the failure
name does not tell you what broke.

When it fails, the name should be the diagnosis. Multiple assertions are fine
when they describe one behavior from several angles; multiple *scenarios* in one
test are not.

## tests/no-conditional-logic

**Trigger:** `if`, loops, or try/catch in a test body deciding what to assert.

A test with branches has untested branches of its own. Use table-driven cases or
separate tests. Loops over a fixture table are fine — branching on the *result*
is not.

## tests/deterministic

**Trigger:** dependence on wall-clock time, real network, random values without a
fixed seed, filesystem paths outside a temp dir, or on the order tests run in.

Prefer `blocker`: a flaky test trains the team to ignore failures, which
disables every other test in the suite. Inject the clock, seed the generator,
stub the boundary.

## tests/meaningful-name

**Trigger:** `test1`, `testUser`, `itWorks` — names that do not state the
scenario and the expectation.

The name is the specification: `refund_fails_when_order_already_settled`. A
reader scanning failures should not need to open the body.

## tests/no-sleep

**Trigger:** a fixed `sleep`/`setTimeout` used to wait for async work.

Sleeps are either flaky (too short) or slow (too long), and usually both across
machines. Await the actual signal, poll with a deadline, or use the framework's
synchronisation primitive.

## tests/fixture-clarity

**Trigger:** a test whose setup is so large the reader cannot tell which value
drives the assertion, or a shared mutable fixture reused across tests.

Make the causal value obvious — builders with defaults, and only the relevant
field set explicitly in the test. Shared mutable state creates order dependence,
which `tests/deterministic` already forbids.

## tests/coverage-of-the-change

**Trigger:** the diff adds a branch, boundary, or error path with no
corresponding test, in a repo that has a test suite.

Report the *specific* untested path, not "needs more tests" — cite the branch by
`file:line`. Do not raise this for repos with no test infrastructure, for
generated code, or where an existing test already covers the path indirectly.

Never report a missing test as `blocker` unless the untested path is an error
path or a boundary that the diff itself just changed.
