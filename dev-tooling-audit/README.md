# dev-tooling-audit

Most coding agents fall back to grep and text parsing because the right developer tools aren't installed. This skill scans your project, detects which languages you use, and tells you exactly what to install — LSP servers, AST tools, test runners, linters — with copy-paste commands for your OS. Run `--verify` to confirm everything works.

## Install

```
/plugin marketplace add github:Entelligentsia/skillforge
/plugin install dev-tooling-audit@skillforge
```

| Skill | Purpose |
|-------|---------|
| `dev-tooling-audit` | Audit a project for tooling gaps; verify installed tools work |

## Modes

- **Audit** (default) — detect project languages, scan for installed tools, produce prioritized recommendations with install commands
- **Verify** (`--verify`) — run functional checks on each tool against the actual project and report pass/fail with fix instructions

## Tooling categories covered

1. Language Server (LSP) — 10 languages
2. AST / Structural Reading — tree-sitter, ast-grep, lean-ctx
3. Test Runner with structured output
4. Type Checker (incremental)
5. Linter/Formatter with auto-fix
6. Debugger (DAP)
7. Dependency Graph
