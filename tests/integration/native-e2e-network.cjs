// Child-process-only fence: the real native host may connect to loopback only.
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const log = process.env.AMAZONOPS_NETWORK_EVIDENCE;
function check(host, layer) {
  host = String(host || 'localhost').replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (log) fs.appendFileSync(log, JSON.stringify({ layer, host, allowed }) + '\n');
  if (!allowed) throw new Error('E2E_EXTERNAL_NETWORK_FORBIDDEN');
}
const fetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  check(url.hostname, 'fetch');
  return fetch.call(this, input, init);
};
for (const api of [http, https]) for (const method of ['request', 'get']) {
  const original = api[method];
  api[method] = function(input, ...rest) {
    const target = typeof input === 'string' || input instanceof URL ? new URL(input) : input;
    check(target.hostname || target.host || 'localhost', 'http');
    return original.call(this, input, ...rest);
  };
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof input === 'number') check(typeof args[1] === 'string' ? args[1] : 'localhost', 'socket');
  else if (input && typeof input === 'object' && !input.path) check(input.host || input.hostname || 'localhost', 'socket');
  return connect.apply(this, args);
};
