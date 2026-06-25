'use strict';
var config = require('./config');

exports.run = function() {
  var token = config.getToken();
  if (!token) {
    console.error('Not logged in. Run the login script first.');
    process.exit(1);
    return;
  }
  var url = new URL('/agent-api/whoami', config.baseUrl);
  var mod = url.protocol === 'https:' ? require('https') : require('http');
  mod.get(url.toString(), {
    headers: { 'Authorization': 'Bearer ' + token }
  }, function(res) {
    var body = '';
    res.on('data', function(chunk) { body += chunk; });
    res.on('end', function() {
      if (res.statusCode === 200) { console.log(body); return; }
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
