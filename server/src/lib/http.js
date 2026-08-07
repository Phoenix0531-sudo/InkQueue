'use strict';

// Minimal HTTP helpers: JSON response, body reader, token gate.
// Token rotation: TOKEN (current) and TOKEN_PREV (grace window) both accepted.

const { HttpError } = require('./task');

function sendJson(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body, null, 2));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': encoded.length,
    'Cache-Control': 'no-store'
  });
  res.end(encoded);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let failed = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (failed) return;
      body += chunk;
      if (body.length > 1024 * 1024) {
        failed = true;
        reject(new HttpError(413, 'request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (failed) return;
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch (err) { reject(new HttpError(400, 'invalid json')); }
    });
    req.on('error', (err) => { if (!failed) reject(err); });
  });
}

function tokenMatches(value, TOKEN, TOKEN_PREV) {
  if (!value) return false;
  if (value === TOKEN) return true;
  if (TOKEN_PREV && value === TOKEN_PREV) return true;
  return false;
}

function hasToken(req, TOKEN, TOKEN_PREV) {
  return tokenMatches(req.headers['x-inkqueue-token'], TOKEN, TOKEN_PREV);
}

function tokenFromQuery(url) {
  return url.searchParams.get('token') || url.searchParams.get('inkqueue_token') || '';
}

function hasTokenOrQuery(req, url, TOKEN, TOKEN_PREV) {
  return hasToken(req, TOKEN, TOKEN_PREV) || tokenMatches(tokenFromQuery(url), TOKEN, TOKEN_PREV);
}

module.exports = {
  sendJson, readBody, tokenMatches,
  hasToken, tokenFromQuery, hasTokenOrQuery
};
