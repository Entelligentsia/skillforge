#!/usr/bin/env node

/**
 * compute_usage.js — Claude Code token usage for an arbitrary date range.
 *
 * Walks every transcript JSONL under ~/.claude/projects (main sessions,
 * subagents, and workflow runs) and sums the per-message `usage` blocks
 * for messages whose timestamp falls inside [--start, --end] (inclusive),
 * grouped by model.
 *
 * Usage:
 *   node compute_usage.js --start 2026-06-01 --end 2026-06-07 [options]
 *
 * Options:
 *   --start YYYY-MM-DD   First day to include (inclusive). Required.
 *   --end   YYYY-MM-DD   Last day to include (inclusive). Required.
 *   --tz    +HH:MM|-HH:MM|UTC   Timezone for bucketing days. Default +05:30 (IST).
 *   --format table|json|csv     Output format. Default table.
 *   --daily              Include a per-day breakdown (table/json).
 *   --raw / --no-dedupe  Count every transcript line, including the same
 *                        message id replayed across resumed/compacted sessions
 *                        and subagent trees. Dedupe is ON by default (each
 *                        distinct message id counted once — the accurate
 *                        measure of actual model consumption); use these to get
 *                        the raw on-disk count instead.
 *   --cost               Add a USD cost column/table priced at Anthropic API
 *                        list rates (scripts/pricing.json). Local/non-Anthropic
 *                        models are reported as unpriced.
 *   --cache-ttl 1h|5m    Which prompt-cache write rate to price cache-creation
 *                        tokens at. Default 1h (input x2); 5m is input x1.25.
 *   --projects DIR       Root to scan. Default ~/.claude/projects.
 *   --verbose            Log each file as it is scanned.
 *
 * The "Total" column is input + output tokens (the tokens the model actually
 * read from you and wrote back). Cache-create / cache-read are shown
 * separately because on the subscription they are billed very differently
 * from fresh input — a huge cache-read number just means heavy prompt reuse.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    tz: '+05:30',
    format: 'table',
    daily: false,
    dedupe: true,
    cost: false,
    cacheTtl: '1h',
    verbose: false,
    projects: path.join(process.env.HOME, '.claude', 'projects'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--start': args.start = argv[++i]; break;
      case '--end': args.end = argv[++i]; break;
      case '--tz': args.tz = argv[++i]; break;
      case '--format': args.format = argv[++i]; break;
      case '--daily': args.daily = true; break;
      case '--dedupe': args.dedupe = true; break;
      case '--raw': case '--no-dedupe': args.dedupe = false; break;
      case '--cost': args.cost = true; break;
      case '--cache-ttl': args.cacheTtl = argv[++i]; break;
      case '--verbose': args.verbose = true; break;
      case '--projects': args.projects = argv[++i]; break;
      case '--help': case '-h': args.help = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

function tzOffsetMinutes(tz) {
  if (!tz || tz.toUpperCase() === 'UTC' || tz === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (!m) {
    console.error(`Invalid --tz "${tz}". Use +HH:MM, -HH:MM, or UTC.`);
    process.exit(2);
  }
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

// ISO instant -> YYYY-MM-DD in the requested timezone.
function bucketDate(iso, offsetMin) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + offsetMin * 60000);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const da = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

function usd(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function loadPricing() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8'));
  } catch (e) {
    console.error(`Could not read pricing.json next to the script: ${e.message}`);
    process.exit(1);
  }
}

// Resolve a transcript model id to its rate entry by longest-prefix match, so
// dated snapshots (claude-opus-4-5-20251101) fold into their family key.
function rateForModel(model, pricing) {
  let best = null;
  for (const key of Object.keys(pricing.models)) {
    if (model === key || model.startsWith(key)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? { key: best, ...pricing.models[best] } : null;
}

// Cost of one model's usage bucket in USD. Returns null for unpriced models.
function costForModel(model, bucket, pricing, args) {
  const r = rateForModel(model, pricing);
  if (!r) return null;
  // Sonnet 5 introductory pricing applies only while the whole range is on or
  // before introUntil; a range crossing the boundary falls back to list price.
  let inputRate = r.input, outputRate = r.output;
  if (r.introUntil && r.introInput != null && args.end <= r.introUntil) {
    inputRate = r.introInput;
    outputRate = r.introOutput;
    r.intro = true;
  }
  const mult5m = pricing.cacheWriteMultiplier['5m'];
  const mult1h = pricing.cacheWriteMultiplier['1h'];
  const fallbackMult = (pricing.cacheWriteMultiplier || {})[args.cacheTtl];
  if (fallbackMult == null) {
    console.error(`--cache-ttl must be one of: ${Object.keys(pricing.cacheWriteMultiplier).join(', ')}`);
    process.exit(2);
  }
  const input = (bucket.input / 1e6) * inputRate;
  const output = (bucket.output / 1e6) * outputRate;
  // Price cache writes at their actual TTL; fall back to --cache-ttl only for
  // entries whose usage block carried no ephemeral_*m/_h breakdown.
  const cacheWrite = inputRate * (
    (bucket.cc5m / 1e6) * mult5m +
    (bucket.cc1h / 1e6) * mult1h +
    (bucket.ccUnknown / 1e6) * fallbackMult
  );
  const cacheRead = (bucket.cacheRead / 1e6) * inputRate * pricing.cacheReadMultiplier;
  return {
    key: r.key, intro: !!r.intro,
    input, output, cacheWrite, cacheRead,
    total: input + output + cacheWrite + cacheRead,
  };
}

function emptyBucket() {
  // cc5m / cc1h split the cache-creation tokens by their real TTL when the
  // transcript records it; ccUnknown holds writes with no TTL breakdown, priced
  // at the --cache-ttl fallback.
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, messages: 0,
           cc5m: 0, cc1h: 0, ccUnknown: 0 };
}

function addUsage(target, u) {
  target.input += u.input_tokens || 0;
  target.output += u.output_tokens || 0;
  target.cacheCreate += u.cache_creation_input_tokens || 0;
  target.cacheRead += u.cache_read_input_tokens || 0;
  target.messages += 1;
  const cc = u.cache_creation;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    target.cc5m += cc.ephemeral_5m_input_tokens || 0;
    target.cc1h += cc.ephemeral_1h_input_tokens || 0;
  } else {
    target.ccUnknown += u.cache_creation_input_tokens || 0;
  }
}

function scanFile(filePath, args, offsetMin, seen, modelTotals, dateModel, grandDates) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });
    let matched = 0;
    rl.on('line', (line) => {
      let entry;
      try { entry = JSON.parse(line); } catch { return; }
      const msg = entry && entry.message;
      if (!msg || !msg.usage || !entry.timestamp) return;

      const date = bucketDate(entry.timestamp, offsetMin);
      if (!date || date < args.start || date > args.end) return;

      if (args.dedupe && msg.id) {
        if (seen.has(msg.id)) return;
        seen.add(msg.id);
      }

      const model = msg.model || 'unknown';
      matched++;

      if (!modelTotals[model]) modelTotals[model] = emptyBucket();
      addUsage(modelTotals[model], msg.usage);

      const key = `${date}|${model}`;
      if (!dateModel[key]) dateModel[key] = emptyBucket();
      addUsage(dateModel[key], msg.usage);

      grandDates.add(date);
    });
    rl.on('close', () => {
      if (args.verbose && matched > 0) {
        const label = filePath.split('/').slice(-2).join('/');
        console.error(`  scanned ${label}: ${matched}`);
      }
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || !args.start || !args.end) {
    console.error('Usage: node compute_usage.js --start YYYY-MM-DD --end YYYY-MM-DD [--tz +05:30] [--format table|json|csv] [--daily] [--cost] [--cache-ttl 1h|5m] [--raw] [--verbose]');
    process.exit(args.help ? 0 : 2);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.start) || !/^\d{4}-\d{2}-\d{2}$/.test(args.end)) {
    console.error('--start and --end must be YYYY-MM-DD');
    process.exit(2);
  }
  if (args.start > args.end) {
    console.error(`--start (${args.start}) is after --end (${args.end})`);
    process.exit(2);
  }

  const offsetMin = tzOffsetMinutes(args.tz);
  const pricing = args.cost ? loadPricing() : null;

  let files = [];
  try {
    files = execSync(`find "${args.projects}" -name "*.jsonl" -type f 2>/dev/null`)
      .toString().split('\n').filter(Boolean);
  } catch (e) {
    console.error(`Failed to list transcripts under ${args.projects}: ${e.message}`);
    process.exit(1);
  }

  const seen = new Set();
  const modelTotals = {};
  const dateModel = {};
  const grandDates = new Set();

  for (const f of files) {
    await scanFile(f, args, offsetMin, seen, modelTotals, dateModel, grandDates);
  }

  const models = Object.keys(modelTotals);
  if (models.length === 0) {
    if (args.format === 'json') {
      console.log(JSON.stringify({ range: { start: args.start, end: args.end }, tz: args.tz, models: {}, totals: emptyBucket() }, null, 2));
    } else {
      console.error(`No usage found for ${args.start} .. ${args.end} (tz ${args.tz}).`);
    }
    process.exit(args.format === 'json' ? 0 : 1);
  }

  // Totals across models.
  const totals = emptyBucket();
  for (const m of models) {
    const b = modelTotals[m];
    totals.input += b.input; totals.output += b.output;
    totals.cacheCreate += b.cacheCreate; totals.cacheRead += b.cacheRead;
    totals.messages += b.messages;
  }

  const sortedModels = models.sort((a, b) =>
    (modelTotals[b].input + modelTotals[b].output) - (modelTotals[a].input + modelTotals[a].output));

  // Daily rollup.
  const dailyGroups = {};
  for (const [key, b] of Object.entries(dateModel)) {
    const [date, model] = key.split('|');
    if (!dailyGroups[date]) dailyGroups[date] = {};
    dailyGroups[date][model] = b;
  }
  const sortedDates = Object.keys(dailyGroups).sort();

  // Cost per model (USD), if requested. null entry = unpriced (local model).
  let costs = null, costTotal = null, unpriced = [];
  if (args.cost) {
    costs = {};
    costTotal = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
    for (const m of models) {
      const c = costForModel(m, modelTotals[m], pricing, args);
      costs[m] = c;
      if (c) {
        costTotal.input += c.input; costTotal.output += c.output;
        costTotal.cacheWrite += c.cacheWrite; costTotal.cacheRead += c.cacheRead;
        costTotal.total += c.total;
      } else if (m !== '<synthetic>') {
        unpriced.push(m);
      }
    }
  }

  if (args.format === 'json') {
    const out = {
      range: { start: args.start, end: args.end },
      tz: args.tz,
      dedupe: args.dedupe,
      activeDays: sortedDates.length,
      models: {},
      totals: { ...totals, total: totals.input + totals.output },
    };
    for (const m of sortedModels) {
      const b = modelTotals[m];
      out.models[m] = { ...b, total: b.input + b.output };
      if (args.cost) out.models[m].costUSD = costs[m];
    }
    if (args.cost) {
      out.cost = { cacheTtl: args.cacheTtl, currency: 'USD', totals: costTotal, unpriced };
    }
    if (args.daily) {
      out.daily = sortedDates.map((date) => ({
        date,
        models: Object.fromEntries(Object.entries(dailyGroups[date])
          .map(([m, b]) => [m, { ...b, total: b.input + b.output }])),
        total: Object.values(dailyGroups[date]).reduce((s, b) => s + b.input + b.output, 0),
      }));
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (args.format === 'csv') {
    const costHdr = args.cost ? ',cost_usd' : '';
    console.log(`model,input,output,cache_create,cache_read,total,messages${costHdr}`);
    for (const m of sortedModels) {
      const b = modelTotals[m];
      const costCol = args.cost ? `,${costs[m] ? costs[m].total.toFixed(4) : ''}` : '';
      console.log(`"${m}",${b.input},${b.output},${b.cacheCreate},${b.cacheRead},${b.input + b.output},${b.messages}${costCol}`);
    }
    const totCost = args.cost ? `,${costTotal.total.toFixed(4)}` : '';
    console.log(`"TOTAL",${totals.input},${totals.output},${totals.cacheCreate},${totals.cacheRead},${totals.input + totals.output},${totals.messages}${totCost}`);
    return;
  }

  // table (default)
  const pad = (s, w) => String(s).padEnd(w);
  const rpad = (s, w) => String(s).padStart(w);
  console.log(`\n📊 Claude Code Usage — ${args.start} to ${args.end}  (tz ${args.tz})`);
  console.log(`   Active days: ${sortedDates.length}   Messages: ${fmt(totals.messages)}${args.dedupe ? '' : '   [raw — includes replayed duplicates]'}\n`);
  const header = `${pad('Model', 34)} ${rpad('Input', 13)} ${rpad('Output', 13)} ${rpad('CacheCreate', 14)} ${rpad('CacheRead', 15)} ${rpad('Total', 14)}`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const m of sortedModels) {
    const b = modelTotals[m];
    console.log(`${pad(m, 34)} ${rpad(fmt(b.input), 13)} ${rpad(fmt(b.output), 13)} ${rpad(fmt(b.cacheCreate), 14)} ${rpad(fmt(b.cacheRead), 15)} ${rpad(fmt(b.input + b.output), 14)}`);
  }
  console.log('-'.repeat(header.length));
  console.log(`${pad('TOTAL', 34)} ${rpad(fmt(totals.input), 13)} ${rpad(fmt(totals.output), 13)} ${rpad(fmt(totals.cacheCreate), 14)} ${rpad(fmt(totals.cacheRead), 15)} ${rpad(fmt(totals.input + totals.output), 14)}`);

  if (args.cost) {
    const anyIntro = sortedModels.some((m) => costs[m] && costs[m].intro);
    const anyFallback = sortedModels.some((m) => (modelTotals[m].ccUnknown || 0) > 0);
    const ttlNote = anyFallback ? `; ${args.cacheTtl} fallback where TTL absent` : '';
    console.log(`\n💵 Cost at Anthropic API list rates  (cache-write priced at each entry's real TTL: 5m×${pricing.cacheWriteMultiplier['5m']} / 1h×${pricing.cacheWriteMultiplier['1h']}${ttlNote}; USD)`);
    const chead = `${pad('Model', 34)} ${rpad('Input$', 12)} ${rpad('Output$', 12)} ${rpad('CacheWrite$', 13)} ${rpad('CacheRead$', 13)} ${rpad('Total$', 13)}`;
    console.log(chead);
    console.log('-'.repeat(chead.length));
    for (const m of sortedModels) {
      const c = costs[m];
      if (!c) {
        if (m === '<synthetic>') continue;
        console.log(`${pad(m, 34)} ${rpad('—', 12)} ${rpad('—', 12)} ${rpad('—', 13)} ${rpad('—', 13)} ${rpad('unpriced', 13)}`);
        continue;
      }
      const tag = c.intro ? '*' : '';
      console.log(`${pad(m + tag, 34)} ${rpad(usd(c.input), 12)} ${rpad(usd(c.output), 12)} ${rpad(usd(c.cacheWrite), 13)} ${rpad(usd(c.cacheRead), 13)} ${rpad(usd(c.total), 13)}`);
    }
    console.log('-'.repeat(chead.length));
    console.log(`${pad('TOTAL', 34)} ${rpad(usd(costTotal.input), 12)} ${rpad(usd(costTotal.output), 12)} ${rpad(usd(costTotal.cacheWrite), 13)} ${rpad(usd(costTotal.cacheRead), 13)} ${rpad(usd(costTotal.total), 13)}`);
    if (anyIntro) console.log(`  * Sonnet 5 introductory pricing (through 2026-08-31) applied.`);
    if (unpriced.length) console.log(`  Unpriced (local / non-Anthropic, excluded from total): ${unpriced.join(', ')}`);
    console.log(`  Note: subscription usage is not billed per-token — this is the equivalent API list cost.`);
  }

  if (args.daily) {
    console.log(`\n📅 Daily breakdown\n`);
    for (const date of sortedDates) {
      const dayTotal = Object.values(dailyGroups[date]).reduce((s, b) => s + b.input + b.output, 0);
      console.log(`${date}: ${fmt(dayTotal)} tokens`);
      const ms = Object.entries(dailyGroups[date]).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
      for (const [m, b] of ms) {
        console.log(`  ${pad(m, 32)} ${rpad(fmt(b.input + b.output), 14)}  (${b.messages} msg)`);
      }
    }
  }
  console.log();
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
