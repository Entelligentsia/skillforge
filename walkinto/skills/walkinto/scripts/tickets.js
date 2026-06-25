'use strict';
// Helpdesk ticket lifecycle. Maps to /agent-api/helpdesk/tickets/*.
//
// Authorization is enforced server-side by the token's role. "Support staff"
// means a human helpdesk operator with admin rights (the API names this role
// "agent" internally) — NOT an AI agent.
//   Owner (any token) — create/list/search/view YOUR OWN tickets.
//   Support staff (admin token) — handle ANY customer's ticket, plus reply/
//                         approve/note/update. Those subcommands 403 for a non-admin.
var req = require('./request');

// Ticket status + priority codes (Freshdesk-compatible) used by the API.
var STATUS = { open: 2, pending: 3, resolved: 4, closed: 5, waiting: 6 };
var STATUS_NAME = { 2: 'open', 3: 'pending', 4: 'resolved', 5: 'closed', 6: 'waiting' };
var PRIORITY = { low: 1, medium: 2, high: 3, urgent: 4 };
var PRIORITY_NAME = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' };

var HELP = [
  'Usage: node tickets.js <command> [options]',
  '',
  'Manage WalkInto helpdesk tickets. Status/priority accept names or numbers.',
  '  status:   open(2) pending(3) resolved(4) closed(5) waiting(6)',
  '  priority: low(1) medium(2) high(3) urgent(4)',
  '',
  'Read commands (owner sees own tickets; support staff see all):',
  '  list   [--status s] [--tag t] [--email e*] [--assignee id*]',
  '         [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit n] [--skip n] [--json]',
  '  search [--q text] [--status s] [--tag t] [--email e*] [--from d] [--to d] [--json]',
  '         (at least one filter required)',
  '  view <ticketId> [--json]      Ticket + full message thread.',
  '',
  'Owner command:',
  '  create --subject <s> --body <text> [--json]   Open a ticket as yourself.',
  '',
  'Support-staff commands (require an admin token):',
  '  reply  <ticketId> --body <text> [--confidence 0..1]',
  '         [--cite category_slug/slug ...] [--query text] [--json]',
  '         Drafts an outbound reply. Auto-sends ONLY if the gate is enabled AND',
  '         the cited KB match is strong AND confidence is high; else stays draft.',
  '  approve <ticketId> <messageId> [--json]   Send a held draft reply.',
  '  note   <ticketId> --body <text> [--json]  Add a private internal note.',
  '  update <ticketId> [--status s] [--priority p] [--assignee id|null]',
  '         [--add-tag t ...] [--remove-tag t ...] [--json]',
  '',
  '  * --email / --assignee filters apply to staff tokens only; owners are always',
  '    hard-scoped to their own tickets server-side.',
  '',
  'Examples:',
  '  node tickets.js list --status open --limit 10',
  '  node tickets.js search --q "panorama upload failing"',
  '  node tickets.js view 3f2a... ',
  '  node tickets.js create --subject "Embed not loading" --body "The iframe is blank."',
  '  node tickets.js reply 3f2a... --body "Try re-publishing." --confidence 0.9 \\',
  '       --cite getting-started/embedding-a-tour',
  '  node tickets.js update 3f2a... --status resolved --add-tag embed',
].join('\n');

// --- arg parsing -----------------------------------------------------------
function parse(argv, start) {
  var a = { _: [], cite: [], addTag: [], removeTag: [] };
  for (var i = start; i < argv.length; i++) {
    var t = argv[i];
    switch (t) {
      case '--json': a.json = true; break;
      case '--help': case '-h': a.help = true; break;
      case '--status': a.status = argv[++i]; break;
      case '--priority': a.priority = argv[++i]; break;
      case '--tag': a.tag = argv[++i]; break;
      case '--email': a.email = argv[++i]; break;
      case '--assignee': a.assignee = argv[++i]; break;
      case '--from': case '--date-from': a.from = argv[++i]; break;
      case '--to': case '--date-to': a.to = argv[++i]; break;
      case '--limit': a.limit = argv[++i]; break;
      case '--skip': a.skip = argv[++i]; break;
      case '--q': case '--query': a.q = argv[++i]; break;
      case '--subject': a.subject = argv[++i]; break;
      case '--body': a.body = argv[++i]; break;
      case '--confidence': a.confidence = argv[++i]; break;
      case '--cite': a.cite.push(argv[++i]); break;
      case '--add-tag': a.addTag.push(argv[++i]); break;
      case '--remove-tag': a.removeTag.push(argv[++i]); break;
      default:
        if (t.indexOf('--') === 0) { console.error('Unknown option: ' + t); process.exit(1); }
        a._.push(t);
    }
  }
  return a;
}

// Resolve a status/priority token (name or number) against a map.
function resolveCode(val, map, label) {
  if (val === undefined) return undefined;
  var lower = String(val).toLowerCase();
  if (map[lower] !== undefined) return map[lower];
  var n = parseInt(val, 10);
  if (Object.keys(map).map(function(k) { return map[k]; }).indexOf(n) !== -1) return n;
  console.error('Invalid ' + label + ': ' + val);
  process.exit(1);
}

// --- formatting ------------------------------------------------------------
function ticketLine(t) {
  var st = STATUS_NAME[t.status] || t.status;
  var pr = PRIORITY_NAME[t.priority] || t.priority || '-';
  var id = t.display_id ? ('#' + t.display_id) : (t.id || '').slice(0, 8);
  return id + '  [' + st + '/' + pr + ']  ' + (t.subject || '(no subject)') +
    (t.contact_email ? '  <' + t.contact_email + '>' : '');
}

function printList(data, json) {
  if (json) { console.log(JSON.stringify(data, null, 2)); return; }
  var items = (data && data.items) || [];
  if (!items.length) { console.log('No tickets found.'); return; }
  items.forEach(function(t) { console.log(ticketLine(t)); });
  var total = (data && data.total != null) ? data.total : items.length;
  console.log('\n' + items.length + ' shown of ' + total + ' total.');
  console.log('Use: node tickets.js view <id>   (id = ' + (items[0].id || '...') + ')');
}

function printTicket(t, json) {
  if (json) { console.log(JSON.stringify(t, null, 2)); return; }
  console.log('Ticket ' + (t.display_id ? '#' + t.display_id : t.id));
  console.log('  subject:  ' + t.subject);
  console.log('  status:   ' + (STATUS_NAME[t.status] || t.status) +
    '   priority: ' + (PRIORITY_NAME[t.priority] || t.priority));
  console.log('  contact:  ' + (t.contact_email || '-'));
  if (t.tags && t.tags.length) console.log('  tags:     ' + t.tags.join(', '));
  if (t.assignee_id) console.log('  assignee: ' + t.assignee_id);
  console.log('  created:  ' + t.created_at);
  if (t.description) console.log('\n  ' + String(t.description).replace(/\n/g, '\n  '));
  var thread = t.thread || [];
  console.log('\n--- thread (' + thread.length + ' message(s)) ---');
  thread.forEach(function(m) {
    var who = m.author_type || (m.private ? 'note' : 'msg');
    var tag = (m.kind === 'note' ? 'NOTE' : 'reply') + (m.state === 'draft' ? ' DRAFT' : '');
    console.log('\n[' + tag + '] ' + who + '  ' + (m.created_at || '') + '  id=' + m.id);
    console.log('  ' + String(m.body || '').replace(/\n/g, '\n  '));
  });
}

// --- commands --------------------------------------------------------------
function list(a) {
  return req.request({
    path: '/agent-api/helpdesk/tickets',
    query: {
      status: resolveCode(a.status, STATUS, 'status'),
      tag: a.tag, email: a.email, assignee_id: a.assignee,
      date_from: a.from, date_to: a.to, limit: a.limit, skip: a.skip
    }
  }).then(function(res) { printList(req.unwrap(res), a.json); });
}

function search(a) {
  if (!a.q && !a.email && !a.tag && a.status === undefined && !a.from && !a.to) {
    console.error('search requires at least one filter (--q, --email, --tag, --status, --from, --to)');
    process.exit(1);
  }
  return req.request({
    path: '/agent-api/helpdesk/tickets/search',
    query: {
      q: a.q, email: a.email, tag: a.tag,
      status: resolveCode(a.status, STATUS, 'status'), date_from: a.from, date_to: a.to
    }
  }).then(function(res) { printList(req.unwrap(res), a.json); });
}

function view(a) {
  var id = a._[0];
  if (!id) { console.error('view requires <ticketId>'); process.exit(1); }
  return req.request({ path: '/agent-api/helpdesk/tickets/' + encodeURIComponent(id) })
    .then(function(res) { printTicket(req.unwrap(res), a.json); });
}

function create(a) {
  if (!a.subject || !a.body) { console.error('create requires --subject and --body'); process.exit(1); }
  return req.request({
    method: 'POST', path: '/agent-api/helpdesk/tickets',
    body: { subject: a.subject, body: a.body }
  }).then(function(res) {
    var t = req.unwrap(res);
    if (a.json) { console.log(JSON.stringify(t, null, 2)); return; }
    console.log('Created ticket ' + (t.display_id ? '#' + t.display_id : t.id));
    console.log(ticketLine(t));
  });
}

function reply(a) {
  var id = a._[0];
  if (!id || !a.body) { console.error('reply requires <ticketId> --body <text>'); process.exit(1); }
  // --cite values are "category_slug/slug" pairs.
  var citations = a.cite.map(function(c) {
    var parts = String(c).split('/');
    return { category_slug: parts[0], slug: parts.slice(1).join('/') };
  });
  return req.request({
    method: 'POST', path: '/agent-api/helpdesk/tickets/' + encodeURIComponent(id) + '/reply',
    body: {
      body: a.body,
      confidence: a.confidence !== undefined ? Number(a.confidence) : undefined,
      citations: citations.length ? citations : undefined,
      query: a.q
    }
  }).then(function(res) {
    var m = req.unwrap(res);
    if (a.json) { console.log(JSON.stringify(m, null, 2)); return; }
    var g = m.grounding || {};
    var decision = g.decision || (m.state === 'draft' ? 'draft' : m.state);
    console.log('Reply ' + decision + ' (message id=' + m.id + ', state=' + m.state + ')');
    if (g.reason) console.log('  gate: ' + g.reason +
      '  [match=' + g.match_strength + ' confidence=' + g.confidence + ']');
    if (m.state === 'draft') {
      console.log('  Held as draft. Send it with:');
      console.log('    node tickets.js approve ' + id + ' ' + m.id);
    }
  });
}

function approve(a) {
  var id = a._[0], msg = a._[1];
  if (!id || !msg) { console.error('approve requires <ticketId> <messageId>'); process.exit(1); }
  return req.request({
    method: 'POST',
    path: '/agent-api/helpdesk/tickets/' + encodeURIComponent(id) +
      '/messages/' + encodeURIComponent(msg) + '/approve'
  }).then(function(res) {
    var m = req.unwrap(res);
    if (a.json) { console.log(JSON.stringify(m, null, 2)); return; }
    console.log('Sent. Message ' + m.id + ' is now ' + (m.state || 'sent') + '.');
  });
}

function note(a) {
  var id = a._[0];
  if (!id || !a.body) { console.error('note requires <ticketId> --body <text>'); process.exit(1); }
  return req.request({
    method: 'POST', path: '/agent-api/helpdesk/tickets/' + encodeURIComponent(id) + '/note',
    body: { body: a.body }
  }).then(function(res) {
    var m = req.unwrap(res);
    if (a.json) { console.log(JSON.stringify(m, null, 2)); return; }
    console.log('Private note added (id=' + m.id + ').');
  });
}

function update(a) {
  var id = a._[0];
  if (!id) { console.error('update requires <ticketId>'); process.exit(1); }
  var body = {};
  if (a.status !== undefined)   body.status = resolveCode(a.status, STATUS, 'status');
  if (a.priority !== undefined) body.priority = resolveCode(a.priority, PRIORITY, 'priority');
  if (a.assignee !== undefined) body.assignee_id = (a.assignee === 'null') ? null : a.assignee;
  if (a.addTag.length)    body.add_tags = a.addTag;
  if (a.removeTag.length) body.remove_tags = a.removeTag;
  if (!Object.keys(body).length) {
    console.error('update requires at least one of --status --priority --assignee --add-tag --remove-tag');
    process.exit(1);
  }
  return req.request({
    method: 'PATCH', path: '/agent-api/helpdesk/tickets/' + encodeURIComponent(id) + '/update',
    body: body
  }).then(function(res) {
    var d = req.unwrap(res);
    if (a.json) { console.log(JSON.stringify(d, null, 2)); return; }
    console.log('Updated ticket ' + (d.id || id) + ': ' + JSON.stringify(d));
  });
}

var COMMANDS = {
  list: list, search: search, view: view, create: create,
  reply: reply, approve: approve, note: note, update: update
};

function main() {
  var cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  var fn = COMMANDS[cmd];
  if (!fn) {
    console.error('Unknown command: ' + cmd);
    console.error('Run with --help for usage.');
    process.exit(1);
  }
  var args = parse(process.argv, 3);
  if (args.help) { console.log(HELP); return; }
  fn(args).catch(req.fatal);
}

if (require.main === module) main();
