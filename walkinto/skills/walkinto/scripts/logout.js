'use strict';
var config = require('./config');

// Revoke the token server-side before deleting the local copy, so a logged-out
// token can never authenticate again. Best-effort: if the network call fails we
// still drop the local token (the user asked to log out), but we report it so a
// still-live token isn't silently left behind.
function revokeRemote(token, done) {
  if (!token) return done(null);
  var url = new URL('/agent-api/logout', config.baseUrl);
  var mod = url.protocol === 'https:' ? require('https') : require('http');
  var req = mod.request(url.toString(), {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token }
  }, function(res) {
    res.resume();
    done(res.statusCode === 200 ? null : new Error('server returned ' + res.statusCode));
  });
  req.on('error', function(err) { done(err); });
  req.end();
}

var token = config.getToken();
revokeRemote(token, function(err) {
  config.deleteToken();
  if (err) {
    console.log('Logged out locally. Note: could not revoke the token on the server (' + err.message + ').');
  } else {
    console.log('Logged out.');
  }
});
