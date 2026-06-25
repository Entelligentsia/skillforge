'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');

var CONFIG_DIR = path.join(os.homedir(), '.config', 'walkinto');
var TOKEN_FILE = path.join(CONFIG_DIR, 'token');
var PENDING_FILE = path.join(CONFIG_DIR, 'login-pending');

exports.baseUrl = process.env.WALKINTO_URL || 'https://walkinto.in';

exports.getToken = function() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); }
  catch (e) { return null; }
};

exports.saveToken = function(token) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
};

exports.deleteToken = function() {
  try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
};

// Pending login code: written by `login.js begin`, consumed by `login.js complete`.
// Not a credential — a one-time correlation id for the in-flight approval.
exports.savePendingCode = function(code) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PENDING_FILE, code, { mode: 0o600 });
};

exports.getPendingCode = function() {
  try { return fs.readFileSync(PENDING_FILE, 'utf8').trim(); }
  catch (e) { return null; }
};

exports.deletePendingCode = function() {
  try { fs.unlinkSync(PENDING_FILE); } catch (e) {}
};
