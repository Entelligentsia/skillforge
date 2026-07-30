#!/usr/bin/env node
// clean-code — deterministic commit gate
//
// Contains NO opinion about code quality. Its only jobs are: recognise a commit
// command, resolve configuration, decide whether the staged content has already
// been reviewed, and manage the small amount of state that makes that decision
// idempotent. All quality judgment lives in the reviewer agent and the
// principles corpus.
//
// Subcommands:
//   check              PreToolUse hook entry point (reads hook JSON on stdin)
//   gate-check         Same decision, plain text + exit status, for git hooks
//   hash               Print the current review id
//   mark <verdict>     Record that the current staged tree passed the gate
//   pending read|write|clear
//   config             Print resolved configuration as JSON
//   diff               Print the staged diff with configured excludes applied
//   status             Print full subsystem state as JSON (setup/remove preflight)
//   prune              Garbage-collect old markers
//
// Uses only Node.js built-ins.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERDICTS = ['passed', 'fixes-applied', 'user-approved', 'bypassed'];
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MARKER_KEEP = 50;
const MARKER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULTS = {
  enabled: true,
  severity_threshold: 'major',
  exclude: ['**/*.lock', 'dist/**', '**/generated/**', 'vendor/**'],
  max_diff_lines: 1500,
  fail_mode: 'open',
  headless_timeout_s: 180,
  log_bypass: true,
  bypass: 'logged',
  personal_excludes: 'deny',
};

// Ordered strictest-last, so a higher index always means a tighter setting.
const STRICTNESS = {
  severity_threshold: ['major', 'blocker'],
  bypass: ['logged', 'reason-required', 'disabled'],
  fail_mode: ['open', 'closed'],
};

// ---------------------------------------------------------------- git helpers

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  }).trim();
}

function gitDir() {
  return git(['rev-parse', '--absolute-git-dir']);
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']);
}

// Linked worktrees have no hooks/ of their own: git redirects hook lookup to the
// common git dir, so --absolute-git-dir points somewhere git will never execute
// a hook from. --git-path maps this correctly and is right for ordinary clones
// too, so there is no worktree special case. Its output is relative to cwd in
// the main worktree and absolute in a linked one — resolve either way.
//
// Note this is deliberately NOT used for the state dir: review markers must stay
// per-worktree, since each worktree stages different content and sharing them
// would let a review approved in one satisfy the gate in another.
function hooksDir() {
  return path.resolve(process.cwd(), git(['rev-parse', '--git-path', 'hooks']));
}

// Like --git-path, this is cwd-relative in the main worktree and absolute in a
// linked one, so it must be resolved before comparing against the git dir.
function commonDir() {
  return path.resolve(process.cwd(), git(['rev-parse', '--git-common-dir']));
}

function headSha() {
  try {
    return git(['rev-parse', 'HEAD']);
  } catch {
    return null; // initial commit — no HEAD yet
  }
}

function stagedTree() {
  return git(['write-tree']);
}

function headTree() {
  try {
    return git(['rev-parse', 'HEAD^{tree}']);
  } catch {
    return EMPTY_TREE;
  }
}

// Review identity is the plumbing-stable pair (base commit, staged tree) rather
// than a hash of diff text, which varies with diff.algorithm and context settings.
function reviewId() {
  return `${headSha() || 'empty'}-${stagedTree()}`;
}

function operationInProgress() {
  const dir = gitDir();
  const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];
  return markers.some((m) => fs.existsSync(path.join(dir, m)));
}

// ------------------------------------------------------------------ state dir

function stateDir() {
  return path.join(gitDir(), 'clean-review');
}

function ensureStateDir() {
  const dir = stateDir();
  fs.mkdirSync(path.join(dir, 'reviewed'), { recursive: true });
  return dir;
}

function markerPath(id) {
  return path.join(stateDir(), 'reviewed', id);
}

function isReviewed(id) {
  return fs.existsSync(markerPath(id));
}

function writeMarker(id, verdict, extra = {}) {
  ensureStateDir();
  const body = {
    verdict,
    at: new Date().toISOString(),
    review_id: id,
    ...extra,
  };
  fs.writeFileSync(markerPath(id), JSON.stringify(body, null, 2) + '\n');
  return body;
}

function logBypass(id, actor, reason) {
  ensureStateDir();
  const line = JSON.stringify({ at: new Date().toISOString(), review_id: id, actor, reason }) + '\n';
  fs.appendFileSync(path.join(stateDir(), 'bypass.log'), line);
}

function pendingPath() {
  return path.join(stateDir(), 'pending.json');
}

function prune() {
  const dir = path.join(stateDir(), 'reviewed');
  if (!fs.existsSync(dir)) return 0;
  const entries = fs
    .readdirSync(dir)
    .map((name) => {
      const full = path.join(dir, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        /* raced with another session; treat as oldest */
      }
      return { full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const cutoff = Date.now() - MARKER_MAX_AGE_MS;
  let removed = 0;
  entries.forEach((entry, index) => {
    if (index < MARKER_KEEP && entry.mtime >= cutoff) return;
    try {
      fs.unlinkSync(entry.full);
      removed += 1;
    } catch {
      /* already gone */
    }
  });
  return removed;
}

// -------------------------------------------------------------- configuration

// Minimal YAML frontmatter reader: scalars, inline lists, and block lists.
// Deliberately not a general YAML parser — the config surface is fixed and small.
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { data: {}, body: text.trim() };

  const data = {};
  let currentKey = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(coerce(item[1]));
      continue;
    }

    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    currentKey = pair[1];
    const value = pair[2].trim();
    data[currentKey] = value === '' ? [] : coerce(value);
  }

  return { data, body: (match[2] || '').trim() };
}

function coerce(raw) {
  let value = raw.trim();
  if (/^\[.*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(',').map((part) => coerce(part)) : [];
  }
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function readConfigFile(file) {
  if (!fs.existsSync(file)) return null;
  const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return { file, data: parsed.data, body: parsed.body };
}

function strictest(key, a, b) {
  const scale = STRICTNESS[key];
  if (!scale) return b === undefined ? a : b;
  const ia = scale.indexOf(a);
  const ib = scale.indexOf(b);
  if (ia < 0) return b;
  if (ib < 0) return a;
  return ia >= ib ? a : b;
}

// Content accumulates downward; constraints may only tighten. A personal config
// can always make the gate stricter, never weaker.
function resolveConfig() {
  const root = repoRoot();
  const policy = readConfigFile(path.join(root, '.claude', 'clean-code.policy.md'));
  const local = readConfigFile(path.join(root, '.claude', 'clean-code.local.md'));

  const config = { ...DEFAULTS };
  const notices = [];
  const locked = policy && Array.isArray(policy.data.locked) ? policy.data.locked : [];

  if (policy) {
    for (const [key, value] of Object.entries(policy.data)) {
      if (key === 'locked') continue;
      config[key] = value;
    }
  }

  if (local) {
    for (const [key, value] of Object.entries(local.data)) {
      if (locked.includes(key)) {
        if (JSON.stringify(config[key]) !== JSON.stringify(value)) {
          notices.push(`'${key}' is locked by repo policy (personal value ignored)`);
        }
        continue;
      }
      if (STRICTNESS[key] && policy) {
        config[key] = strictest(key, config[key], value);
      } else if (key === 'exclude') {
        if (policy && config.personal_excludes !== 'allow') {
          notices.push("personal 'exclude' entries are not permitted by repo policy");
        } else {
          config.exclude = [...new Set([...(config.exclude || []), ...value])];
        }
      } else if (key === 'max_diff_lines' && policy) {
        config[key] = Math.min(config[key], value); // personal may only lower
      } else {
        config[key] = value;
      }
    }
  }

  const rubric = [];
  if (policy && policy.body) rubric.push({ source: 'repo policy', text: policy.body });
  if (local && local.body) rubric.push({ source: 'personal', text: local.body });

  return {
    config,
    notices,
    locked,
    rubric,
    optedIn: Boolean(policy || local),
    policyFile: policy ? policy.file : null,
    localFile: local ? local.file : null,
  };
}

// ---------------------------------------------------------- commit detection

// Global git options that consume a following argument.
const VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);

function stripQuoted(command) {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function isCommitCommand(command) {
  if (!command) return false;
  // Quoted strings are blanked first so `-m "git commit fix"` cannot false-positive.
  const segments = stripQuoted(command).split(/&&|\|\||;|\||\n/);

  return segments.some((segment) => {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    // Skip leading env assignments (FOO=bar git commit ...)
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
    if (tokens[i] !== 'git') return false;
    i += 1;

    while (i < tokens.length) {
      const token = tokens[i];
      if (!token.startsWith('-')) return token === 'commit';
      if (VALUE_OPTS.has(token)) i += 2;
      else i += 1;
    }
    return false;
  });
}

function bypassRequested(command) {
  if (process.env.SKIP_CLEAN_REVIEW === '1') return true;
  return /(^|\s)SKIP_CLEAN_REVIEW=1(\s|$)/.test(command || '');
}

// ------------------------------------------------------------- gate decision

// Returns { allow, reason, code } where code names the rule that decided.
// Order matters: cheap structural checks precede any state lookup.
function decide(command) {
  if (!isCommitCommand(command)) return { allow: true, code: 'not-a-commit' };

  const resolved = resolveConfig();
  if (!resolved.optedIn) return { allow: true, code: 'repo-not-opted-in' };
  if (resolved.config.enabled === false) return { allow: true, code: 'paused' };

  if (bypassRequested(command)) {
    if (resolved.config.bypass === 'disabled') {
      // Honoured locally — a local hook is not tamper-proof and pretending
      // otherwise is worse than recording it. CI verifies the trailer.
      if (resolved.config.log_bypass !== false) logBypass(reviewId(), 'env:SKIP_CLEAN_REVIEW', null);
      return {
        allow: true,
        code: 'bypass-env-against-policy',
        notice: 'clean-code: bypass is disabled by repo policy — this commit will be flagged in CI',
      };
    }
    if (resolved.config.log_bypass !== false) logBypass(reviewId(), 'env:SKIP_CLEAN_REVIEW', null);
    return { allow: true, code: 'bypass-env' };
  }

  if (operationInProgress()) return { allow: true, code: 'operation-in-progress' };
  if (stagedTree() === headTree()) return { allow: true, code: 'no-staged-changes' };

  const id = reviewId();
  if (isReviewed(id)) return { allow: true, code: 'already-reviewed', reviewId: id };

  prune();
  return {
    allow: false,
    code: 'review-required',
    reviewId: id,
    notices: resolved.notices,
    reason:
      'Staged changes have not passed clean-code review.\n' +
      'Run /clean-code:review now. It reviews the staged diff, presents any findings ' +
      'through AskUserQuestion, and retries this commit once the gate is satisfied.\n' +
      'Do not retry the commit before the review completes, and do not bypass it unless ' +
      'the user explicitly chooses to.',
  };
}

// ------------------------------------------------------------------ subcommands

function cmdCheck() {
  // PreToolUse: read the hook payload, emit a permission decision.
  // Any failure must fail open — a broken gate must never brick a session.
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }

  if (payload.tool_name && payload.tool_name !== 'Bash') process.exit(0);
  const command = (payload.tool_input && payload.tool_input.command) || '';

  let verdict;
  try {
    verdict = decide(command);
  } catch (err) {
    if (process.env.CLEAN_CODE_DEBUG) console.error(`clean-code gate error: ${err.message}`);
    process.exit(0);
  }

  if (verdict.allow) {
    if (verdict.notice) {
      console.log(JSON.stringify({ systemMessage: verdict.notice }));
    }
    process.exit(0);
  }

  const messages = verdict.notices && verdict.notices.length ? `clean-code: ${verdict.notices.join('; ')}` : undefined;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
      ...(messages ? { systemMessage: messages } : {}),
    })
  );
  process.exit(0);
}

// Plain-text decision for the git-native hook: exit 0 = proceed, 1 = review needed.
function cmdGateCheck() {
  let verdict;
  try {
    verdict = decide('git commit');
  } catch (err) {
    console.error(`clean-code: gate error (${err.message}) — allowing commit`);
    process.exit(0);
  }
  if (verdict.notice) console.error(verdict.notice);
  if (verdict.allow) process.exit(0);
  process.exit(1);
}

function cmdMark(verdict, extraJson) {
  if (!VERDICTS.includes(verdict)) {
    console.error(`clean-code: unknown verdict '${verdict}' (expected one of ${VERDICTS.join(', ')})`);
    process.exit(2);
  }
  let extra = {};
  if (extraJson) {
    try {
      extra = JSON.parse(extraJson);
    } catch {
      console.error('clean-code: extra argument to mark must be valid JSON');
      process.exit(2);
    }
  }
  const id = reviewId();
  const body = writeMarker(id, verdict, extra);
  if (verdict === 'user-approved' || verdict === 'bypassed') {
    const resolved = resolveConfig();
    if (resolved.config.log_bypass !== false) logBypass(id, `gate:${verdict}`, extra.reason || null);
  }
  console.log(JSON.stringify(body));
}

function cmdPending(action) {
  const file = pendingPath();
  if (action === 'clear') {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  if (action === 'read') {
    if (!fs.existsSync(file)) {
      console.log(JSON.stringify({ present: false }));
      return;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify({ present: true, stale: data.review_id !== reviewId(), ...data }));
    return;
  }
  if (action === 'write') {
    ensureStateDir();
    const input = fs.readFileSync(0, 'utf8');
    const findings = JSON.parse(input);
    const body = { review_id: reviewId(), at: new Date().toISOString(), findings };
    fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
    console.log(JSON.stringify({ written: file, count: Array.isArray(findings) ? findings.length : undefined }));
    return;
  }
  console.error('clean-code: pending requires read | write | clear');
  process.exit(2);
}

function excludePathspecs(config) {
  return (config.exclude || []).map((glob) => `:(exclude,glob)${glob}`);
}

function cmdDiff() {
  const { config } = resolveConfig();
  const args = ['diff', '--staged', '--no-color', '--', '.', ...excludePathspecs(config)];
  process.stdout.write(git(args, { stdio: ['ignore', 'pipe', 'inherit'] }) + '\n');
}

function cmdStatus() {
  const root = repoRoot();
  const resolved = resolveConfig();
  const dir = stateDir();
  const reviewedDir = path.join(dir, 'reviewed');
  const bypassLog = path.join(dir, 'bypass.log');

  const hooksPath = hooksDir();
  const hooks = {
    husky: hookState(path.join(root, '.husky', 'pre-commit')),
    preCommitFramework: hookState(path.join(root, '.pre-commit-config.yaml')),
    bare: hookState(path.join(hooksPath, 'pre-commit')),
    chainedBackup: fs.existsSync(path.join(hooksPath, 'pre-commit.chained')),
  };

  let diffLines = 0;
  try {
    diffLines = git(['diff', '--staged', '--numstat']).split('\n').filter(Boolean).length;
  } catch {
    /* ignore */
  }

  const id = safe(() => reviewId(), null);
  console.log(
    JSON.stringify(
      {
        repo_root: root,
        git_dir: gitDir(),
        // Where git actually looks for hooks (common dir under a worktree),
        // and where per-worktree review state lives. Setup and remove must use
        // these values rather than deriving hook paths from git_dir.
        hooks_dir: hooksPath,
        state_dir: dir,
        linked_worktree: gitDir() !== safe(commonDir, gitDir()),
        state: !resolved.optedIn ? 'dormant' : resolved.config.enabled === false ? 'paused' : 'active',
        opted_in: resolved.optedIn,
        policy_file: resolved.policyFile,
        local_file: resolved.localFile,
        locked: resolved.locked,
        notices: resolved.notices,
        config: resolved.config,
        review_id: id,
        reviewed: id ? isReviewed(id) : false,
        staged_files: diffLines,
        markers: fs.existsSync(reviewedDir) ? fs.readdirSync(reviewedDir).length : 0,
        pending: fs.existsSync(pendingPath()),
        bypass_entries: fs.existsSync(bypassLog)
          ? fs.readFileSync(bypassLog, 'utf8').split('\n').filter(Boolean).length
          : 0,
        state_dir_exists: fs.existsSync(dir),
        hooks,
      },
      null,
      2
    )
  );
}

const SEVERITY_ORDER = ['advisory', 'major', 'blocker'];

function isGating(finding, threshold) {
  const rank = SEVERITY_ORDER.indexOf(finding.severity);
  const bar = SEVERITY_ORDER.indexOf(threshold);
  return rank >= 0 && bar >= 0 && rank >= bar && finding.confidence === 'high';
}

// Assemble the full reviewer prompt: agent instructions, layered rubric, diff.
// Shared by the git-native hook and any CI runner, so both judge identically.
function cmdPrompt() {
  const pluginRoot = path.join(__dirname, '..');
  const resolved = resolveConfig();
  const sections = [];

  const agentFile = path.join(pluginRoot, 'agents', 'clean-code-reviewer.md');
  if (fs.existsSync(agentFile)) {
    sections.push(parseFrontmatter(fs.readFileSync(agentFile, 'utf8')).body);
  }

  const principlesDir = path.join(pluginRoot, 'docs', 'principles');
  if (fs.existsSync(principlesDir)) {
    const corpus = fs
      .readdirSync(principlesDir)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => fs.readFileSync(path.join(principlesDir, name), 'utf8'))
      .join('\n\n');
    sections.push(`# Rubric — source: base\n\n${corpus}`);
  }

  for (const layer of resolved.rubric) {
    sections.push(`# Rubric — source: ${layer.source}\n\n${layer.text}`);
  }

  const args = ['diff', '--staged', '--no-color', '--', '.', ...excludePathspecs(resolved.config)];
  sections.push(`# Staged diff (repo root: ${repoRoot()})\n\n\`\`\`diff\n${git(args)}\n\`\`\``);
  sections.push('Return only the JSON object described above. No prose, no code fences.');

  process.stdout.write(sections.join('\n\n---\n\n') + '\n');
}

// Read reviewer JSON on stdin, apply the configured threshold, act on the result.
// Exit 0 = gate satisfied (marker written); exit 1 = findings need triage.
function cmdTriage() {
  const { config } = resolveConfig();
  const raw = fs.readFileSync(0, 'utf8');

  let report;
  try {
    // Tolerate a fenced or prose-wrapped reply by extracting the outermost object.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('no JSON object found');
    report = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    console.error(`clean-code: could not parse reviewer output (${err.message})`);
    process.exit(2);
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const gating = findings.filter((f) => isGating(f, config.severity_threshold));
  const advisory = findings.filter((f) => !isGating(f, config.severity_threshold));

  if (gating.length === 0) {
    writeMarker(reviewId(), 'passed', { findings_count: 0, source: 'headless' });
    console.log(`clean-code: review passed${advisory.length ? ` (${advisory.length} advisory)` : ''}`);
    process.exit(0);
  }

  ensureStateDir();
  fs.writeFileSync(
    pendingPath(),
    JSON.stringify({ review_id: reviewId(), at: new Date().toISOString(), findings: gating }, null, 2) + '\n'
  );

  console.error(`\nclean-code: ${gating.length} finding${gating.length === 1 ? '' : 's'} — commit blocked\n`);
  for (const f of gating) {
    const source = f.source ? `[${f.source}] ` : '';
    console.error(`  ${f.file}:${f.line} — ${source}${f.summary}`);
    if (f.fix && f.fix.description) console.error(`      fix: ${f.fix.description}`);
  }
  console.error('\nFix and re-commit, or triage interactively:  claude "/clean-code:resume"\n');
  process.exit(1);
}

function hookState(file) {
  if (!fs.existsSync(file)) return { present: false, managed: false };
  const text = fs.readFileSync(file, 'utf8');
  return { present: true, managed: text.includes('>>> clean-code gate >>>'), file };
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------- dispatch

function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'check':
      return cmdCheck();
    case 'gate-check':
      return cmdGateCheck();
    case 'hash':
      return console.log(reviewId());
    case 'mark':
      return cmdMark(rest[0], rest[1]);
    case 'pending':
      return cmdPending(rest[0]);
    case 'config':
      return console.log(JSON.stringify(resolveConfig(), null, 2));
    case 'diff':
      return cmdDiff();
    case 'prompt':
      return cmdPrompt();
    case 'triage':
      return cmdTriage();
    case 'status':
      return cmdStatus();
    case 'prune':
      return console.log(JSON.stringify({ removed: prune() }));
    default:
      console.error(
        'clean-code gate — usage: gate.js <check|gate-check|hash|mark|pending|config|diff|prompt|triage|status|prune>'
      );
      process.exit(2);
  }
}

main();
