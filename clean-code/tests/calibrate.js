#!/usr/bin/env node
// clean-code — calibration harness
//
// The reviewer is told to report only what "a senior reviewer would block the
// PR over". That instruction is unfalsifiable on its own: nothing detects when
// a corpus edit makes the reviewer noisier or blinder. This harness makes it
// measurable.
//
// Each fixture is a diff with a known verdict. Clean fixtures are deliberately
// tempting — code that looks flaggable but is not — because false positives are
// what get a gate bypassed reflexively, and they are the number this harness
// exists to hold down.
//
// Usage:
//   node tests/calibrate.js [options]
//
//   --fixtures <dir>     fixture directory (default: tests/fixtures)
//   --filter <substr>    run only fixtures whose name contains substr
//   --repeat <n>         run each fixture n times and report stability
//   --json <path>        write the full result as JSON (a baseline to diff later)
//   --compare <path>     compare against a saved baseline and report deltas
//   --max-fp-rate <f>    fail above this false-positive rate (default 0.10)
//   --min-detection <f>  fail below this detection rate (default 0.80)
//   --verbose            print each finding the reviewer returned
//
// Env:
//   CLEAN_CODE_REVIEW_CMD   command receiving the prompt on stdin and returning
//                           the reviewer's JSON on stdout (default: "claude -p")
//
// Exit 0 when both thresholds hold, 1 when either is violated, 2 on setup error.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');
const GATE = path.join(PLUGIN_ROOT, 'hooks', 'gate.js');

// ------------------------------------------------------------------- options

function parseArgs(argv) {
  const opts = {
    fixtures: path.join(__dirname, 'fixtures'),
    filter: null,
    repeat: 1,
    json: null,
    compare: null,
    maxFpRate: 0.1,
    minDetection: 0.8,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fatal(`${arg} requires a value`);
      i += 1;
      return value;
    };
    if (arg === '--fixtures') opts.fixtures = path.resolve(next());
    else if (arg === '--filter') opts.filter = next();
    else if (arg === '--repeat') opts.repeat = Number(next());
    else if (arg === '--json') opts.json = path.resolve(next());
    else if (arg === '--compare') opts.compare = path.resolve(next());
    else if (arg === '--max-fp-rate') opts.maxFpRate = Number(next());
    else if (arg === '--min-detection') opts.minDetection = Number(next());
    else if (arg === '--verbose') opts.verbose = true;
    else fatal(`unknown option: ${arg}`);
  }
  return opts;
}

function fatal(message) {
  console.error(`calibrate: ${message}`);
  process.exit(2);
}

// ------------------------------------------------------------------ fixtures

// A fixture is a directory: case.json (expectations) + change.diff (the input).
function loadFixtures(dir, filter) {
  if (!fs.existsSync(dir)) fatal(`fixture directory not found: ${dir}`);
  const names = fs
    .readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isDirectory())
    .filter((name) => !filter || name.includes(filter))
    .sort();

  return names.map((name) => {
    const casePath = path.join(dir, name, 'case.json');
    const diffPath = path.join(dir, name, 'change.diff');
    if (!fs.existsSync(casePath)) fatal(`${name}: missing case.json`);
    if (!fs.existsSync(diffPath)) fatal(`${name}: missing change.diff`);

    const spec = JSON.parse(fs.readFileSync(casePath, 'utf8'));
    if (spec.expect !== 'pass' && spec.expect !== 'block') {
      fatal(`${name}: case.json 'expect' must be "pass" or "block"`);
    }
    if (spec.expect === 'block' && !spec.expect_principle) {
      fatal(`${name}: blocking fixtures must declare expect_principle`);
    }
    return { name, dir: path.join(dir, name), diffPath, ...spec };
  });
}

// ------------------------------------------------------------------ reviewing

function buildPrompt(diffPath) {
  return execSync(`node ${JSON.stringify(GATE)} prompt --diff-file ${JSON.stringify(diffPath)}`, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function runReviewer(prompt) {
  const command = process.env.CLEAN_CODE_REVIEW_CMD || 'claude -p';
  return execSync(command, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

// Same tolerance as gate.js triage: accept a fenced or prose-wrapped reply.
function parseReview(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in reviewer output');
  return JSON.parse(raw.slice(start, end + 1));
}

const GATING_SEVERITIES = new Set(['blocker', 'major']);

function gatingFindings(report) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  return findings.filter((f) => GATING_SEVERITIES.has(f.severity) && f.confidence === 'high');
}

// ------------------------------------------------------------------- scoring

function area(slug) {
  return typeof slug === 'string' ? slug.split('/')[0] : '';
}

// Matching on the principle AREA rather than the exact slug is deliberate: a
// reviewer that calls a swallowed exception errors/fail-fast instead of
// errors/never-swallow has still caught the defect. Exact-slug agreement is
// tracked separately as a sharper, non-gating signal.
//
// also_accepts extends this across areas, for defects that two rules genuinely
// cover — a query-named function that mutates is both naming/no-disinformation
// and functions/no-hidden-side-effects. Without it the harness scores a correct
// finding as a miss and pushes you to "fix" a reviewer that was right.
function scoreOnce(fixture, gating) {
  if (fixture.expect === 'pass') {
    return {
      outcome: gating.length === 0 ? 'correct' : 'false-positive',
      unexpected: gating.map(describe),
      exactSlug: null,
    };
  }

  const detectionAreas = new Set([fixture.expect_principle, ...(fixture.also_accepts || [])].map(area));
  const matched = gating.find((f) => {
    if (!detectionAreas.has(area(f.principle))) return false;
    if (fixture.expect_file && !String(f.file || '').endsWith(fixture.expect_file)) return false;
    return true;
  });

  const allowed = new Set([...detectionAreas, ...(fixture.allow_extra || []).map(area)]);
  const unexpected = gating.filter((f) => f !== matched && !allowed.has(area(f.principle)));

  return {
    outcome: matched ? 'correct' : 'missed',
    unexpected: unexpected.map(describe),
    exactSlug: matched ? matched.principle === fixture.expect_principle : null,
  };
}

function describe(f) {
  return `${f.file}:${f.line} [${f.principle}] ${f.summary}`;
}

// ---------------------------------------------------------------------- run

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.repeat) || opts.repeat < 1) fatal('--repeat must be a positive integer');

  const fixtures = loadFixtures(opts.fixtures, opts.filter);
  if (fixtures.length === 0) fatal('no fixtures matched');

  console.log(`clean-code calibration — ${fixtures.length} fixtures, ${opts.repeat} run(s) each`);
  console.log(`reviewer: ${process.env.CLEAN_CODE_REVIEW_CMD || 'claude -p'}\n`);

  const results = [];

  for (const fixture of fixtures) {
    const prompt = buildPrompt(fixture.diffPath);
    const runs = [];

    for (let attempt = 0; attempt < opts.repeat; attempt += 1) {
      let gating;
      let error = null;
      try {
        gating = gatingFindings(parseReview(runReviewer(prompt)));
      } catch (err) {
        gating = [];
        error = err.message;
      }
      const scored = error ? { outcome: 'error', unexpected: [], exactSlug: null, error } : scoreOnce(fixture, gating);
      runs.push(scored);
    }

    const correct = runs.filter((r) => r.outcome === 'correct').length;
    const stability = correct / runs.length;
    const worst = runs.find((r) => r.outcome !== 'correct') || runs[0];

    results.push({
      name: fixture.name,
      expect: fixture.expect,
      principle: fixture.expect_principle || null,
      language: fixture.language || null,
      correct,
      runs: runs.length,
      stability,
      outcome: worst.outcome,
      exactSlugRate: rate(runs.map((r) => r.exactSlug).filter((v) => v !== null)),
      unexpected: worst.unexpected,
      error: worst.error || null,
    });

    printFixtureLine(results[results.length - 1], opts);
  }

  const summary = summarise(results, opts);
  printSummary(summary, results);

  if (opts.json) {
    // A baseline without its provenance is uninterpretable: scores are specific
    // to the reviewer that produced them, and `claude -p` follows whatever model
    // the user has configured.
    const meta = {
      reviewer: process.env.CLEAN_CODE_REVIEW_CMD || 'claude -p',
      cli: safeExec('claude --version'),
      recordedAt: new Date().toISOString(),
    };
    fs.writeFileSync(opts.json, JSON.stringify({ meta, summary, results }, null, 2) + '\n');
    console.log(`\nbaseline written: ${opts.json}`);
  }
  if (opts.compare) compareBaseline(opts.compare, results);

  process.exit(summary.pass ? 0 : 1);
}

function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function rate(values) {
  if (values.length === 0) return null;
  return values.filter(Boolean).length / values.length;
}

function printFixtureLine(result, opts) {
  const mark = result.outcome === 'correct' ? 'ok  ' : result.outcome === 'error' ? 'ERR ' : 'FAIL';
  const stability = result.runs > 1 ? ` (${result.correct}/${result.runs})` : '';
  const label = result.expect === 'pass' ? 'clean' : result.principle;
  console.log(`  ${mark} ${result.name.padEnd(28)} ${label}${stability}`);

  if (result.error) console.log(`       error: ${result.error}`);
  if (result.outcome === 'missed') console.log('       reviewer did not flag the seeded defect');
  if (result.unexpected.length && (opts.verbose || result.outcome !== 'correct')) {
    for (const item of result.unexpected) console.log(`       unexpected: ${item}`);
  }
}

function summarise(results, opts) {
  const clean = results.filter((r) => r.expect === 'pass');
  const blocking = results.filter((r) => r.expect === 'block');

  const fpRate = clean.length ? clean.filter((r) => r.outcome !== 'correct').length / clean.length : 0;
  const detection = blocking.length ? blocking.filter((r) => r.outcome === 'correct').length / blocking.length : 1;
  const exact = results.map((r) => r.exactSlugRate).filter((v) => v !== null);
  const unexpectedTotal = results.reduce((sum, r) => sum + r.unexpected.length, 0);
  const errors = results.filter((r) => r.outcome === 'error').length;

  return {
    fixtures: results.length,
    cleanFixtures: clean.length,
    blockingFixtures: blocking.length,
    falsePositiveRate: fpRate,
    detectionRate: detection,
    exactSlugAgreement: exact.length ? exact.reduce((a, b) => a + b, 0) / exact.length : null,
    unexpectedFindings: unexpectedTotal,
    errors,
    thresholds: { maxFpRate: opts.maxFpRate, minDetection: opts.minDetection },
    pass: fpRate <= opts.maxFpRate && detection >= opts.minDetection && errors === 0,
  };
}

function pct(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`;
}

function printSummary(summary) {
  console.log('\n--- calibration summary ---');
  console.log(`  false-positive rate   ${pct(summary.falsePositiveRate)}  (${summary.cleanFixtures} clean fixtures, max ${pct(summary.thresholds.maxFpRate)})`);
  console.log(`  detection rate        ${pct(summary.detectionRate)}  (${summary.blockingFixtures} seeded defects, min ${pct(summary.thresholds.minDetection)})`);
  console.log(`  exact-slug agreement  ${pct(summary.exactSlugAgreement)}  (non-gating signal)`);
  console.log(`  unexpected findings   ${summary.unexpectedFindings}`);
  if (summary.errors) console.log(`  reviewer errors       ${summary.errors}`);
  console.log(`\n  ${summary.pass ? 'PASS' : 'FAIL'} — false positives are the number that matters; they are what get a gate bypassed.`);
}

function compareBaseline(baselinePath, results) {
  if (!fs.existsSync(baselinePath)) fatal(`baseline not found: ${baselinePath}`);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const before = new Map((baseline.results || []).map((r) => [r.name, r]));

  const changes = [];
  for (const result of results) {
    const prior = before.get(result.name);
    if (!prior) {
      changes.push(`  + ${result.name} (new fixture, ${result.outcome})`);
    } else if (prior.outcome !== result.outcome) {
      const direction = result.outcome === 'correct' ? 'fixed' : 'REGRESSED';
      changes.push(`  ${direction === 'fixed' ? '✓' : '✗'} ${result.name}: ${prior.outcome} → ${result.outcome} (${direction})`);
    } else if (prior.stability !== result.stability) {
      changes.push(`  ~ ${result.name}: stability ${pct(prior.stability)} → ${pct(result.stability)}`);
    }
  }
  for (const name of before.keys()) {
    if (!results.some((r) => r.name === name)) changes.push(`  - ${name} (fixture removed)`);
  }

  console.log('\n--- vs baseline ---');
  console.log(changes.length ? changes.join('\n') : '  no change');
}

main();
