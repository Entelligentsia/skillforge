'use strict';
// Knowledge Base tools — search published articles and read one in full.
// Maps to GET /agent-api/helpdesk/kb/search and
// GET /agent-api/helpdesk/kb/articles/:category/:slug. Available to any token.
var req = require('./request');

var HELP = [
  'Usage: node kb.js <command> [options]',
  '',
  'Search and read the WalkInto helpdesk Knowledge Base.',
  '',
  'Commands:',
  '  search --q <text> [--limit n] [--json]',
  '      Ranked KB articles for a query. Each result carries a match_strength',
  '      (0..1) — the same normalized strength the auto-send gate recomputes',
  '      server-side, so you can judge how well a reply would be grounded.',
  '',
  '  read <category> <slug> [--json]',
  '      Read one published article. category and slug come straight from a',
  '      search result (category_slug / slug). Returns the article markdown',
  '      (best for grounding/quoting) plus rendered HTML and metadata.',
  '',
  'Examples:',
  '  node kb.js search --q "embed a tour on my website"',
  '  node kb.js search --q "refund policy" --limit 5 --json',
  '  node kb.js read getting-started embedding-a-tour',
].join('\n');

function parseFlags(argv, start) {
  var a = { _: [] };
  for (var i = start; i < argv.length; i++) {
    switch (argv[i]) {
      case '--json': a.json = true; break;
      case '--q': case '--query': a.q = argv[++i]; break;
      case '--limit': a.limit = argv[++i]; break;
      case '--help': case '-h': a.help = true; break;
      default:
        if (argv[i].indexOf('--') === 0) {
          console.error('Unknown option: ' + argv[i]);
          process.exit(1);
        }
        a._.push(argv[i]);
    }
  }
  return a;
}

function search(args) {
  if (!args.q) { console.error('search requires --q <text>'); process.exit(1); }
  return req.request({
    path: '/agent-api/helpdesk/kb/search',
    query: { q: args.q, limit: args.limit }
  }).then(function(res) {
    var data = req.unwrap(res);
    if (args.json) { console.log(JSON.stringify(data, null, 2)); return; }
    var items = (data && data.items) || [];
    if (items.length === 0) { console.log('No articles found for: ' + args.q); return; }
    console.log('KB results for "' + (data.query || args.q) + '" (' + items.length + '):\n');
    items.forEach(function(it) {
      var strength = (it.match_strength != null) ? it.match_strength.toFixed(2) : '?';
      console.log('  [' + strength + ']  ' + it.title);
      console.log('         ' + it.category_slug + '/' + it.slug);
      if (it.excerpt) console.log('         ' + it.excerpt);
      if (it.url) console.log('         ' + it.url);
      console.log('');
    });
    console.log('match_strength 0..1 — higher means a reply citing this is better grounded.');
  });
}

function read(args) {
  var category = args._[0];
  var slug = args._[1];
  if (!category || !slug) {
    console.error('read requires <category> <slug> (from a search result)');
    process.exit(1);
  }
  return req.request({
    path: '/agent-api/helpdesk/kb/articles/' +
      encodeURIComponent(category) + '/' + encodeURIComponent(slug)
  }).then(function(res) {
    var data = req.unwrap(res);
    if (args.json) { console.log(JSON.stringify(data, null, 2)); return; }
    console.log('# ' + (data.title || slug));
    console.log('category: ' + (data.category || category) + '   slug: ' + slug);
    if (data.summary) console.log('summary:  ' + data.summary);
    if (data.tags && data.tags.length) console.log('tags:     ' + data.tags.join(', '));
    if (data.updated_at) console.log('updated:  ' + data.updated_at);
    console.log('\n---\n');
    console.log(data.markdown || '(no body)');
  });
}

function main() {
  var argv = process.argv;
  var cmd = argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }

  var args = parseFlags(argv, 3);
  if (args.help) { console.log(HELP); return; }

  var run;
  if (cmd === 'search') { run = search(args); }
  else if (cmd === 'read') { run = read(args); }
  else {
    console.error('Unknown command: ' + cmd);
    console.error('Run with --help for usage.');
    process.exit(1);
  }
  run.catch(req.fatal);
}

if (require.main === module) main();
