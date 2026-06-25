'use strict';
var crypto = require('crypto');
var config = require('./config');

function openBrowser(url) {
  var cmd;
  switch (process.platform) {
    case 'darwin': cmd = 'open'; break;
    case 'win32': cmd = 'start'; break;
    default: cmd = 'xdg-open';
  }
  require('child_process').exec(cmd + ' "' + url + '"');
}

function confirmUrl(code) {
  return config.baseUrl + '/agent-auth/confirm?code=' + code;
}

function pollForToken(code, attempts) {
  if (attempts <= 0) {
    console.error('Login timed out. Please try again.');
    process.exit(1);
    return;
  }
  var url = new URL('/agent-api/auth/token', config.baseUrl);
  url.searchParams.set('code', code);
  var mod = url.protocol === 'https:' ? require('https') : require('http');
  mod.get(url.toString(), function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      if (res.statusCode === 200) {
        try {
          var data = JSON.parse(body);
          config.saveToken(data.token);
          config.deletePendingCode();
          console.log('Login successful!');
          require('./whoami').run();
        } catch (e) {
          console.error('Failed to parse response.');
          process.exit(1);
        }
        return;
      }
      setTimeout(function() { pollForToken(code, attempts - 1); }, 3000);
    });
  }).on('error', function(err) {
    console.error('Connection error:', err.message);
    setTimeout(function() { pollForToken(code, attempts - 1); }, 5000);
  });
}

// Step 1 — assistant-safe: print the approval link and remember the pending code.
// No browser launch, no network poll, no token write, so auto-mode won't block it.
exports.begin = function() {
  var code = crypto.randomBytes(20).toString('hex');
  config.savePendingCode(code);
  console.log('Click this link to sign in to WalkInto, then click Approve:');
  console.log('');
  console.log('  ' + confirmUrl(code));
  console.log('');
  console.log("Once you've approved in the browser, run: login.js complete");
};

// Step 2 — exchange the approved code for a token and save it.
exports.complete = function() {
  var code = config.getPendingCode();
  if (!code) {
    console.error("No pending login. Run 'login.js begin' first.");
    process.exit(1);
    return;
  }
  console.log('Waiting for approval...');
  pollForToken(code, 100);
};

// Default — one-shot interactive flow: open the browser, then poll. Backward compatible.
exports.run = function() {
  var code = crypto.randomBytes(20).toString('hex');
  config.savePendingCode(code);
  var url = confirmUrl(code);
  console.log('Opening browser to authorize...');
  console.log(url);
  console.log('');
  console.log('Waiting for approval...');
  openBrowser(url);
  pollForToken(code, 100);
};

if (require.main === module) {
  var arg = process.argv[2];
  if (arg === 'begin') exports.begin();
  else if (arg === 'complete') exports.complete();
  else exports.run();
}
