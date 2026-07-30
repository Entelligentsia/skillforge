# Principles — Functions and Structure

Rule slugs are cited as `functions/<rule>`. These are the rules that a linter
*cannot* decide, which is exactly why they belong to review rather than tooling.
Length and cyclomatic-complexity thresholds are deliberately absent: if the
project wants them, they belong in its complexity checker, not here.

## functions/single-responsibility

**Trigger:** the honest one-sentence description of the function needs "and",
or the name already contains one (`validateAndSave`, `parseAndSend`).

The decidable test is the *reason to change*: if the function changes when the
validation rules change **and** when the storage backend changes, it holds two
responsibilities. Extract along the seam the name is already admitting.

Not a violation: a coordinating function that calls three well-named steps in
sequence. Orchestration is one responsibility.

## functions/single-level-of-abstraction

**Trigger:** within one function body, high-level policy sits beside low-level
mechanics — a domain decision next to buffer arithmetic or SQL string building.

Mixed altitude forces the reader to change gears mid-function. The fix is
usually to extract the low-level part, leaving the policy readable top to bottom.

## functions/argument-count

**Trigger:** four or more positional parameters, or any boolean parameter that
selects behavior (`render(user, true, false)`).

Boolean selectors mean the function is two functions wearing one name — split
them, or take a named options object. Not a violation: an options/config object
with many fields, or a signature dictated by an external interface.

## functions/no-hidden-side-effects

**Trigger:** a function whose name promises a query but which mutates state,
performs I/O, or writes to a cache — `getUser` that lazily creates, `isReady`
that starts a connection.

Prefer `blocker`: this class of defect breaks callers who reasonably assume the
call is free and repeatable. Either rename to admit the effect, or separate the
command from the query.

## functions/duplication-with-divergence-risk

**Trigger:** the diff introduces a third instance of a pattern already present
twice, **or** copies a block that encodes a rule which must stay in sync
(validation, pricing, permission checks).

Two occurrences is often fine; the finding is about *divergence risk*, not
repetition itself. Duplicated structure with different literal values is
usually a data problem, not a code problem. Never report duplication without
having read both sites — cite them by `file:line`.

## functions/dead-on-arrival

**Trigger:** the diff adds code with no path to it — an unused parameter,
unreachable branch, exported helper nothing calls, or a flag that is never set.

New dead code is a `blocker` in a way that pre-existing dead code is not: it is
being added deliberately, and nobody will remember to remove it. Speculative
generality — an abstraction with exactly one implementation and no second one in
sight — belongs here.

## functions/comment-earns-its-place

**Trigger:** a comment that restates the code (`// increment i`), narrates the
change (`// changed this to fix bug`), or explains *what* rather than *why*.

A comment must state something the code cannot: a constraint, an external
requirement, a non-obvious reason for an unusual approach, a link to a spec.
Change-narrating comments are noise the moment the PR merges — the commit
message is where that belongs.

Also a violation: commented-out code added in the diff. Version control has it.

## functions/error-path-clarity

**Trigger:** the happy path is buried inside nested conditionals three or more
levels deep, where guard clauses would flatten it.

Return early on the exceptional cases; keep the main path at the outermost
level. See `errors/` for what the error handling itself must do.
