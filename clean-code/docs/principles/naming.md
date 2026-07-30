# Principles — Naming

Rule slugs are cited by findings as `naming/<rule>`. Each rule states a
**decidable trigger** — something visible in the diff — because a rule a
reviewer cannot point at is a preference, not a standard.

## naming/intent-revealing

**Trigger:** a name that requires reading the implementation to know what it
holds or does.

Names answer *what* and *why*, never *how*. `retryBudget` beats `counter2`;
`isEligibleForRefund` beats `check`. A name that needs a clarifying comment
next to it is the comment's admission that the name failed.

Not a violation: short names with conventional scope-local meaning — `i` in a
loop, `id`, `db`, `ctx`, `err`. Brevity in a three-line scope is clarity.

## naming/no-encoded-types

**Trigger:** type or container encoded into the identifier — `strName`,
`userList`, `dataMap`, `IUserService` (in languages where the convention is not
already the ecosystem norm).

The type system already says this, and the name goes stale the moment the
container changes. Exception: follow the ecosystem's own convention where one
exists and is pervasive in the project.

## naming/consistent-vocabulary

**Trigger:** the same concept named differently across the diff — `fetchUser`
here, `getUser` there, `loadUser` in a third place, with no distinction in
behavior.

Pick one verb per operation class and hold it. Where a project already has a
prevailing term, the diff conforms to the project rather than the author's
habit. Distinct names must mean distinct things: if `fetch` implies network and
`get` implies cache, that is a *useful* distinction — make it consistently.

## naming/no-disinformation

**Trigger:** a name that says something untrue after the change — `userList`
that is a set, `isValid` that mutates, `getX` that performs I/O or costs
seconds, a constant named `MAX_*` that is actually a default.

This is the highest-severity naming defect: a wrong name misleads every future
reader, and unlike a missing name it actively costs time. Prefer `blocker` when
the name will mislead about cost or side effects.

## naming/searchable-constants

**Trigger:** a bare literal with meaning appearing in logic — `if (retries > 3)`,
`sleep(86400)`, `status === 7`.

Meaningful literals get named constants. Not a violation: `0`, `1`, `-1`, and
literals whose meaning is fully carried by an adjacent named parameter
(`slice(0, 1)`), or a single obvious use in a test fixture.

## naming/scope-proportional-length

**Trigger:** long ceremonial names in tiny scopes, or single letters on
module-level exports.

Name length should track scope size. A loop variable used twice does not need
`currentIterationIndex`; an exported symbol does not get to be `p`.

## What is NOT a naming finding

- Casing, underscores, or file-name style — the linter owns these.
- A name you would personally have chosen differently, where the existing name
  is accurate and consistent with the project. "I'd call it X" is not a defect.
- Names in code the diff only moved or re-indented.
