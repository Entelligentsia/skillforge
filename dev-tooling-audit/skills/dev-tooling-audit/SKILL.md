---
name: dev-tooling-audit
description: Inspect a project and recommend developer tooling (LSP, AST, test runners, debuggers, linters) that would make Claude Code most effective. Provides exact install commands and a verify mode to confirm each tool works.
---

# Developer Tooling Audit

Inspect the current project and developer environment, then recommend exactly
which tools to install and configure so Claude Code can work at full capability
instead of falling back to Bash workarounds.

## When to use

- Starting work on a new project
- Setting up a new machine
- When Claude Code feels slow or imprecise on a codebase
- After the user asks "what tools should I install?"

## Two modes

### 1. Audit mode (default)

Analyze the project and environment, then produce a prioritized recommendation
report with exact install commands.

### 2. Verify mode (pass `--verify`)

Check each recommended tool is installed, reachable, and functional. Report
pass/fail for each with fix instructions for failures.

---

## Audit Procedure

### Phase 1 — Environment Detection

Detect and record:

```sh
# OS and package manager
uname -s -r -m
cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null

# Shell
echo $SHELL

# Available package managers (check which exist)
which apt brew dnf pacman nix npm pnpm yarn pip pipx cargo go 2>/dev/null

# Claude Code version
claude --version 2>/dev/null

# Node version (Claude Code runtime)
node --version

# MCP servers already configured
cat ~/.claude/settings.json 2>/dev/null | grep -A2 mcpServers || echo "no MCP config found"
```

Record: `OS`, `ARCH`, `PKG_MANAGER`, `NODE_VERSION`, `MCP_SERVERS`.

### Phase 2 — Project Detection

From the project root, detect:

```sh
# Language indicators
ls package.json tsconfig.json pyproject.toml setup.py setup.cfg Cargo.toml go.mod
ls *.sln *.csproj build.gradle pom.xml mix.exs Gemfile composer.json

# Framework indicators
grep -l "react\|vue\|angular\|svelte\|next\|nuxt" package.json 2>/dev/null
grep -l "django\|flask\|fastapi" pyproject.toml setup.py requirements*.txt 2>/dev/null

# Existing tooling
ls .eslintrc* .prettierrc* biome.json .editorconfig 2>/dev/null
ls jest.config* vitest.config* pytest.ini .mocharc* 2>/dev/null
ls .vscode/settings.json .idea/ 2>/dev/null
```

Build a `PROJECT_PROFILE`:
- `languages[]` — detected languages (TypeScript, Python, Go, Rust, etc.)
- `frameworks[]` — detected frameworks
- `existing_tools[]` — linters, formatters, test runners already present
- `monorepo` — boolean, check for workspaces/lerna/nx/turborepo

### Phase 3 — Gap Analysis

For each detected language, check whether the ideal tools exist on the system.
The tooling categories and their per-language recommendations:

#### Category 1 — Language Server (highest impact)

| Language | Server | Check command | Install command |
|----------|--------|---------------|-----------------|
| TypeScript/JS | `typescript-language-server` | `which typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Python | `pyright` | `which pyright` | `npm i -g pyright` or `pipx install pyright` |
| Go | `gopls` | `which gopls` | `go install golang.org/x/tools/gopls@latest` |
| Rust | `rust-analyzer` | `which rust-analyzer` | `rustup component add rust-analyzer` |
| C/C++ | `clangd` | `which clangd` | `apt install clangd` / `brew install llvm` |
| Java | `jdtls` | `which jdtls` | `brew install jdtls` / manual download |
| Ruby | `solargraph` | `which solargraph` | `gem install solargraph` |
| PHP | `intelephense` | `which intelephense` | `npm i -g intelephense` |
| Elixir | `elixir-ls` | `which elixir-ls` | `mix archive.install hex elixir_ls` |
| C# | `omnisharp` | `which omnisharp` | `dotnet tool install -g omnisharp` |

#### Category 2 — AST / Structural Reading

| Tool | What it provides | Check | Install |
|------|------------------|-------|---------|
| `tree-sitter-cli` | AST queries, syntax highlighting | `which tree-sitter` | `npm i -g tree-sitter-cli` or `cargo install tree-sitter-cli` |
| `lean-ctx` MCP | 10 read modes, AST-aware compression | Check MCP config | See lean-ctx setup instructions |
| `ast-grep` | Structural search/replace | `which ast-grep` or `which sg` | `npm i -g @ast-grep/cli` or `cargo install ast-grep` |

#### Category 3 — Test Runner with Structured Output

| Language | Runner | Structured output flag | Check |
|----------|--------|----------------------|-------|
| JS/TS | `vitest` | `--reporter=json` | `npx vitest --version` |
| JS/TS | `jest` | `--json` | `npx jest --version` |
| Python | `pytest` | `--tb=short -q` or `pytest-json-report` | `which pytest` |
| Go | `go test` | `-json` (built-in) | `go version` |
| Rust | `cargo test` | `-- -Z unstable-options --format json` | `cargo --version` |

#### Category 4 — Type Checker (incremental)

| Language | Tool | Check | Install |
|----------|------|-------|---------|
| TypeScript | `tsc` | `npx tsc --version` | `npm i -D typescript` (project-local) |
| Python | `pyright` / `mypy` | `which pyright` or `which mypy` | `pipx install pyright` |
| Go | `go vet` | built-in | — |
| Rust | `cargo check` | built-in | — |

#### Category 5 — Linter/Formatter with Auto-fix

| Language | Tool | Check | Install |
|----------|------|-------|---------|
| JS/TS | `eslint` | `npx eslint --version` | `npm i -D eslint` |
| JS/TS | `prettier` or `biome` | `npx prettier --version` / `npx biome --version` | project-local |
| Python | `ruff` | `which ruff` | `pipx install ruff` |
| Go | `gofmt` + `golangci-lint` | built-in / `which golangci-lint` | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
| Rust | `rustfmt` + `clippy` | `rustup component list --installed` | `rustup component add rustfmt clippy` |

#### Category 6 — Debugger (DAP)

| Language | Adapter | Check | Install |
|----------|---------|-------|---------|
| JS/TS | `node --inspect` | built-in | — |
| Python | `debugpy` | `python -m debugpy --version` | `pip install debugpy` |
| Go | `dlv` (Delve) | `which dlv` | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| Rust | `codelldb` or `lldb` | `which lldb` | `apt install lldb` / included with Xcode |

#### Category 7 — Dependency Graph

| Language | Tool | Check | Install |
|----------|------|-------|---------|
| JS/TS | `madge` | `which madge` | `npm i -g madge` |
| Python | `pydeps` or `pipdeptree` | `which pipdeptree` | `pipx install pipdeptree` |
| Go | `go mod graph` | built-in | — |
| Rust | `cargo tree` | built-in | — |

### Phase 4 — Generate Report

Produce a report with this structure:

```
## Environment
- OS: {OS} {ARCH}
- Package manager: {PKG_MANAGER}
- Languages: {languages[]}
- Frameworks: {frameworks[]}

## Already installed ✓
- {tool}: {version}

## Recommendations (priority order)

### 1. [CRITICAL] {Category} — {Tool}
**Why:** {what Claude Code currently can't do without it}
**Install:**
\`\`\`sh
{exact command for this OS/package manager}
\`\`\`
**Configure for Claude Code:**
{any MCP config, settings.json changes, or LSP setup needed}
**Verify:**
\`\`\`sh
{command to confirm it works}
\`\`\`

### 2. [HIGH] ...
### 3. [MEDIUM] ...
```

Priority levels:
- **CRITICAL** — Language server for the project's primary language. Always #1.
- **HIGH** — AST tools, type checker, test runner with structured output.
- **MEDIUM** — Linter/formatter auto-fix, dependency graph, debugger.
- **LOW** — Nice-to-haves for the specific stack.

### Phase 5 — MCP Configuration Guidance

If the project would benefit from MCP servers, generate the exact
`~/.claude/settings.json` additions:

```json
{
  "mcpServers": {
    "lsp-{language}": {
      "command": "{server-binary}",
      "args": ["--stdio"]
    }
  }
}
```

Include only servers relevant to the detected languages.

---

## Verify Procedure (--verify mode)

For each tool in the recommendation list (whether newly installed or
pre-existing), run a functional check — not just `which`, but an actual
operation that confirms the tool works against this project.

### Verification checks

```
For each recommended tool:
  1. Binary exists?        → which {binary}
  2. Version parseable?    → {binary} --version
  3. Functional check:
     - LSP: start server, send initialize request, confirm capabilities response
     - Type checker: run against one project file, confirm structured output
     - Test runner: run one test with JSON output, confirm parseable
     - Linter: run against one file, confirm output
     - AST tool: parse one file, confirm tree output
     - Dep graph: run against project, confirm output
  4. Claude Code integration:
     - MCP server: check settings.json entry exists and server connects
     - LSP tool: confirm deferred tool is loadable
```

### Verification report format

```
## Tooling Verification Report

| Tool | Installed | Version | Functional | Claude Code Integration |
|------|-----------|---------|------------|------------------------|
| typescript-language-server | ✓ | 4.3.3 | ✓ | ✗ — needs MCP config |
| pyright | ✗ | — | — | — |

## Action items
1. {what to fix, exact command}
```

---

## Important notes

- Never install anything without showing the user the command first.
- Prefer project-local installs (`npm i -D`, `pip install` in venv) over global
  for tools that are project-specific (linters, formatters, test runners).
- Prefer global installs for language servers and CLI tools that span projects.
- If the project has a devcontainer or Dockerfile, note that tools should be
  added there for reproducibility.
- Adapt install commands to the detected OS and package manager — don't suggest
  `brew` on Linux or `apt` on macOS.
- For monorepos, check each workspace root for language-specific tooling.
