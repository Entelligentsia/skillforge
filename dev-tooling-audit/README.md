# dev-tooling-audit

Inspect a project and recommend developer tooling (LSP servers, AST tools, test runners, type checkers, linters, debuggers, dependency graph tools) that make Claude Code most effective. Produces exact install commands tailored to the detected OS and package manager, plus Claude Code configuration guidance (MCP servers, LSP plugin setup).

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
