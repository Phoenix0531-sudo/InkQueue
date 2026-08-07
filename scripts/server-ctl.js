#!/usr/bin/env node
'use strict';

/**
 * InkQueue reference server process helper.
 * Usage:
 *   node scripts/server-ctl.js start|stop|restart|status
 *   node scripts/server-ctl.js install     # Windows: logon auto-start Scheduled Task
 *   node scripts/server-ctl.js uninstall   # remove that task
 *
 * Works on Windows (taskkill/netstat) and POSIX (kill/lsof-free port scan via netstat-like).
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PID_FILE = path.join(SERVER_DIR, 'data', 'server.pid');
const LOG_FILE = path.join(SERVER_DIR, 'data', 'server.log');
const PORT = Number(process.env.INKQUEUE_PORT || 8787);
// Do NOT read generic process.env.PORT — Hermes / other tools often set PORT to unrelated values (e.g. 8748).
const IS_WIN = process.platform === 'win32';

function ensureDataDir() {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
}

// Truncate-on-restart: if server.log exceeds LOG_MAX_BYTES, archive to
// LOG_FILE.1 (overwriting previous rotate) and start fresh. Prevents the
// unbounded growth problem on long-running Windows boxes where the daemon
// can run for days and the log only ever appended.
const LOG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap
function rotateLogIfLarge() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size >= LOG_MAX_BYTES) {
      const archive = LOG_FILE + '.1';
      try { fs.copyFileSync(LOG_FILE, archive); } catch {}
      fs.truncateSync(LOG_FILE, 0);
      console.log(`[server-ctl] log rotated (${(st.size / 1024).toFixed(0)} KB → archive ${path.basename(archive)})`);
    }
  } catch {
    // log file does not exist yet — nothing to rotate
  }
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(pid) {
  ensureDataDir();
  fs.writeFileSync(PID_FILE, String(pid) + '\n', 'utf8');
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findListenersOnPort(port) {
  const pids = new Set();
  try {
    if (IS_WIN) {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        if (line.includes(':' + port) && /LISTENING/i.test(line)) {
          const parts = line.trim().split(/\s+/);
          const pid = Number(parts[parts.length - 1]);
          if (pid > 0) pids.add(pid);
        }
      }
    } else {
      try {
        const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
        for (const line of out.split(/\n/)) {
          const pid = Number(line.trim());
          if (pid > 0) pids.add(pid);
        }
      } catch {
        // lsof missing — ignore
      }
    }
  } catch (e) {
    console.error('port scan failed:', e.message);
  }
  return [...pids];
}

function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      // MSYS / git-bash mangles //F as a path. Use cmd /c explicitly.
      const cmd = process.env.ComSpec || 'cmd.exe';
      execSync(`"${cmd}" /c taskkill /F /PID ${pid}`, { stdio: 'ignore', shell: false });
    } else {
      process.kill(pid, 'SIGTERM');
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  } catch {
    // already gone
  }
}

function stop() {
  const fromFile = readPid();
  const fromPort = findListenersOnPort(PORT);
  const all = new Set([...(fromFile ? [fromFile] : []), ...fromPort]);
  if (all.size === 0) {
    console.log(`no InkQueue server on :${PORT}`);
    clearPid();
    return;
  }
  for (const pid of all) {
    console.log(`stopping pid ${pid}`);
    killPid(pid);
  }
  clearPid();
  // brief settle
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (findListenersOnPort(PORT).length === 0) break;
    try { execSync(IS_WIN ? 'timeout /t 1 /nobreak >nul' : 'sleep 0.2'); } catch {}
  }
  console.log('stopped');
}

function start() {
  const existing = findListenersOnPort(PORT);
  if (existing.length) {
    console.log(`already listening on :${PORT} (pid ${existing.join(',')})`);
    if (!readPid()) writePid(existing[0]);
    return;
  }
  ensureDataDir();
  rotateLogIfLarge();
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: SERVER_DIR,
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env
  });
  child.unref();
  writePid(child.pid);
  console.log(`started pid ${child.pid} on :${PORT}`);
  console.log(`log: ${LOG_FILE}`);
}

function status() {
  const pid = readPid();
  const listeners = findListenersOnPort(PORT);
  console.log(JSON.stringify({
    port: PORT,
    pid_file: pid,
    pid_alive: isPidAlive(pid),
    listeners,
    running: listeners.length > 0
  }, null, 2));
}

function restart() {
  stop();
  start();
}

const TASK_NAME = 'InkQueueServer';

function installAutostart() {
  if (!IS_WIN) {
    console.error('install currently supports Windows Scheduled Task only');
    console.error('On Linux/macOS use systemd/launchd pointing at: node scripts/server-ctl.js start');
    process.exit(1);
  }
  const nodePath = process.execPath;
  const scriptPath = path.join(ROOT, 'scripts', 'server-ctl.js');
  const wrapper = path.join(SERVER_DIR, 'data', 'autostart-server.cmd');
  ensureDataDir();
  // Simple .cmd avoids schtasks quoting hell with spaces in paths.
  const body =
    '@echo off\r\n' +
    'REM Auto-generated by server-ctl install — starts InkQueue reference server\r\n' +
    '"' + nodePath + '" "' + scriptPath + '" start\r\n';
  fs.writeFileSync(wrapper, body, 'utf8');
  try {
    execSync('schtasks /Delete /TN "' + TASK_NAME + '" /F', { stdio: 'ignore', shell: true });
  } catch {}
  const create =
    'schtasks /Create /TN "' + TASK_NAME + '" /SC ONLOGON /RL LIMITED /TR "' + wrapper + '" /F';
  try {
    execSync(create, { stdio: 'inherit', shell: true });
    console.log('installed Scheduled Task "' + TASK_NAME + '" (ONLOGON)');
    console.log('wrapper: ' + wrapper);
    console.log('Tip: schtasks /Run /TN InkQueueServer');
  } catch (e) {
    console.error('schtasks failed:', e.message);
    console.error('Wrapper written to:', wrapper);
    console.error('Create ONLOGON task manually pointing at that .cmd');
    process.exit(1);
  }
}

function uninstallAutostart() {
  if (!IS_WIN) {
    console.error('uninstall is Windows-only (schtasks)');
    process.exit(1);
  }
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'inherit', shell: true });
    console.log(`removed Scheduled Task "${TASK_NAME}"`);
  } catch (e) {
    console.error('remove failed (maybe not installed):', e.message);
    process.exit(1);
  }
}

const cmd = (process.argv[2] || 'status').toLowerCase();
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else if (cmd === 'restart') restart();
else if (cmd === 'status') status();
else if (cmd === 'install') installAutostart();
else if (cmd === 'uninstall') uninstallAutostart();
else {
  console.error('usage: node scripts/server-ctl.js <start|stop|restart|status|install|uninstall>');
  process.exit(1);
}
