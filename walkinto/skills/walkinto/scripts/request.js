'use strict';
// Shared HTTP helper for the WalkInto agent-api scripts. The auth/tours scripts
// each open their own connection; the helpdesk surface has enough endpoints
// (KB + ticket lifecycle) that one boring request function is clearer than
// repeating the same plumbing six times.
var config = require('./config');

/**
 * Make an authenticated agent-api request.
 *
 * @param {object} opts
 * @param {string} opts.path      Path beginning with '/agent-api/...'
 * @param {string} [opts.method]  HTTP method (default GET)
 * @param {object} [opts.query]   Query params; undefined/null values skipped
 * @param {object} [opts.body]    JSON body for POST/PATCH
 * @returns {Promise<{status:number, body:string, json:*}>}
 */
exports.request = function(opts) {
  return new Promise(function(resolve, reject) {
    var token = config.getToken();
    if (!token) {
      reject(new NotLoggedInError());
      return;
    }

    var url = new URL(opts.path, config.baseUrl);
    if (opts.query) {
      Object.keys(opts.query).forEach(function(k) {
        var v = opts.query[k];
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, v);
        }
      });
    }

    var payload = opts.body ? JSON.stringify(opts.body) : null;
    var headers = { 'Authorization': 'Bearer ' + token };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    var mod = url.protocol === 'https:' ? require('https') : require('http');
    var req = mod.request(url.toString(), {
      method: opts.method || 'GET',
      headers: headers
    }, function(res) {
      var raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        var parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { /* leave null */ }
        resolve({ status: res.statusCode, body: raw, json: parsed });
      });
    });
    req.on('error', function(err) { reject(err); });
    if (payload) { req.write(payload); }
    req.end();
  });
};

function NotLoggedInError() {
  this.name = 'NotLoggedInError';
  this.message = 'Not logged in. Run the login script first.';
}
NotLoggedInError.prototype = Object.create(Error.prototype);
exports.NotLoggedInError = NotLoggedInError;

/**
 * Standard exit handling for a resolved response. Prints the error envelope and
 * exits non-zero on failure; otherwise returns the parsed `data` payload (the
 * helpdesk routes wrap success as { ok:true, data:... }).
 *
 * @param {{status:number, body:string, json:*}} res
 * @returns {*} the data payload on success
 */
exports.unwrap = function(res) {
  if (res.status === 401) {
    console.error('Token expired or revoked. Run the login script first.');
    process.exit(1);
  }
  if (res.status === 403) {
    var msg403 = res.json && res.json.error ? res.json.error : 'Forbidden';
    console.error('Not permitted: ' + msg403);
    console.error('(Support-staff endpoints require a helpdesk admin token.)');
    process.exit(1);
  }
  if (res.status >= 400) {
    var msg = res.json && res.json.error ? res.json.error : res.body;
    console.error('Error ' + res.status + ': ' + msg);
    process.exit(1);
  }
  // Helpdesk routes envelope as { ok, data }; tolerate bare JSON too.
  if (res.json && Object.prototype.hasOwnProperty.call(res.json, 'data')) {
    return res.json.data;
  }
  return res.json;
};

/** Print a fatal error from a rejected request promise and exit. */
exports.fatal = function(err) {
  if (err instanceof NotLoggedInError) {
    console.error(err.message);
  } else {
    console.error('Connection error: ' + (err && err.message ? err.message : err));
  }
  process.exit(1);
};
