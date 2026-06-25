'use strict';
var config = require('./config');

var HELP = [
  'Usage: node tours.js [options]',
  '',
  'Search your WalkInto tours by name, state, and date range.',
  '',
  'Options:',
  '  --name <text>           Search tour names (case-insensitive substring match)',
  '  --state <draft|published>  Filter by tour state',
  '  --created-after <date>  Tours created on or after this date (YYYY-MM-DD)',
  '  --created-before <date> Tours created on or before this date (YYYY-MM-DD)',
  '  --sort <name|date>      Sort by name or creation date (default: date)',
  '  --order <asc|desc>      Sort order (default: desc, newest first)',
  '  --limit <n>             Max results, 1-100 (default: 20)',
  '  --json                  Output raw JSON (default: formatted table)',
  '  --help                  Show this help',
  '',
  'Examples:',
  '  node tours.js                          List 20 most recent tours',
  '  node tours.js --name "office"          Search tours with "office" in the name',
  '  node tours.js --state published        List published tours only',
  '  node tours.js --created-after 2025-01-01 --limit 50',
  '  node tours.js --sort name --order asc  Alphabetical listing',
].join('\n');

function parseArgs(argv) {
  var args = {};
  for (var i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': args.help = true; break;
      case '--json': args.json = true; break;
      case '--name': args.name = argv[++i]; break;
      case '--state': args.state = argv[++i]; break;
      case '--created-after': args.createdAfter = argv[++i]; break;
      case '--created-before': args.createdBefore = argv[++i]; break;
      case '--sort': args.sort = argv[++i]; break;
      case '--order': args.order = argv[++i]; break;
      case '--limit': args.limit = argv[++i]; break;
      default:
        console.error('Unknown option: ' + argv[i]);
        console.error('Run with --help for usage.');
        process.exit(1);
    }
  }
  return args;
}

function formatTable(tours) {
  if (tours.length === 0) {
    console.log('No tours found.');
    return;
  }
  var nameWidth = Math.min(Math.max.apply(null, tours.map(function(t) { return (t.name || '').length; })), 40);
  nameWidth = Math.max(nameWidth, 4);

  console.log(pad('Name', nameWidth) + '  ' + pad('State', 9) + '  ' + pad('Views', 6) + '  ' + pad('Created', 10) + '  ID');
  console.log(repeat('-', nameWidth) + '  ' + repeat('-', 9) + '  ' + repeat('-', 6) + '  ' + repeat('-', 10) + '  ' + repeat('-', 36));

  tours.forEach(function(t) {
    var name = (t.name || 'Untitled').substring(0, nameWidth);
    var date = t.createdDate ? new Date(t.createdDate).toISOString().slice(0, 10) : 'unknown';
    var views = String(t.views || 0);
    console.log(pad(name, nameWidth) + '  ' + pad(t.state || '-', 9) + '  ' + pad(views, 6) + '  ' + date + '  ' + t.id);
  });

  console.log('\n' + tours.length + ' tour(s)');
}

function pad(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

function repeat(ch, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += ch;
  return s;
}

exports.run = function(args) {
  if (!args) args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  var token = config.getToken();
  if (!token) {
    console.error('Not logged in. Run the login script first.');
    process.exit(1);
    return;
  }

  var url = new URL('/agent-api/tours', config.baseUrl);
  if (args.name) url.searchParams.set('name', args.name);
  if (args.state) url.searchParams.set('state', args.state);
  if (args.createdAfter) url.searchParams.set('created_after', args.createdAfter);
  if (args.createdBefore) url.searchParams.set('created_before', args.createdBefore);
  if (args.sort) url.searchParams.set('sort', args.sort);
  if (args.order) url.searchParams.set('order', args.order);
  if (args.limit) url.searchParams.set('limit', args.limit);

  var mod = url.protocol === 'https:' ? require('https') : require('http');

  mod.get(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token }
  }, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      if (res.statusCode === 200) {
        if (args.json) { console.log(body); return; }
        try {
          var data = JSON.parse(body);
          formatTable(data.tours);
        } catch (e) {
          console.log(body);
        }
        return;
      }
      if (res.statusCode === 401) {
        console.error('Token expired or revoked. Run the login script first.');
        process.exit(1);
        return;
      }
      console.error('Error:', res.statusCode, body);
      process.exit(1);
    });
  }).on('error', function(err) {
    console.error('Connection error:', err.message);
    process.exit(1);
  });
};

if (require.main === module) exports.run();
