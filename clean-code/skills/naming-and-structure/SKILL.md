---
name: naming-and-structure
description: Use when writing a new function, class, or module, or when renaming or restructuring existing code. Covers intent-revealing names, single responsibility, abstraction levels, argument design, and when a comment earns its place. Not for formatting or style questions the linter already decides.
---

# Naming and Structure

Full rubric: `${CLAUDE_PLUGIN_ROOT}/docs/principles/naming.md` and
`${CLAUDE_PLUGIN_ROOT}/docs/principles/functions.md`. Findings from the commit gate cite these as `naming/<rule>` and
`functions/<rule>`, so what follows is what you should get right *before* the
gate ever sees the code.

## Decide these while writing, not after

**The name is the design.** If you cannot name the function without "and", you
have two functions. If the name needs a clarifying comment beside it, the name
lost. Write the name first; when it comes out awkward, that is information about
the structure, not about vocabulary.

**Names must stay true.** The costliest naming defect is not vagueness, it is a
name that says something false after a change — `getUser` that writes,
`isValid` that mutates, `userList` that is a set. Vague names waste a reader's
minute; wrong names send them the wrong way for an hour.

**Hold the project's vocabulary.** Before introducing `fetchX`, check whether
this codebase says `get`, `load`, or `find` for that operation. Consistency with
the surrounding code beats your preferred term, always.

**One altitude per function.** Domain policy and byte-level mechanics do not
belong in the same body. When you notice yourself changing gears mid-function,
that seam is where the extraction goes.

**Booleans that select behavior are two functions.** `render(user, true)` should
be `renderPreview(user)` and `renderFinal(user)`. Four-plus positional
parameters means an options object is overdue.

## Comments

Write one only to say what the code cannot: a constraint, an external
requirement, a link to a spec, the reason an unusual approach is necessary.
Never narrate the change ("changed this to fix the bug") — that is the commit
message's job, and it becomes noise the moment the PR merges.

## Scope discipline

Name length tracks scope size. A two-line loop variable does not need a
sentence; an exported symbol does not get a single letter. Short conventional
names (`i`, `id`, `ctx`, `err`) in small scopes are clarity, not laziness.

## What not to spend effort on

Casing, import order, line length, quote style — the project's formatter and
linter own these. If you find yourself deliberating over them, stop and run the
formatter.
