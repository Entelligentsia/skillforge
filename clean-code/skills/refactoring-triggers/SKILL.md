---
name: refactoring-triggers
description: Use when asked to clean up, refactor, simplify, or reduce duplication in existing code, or when a function you are editing has grown past comfort. Gives decidable triggers for extracting, splitting, or leaving code alone — and for when refactoring is out of scope.
---

# Refactoring Triggers

Full rubric: `${CLAUDE_PLUGIN_ROOT}/docs/principles/functions.md`. Gate findings
cite these as `functions/<rule>`.

## Refactor on a trigger, not on a feeling

Each trigger below is something you can point at. If you cannot point at one,
the honest answer is that the code is fine and the refactor is taste.

| Trigger you can point at | The move |
|---|---|
| The function's honest description needs "and" | Extract along that seam |
| Name already contains "and" (`validateAndSave`) | Split — the name confessed |
| Two reasons to change (rules *and* storage) | Split by reason to change |
| Policy sits beside byte-level mechanics | Extract the low-level part |
| Third occurrence of a pattern already there twice | Now extract, not at two |
| Duplicated block encodes a rule that must stay in sync | Extract regardless of count |
| Happy path buried three levels deep | Guard clauses, return early |
| Boolean parameter selects behavior | Two functions |
| Four or more positional parameters | Options object |

## When NOT to refactor

- **Duplication at two sites with no divergence risk.** Two is often the honest
  cost of decoupling. Wait for the third, or for evidence the two must agree.
- **Structure you dislike but cannot fault.** "I'd have used a map here" is not
  a trigger.
- **Code the current task does not touch.** Refactoring adjacent code inflates
  the diff, buries the actual change from the reviewer, and mixes two decisions
  into one commit. Note it, do it separately.
- **Speculative generality.** An abstraction with one implementation and no
  second one in sight is more code with no more capability. The gate flags newly
  added ones as `functions/dead-on-arrival`.

## Doing it safely

Refactor and behavior change never share a commit. Land the behavior change,
then the structural one — or the reverse — but a reviewer must never have to
separate them by reading. If the tests do not cover the code you are about to
restructure, that is the first task, not an optional one.

Delete rather than comment out. Version control already remembers, and
commented-out code added in a diff is itself a finding.

## Scope control when asked to "clean this up"

Say what you are about to change and why it is triggered, before changing it.
An unbounded cleanup produces a diff nobody can review, which costs more than
the mess it removed.
