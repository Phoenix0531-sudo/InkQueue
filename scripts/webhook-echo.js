#!/usr/bin/env node
'use strict';
/**
 * Tiny local sink for InkQueue outbound device events.
 * Usage: node scripts/webhook-echo.js [port]
 * Then set server/data/config.json agent_webhook_url to the printed URL.
 */
const http = require('http');
const port = Number(process.argv[2] || 8799);
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const ts = new Date().toISOString();
    console.log('----', ts, req.method, req.url);
    try {
      console.log(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      console.log(raw);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(port, '0.0.0.0', () => {
  console.log('InkQueue webhook echo listening');
  console.log('Set agent_webhook_url to: http://127.0.0.1:' + port + '/inkqueue-event');
});
