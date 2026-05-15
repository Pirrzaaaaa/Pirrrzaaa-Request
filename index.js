/**
 * index.js — BlackRose Auto-Restart Manager
 * Features:
 *  - Auto restart on crash with exponential backoff
 *  - RAM usage monitor (auto restart jika melebihi threshold)
 *  - Uptime tracking + IPC channel
 *  - Graceful shutdown (SIGINT/SIGTERM)
 *  - Crash counter & log
 *  - Child process health check
 */

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ===== Configuration =====
const CONFIG = {
  mainFile       : path.join(__dirname, 'main.js'),
  maxRestarts    : 50,          // maks restart sebelum give up
  baseDelay      : 2000,        // delay awal (ms)
  maxDelay       : 30000,       // delay maksimal (ms)
  memThreshold   : 512,         // MB — restart jika melebihi ini
  memCheckInterval: 60000,      // cek RAM tiap 60 detik
  healthInterval : 30000,       // health check tiap 30 detik
  logFile        : path.join(__dirname, 'crash.log')
};

// ===== State =====
let child        = null;
let restartCount = 0;
let startTime    = Date.now();
let isShuttingDown = false;
let memTimer     = null;
let healthTimer  = null;

// ===== Utilities =====
const color = {
  reset  : '\x1b[0m',
  red    : '\x1b[31m',
  green  : '\x1b[32m',
  yellow : '\x1b[33m',
  magenta: '\x1b[35m',
  cyan   : '\x1b[36m',
  gray   : '\x1b[90m',
  bold   : '\x1b[1m'
};

function log(level, msg) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const prefix = {
    info : `${color.cyan}[INFO]${color.reset}`,
    warn : `${color.yellow}[WARN]${color.reset}`,
    error: `${color.red}[ERROR]${color.reset}`,
    ok   : `${color.green}[OK]${color.reset}`,
    sys  : `${color.magenta}[SYS]${color.reset}`
  };
  console.log(`${color.gray}${time}${color.reset} ${prefix[level] || prefix.info} ${msg}`);
}

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function getDelay() {
  // Exponential backoff with cap
  const delay = Math.min(CONFIG.baseDelay * Math.pow(1.5, restartCount), CONFIG.maxDelay);
  return Math.floor(delay);
}

function logCrash(code, signal) {
  const entry = `[${new Date().toISOString()}] Exit code=${code} signal=${signal} restart=#${restartCount}\n`;
  try {
    fs.appendFileSync(CONFIG.logFile, entry);
  } catch (_) {}
}

// ===== Banner =====
function printBanner() {
  console.log(`
${color.magenta}${color.bold}╔══════════════════════════════════════════════╗
║       🌹 BlackRose WhatsApp Bot 🌹            ║
║          Auto-Restart Manager                 ║
╠══════════════════════════════════════════════╣
║  Node     : ${process.version.padEnd(33)}║
║  PID      : ${String(process.pid).padEnd(33)}║
║  Platform : ${process.platform.padEnd(33)}║
║  Arch     : ${process.arch.padEnd(33)}║
╚══════════════════════════════════════════════╝${color.reset}
`);
}

// ===== Memory Monitor =====
function startMemoryMonitor() {
  if (memTimer) clearInterval(memTimer);
  memTimer = setInterval(() => {
    if (!child || child.killed) return;
    try {
      // Cek memory via IPC
      child.send('mem_check');
    } catch (_) {}
  }, CONFIG.memCheckInterval);
}

// ===== Health Check =====
function startHealthCheck() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(() => {
    if (!child || child.killed) return;
    try {
      child.send('health_ping');
    } catch (_) {}
  }, CONFIG.healthInterval);
}

// ===== Start Child Process =====
function start() {
  if (isShuttingDown) return;

  if (restartCount >= CONFIG.maxRestarts) {
    log('error', `Restart limit reached (${CONFIG.maxRestarts}). Shutting down.`);
    log('error', `Check ${CONFIG.logFile} for crash history.`);
    process.exit(1);
  }

  restartCount++;
  startTime = Date.now();

  log('sys', `Booting main.js ${color.gray}(attempt #${restartCount})${color.reset}`);

  const args = [CONFIG.mainFile, ...process.argv.slice(2)];
  child = spawn(process.execPath, args, {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, BLACKROSE_RESTART_COUNT: String(restartCount) }
  });

  // ----- IPC Messages -----
  child.on('message', (msg) => {
    if (typeof msg === 'string') {
      switch (msg) {
        case 'reset':
          log('warn', 'Reset signal diterima, restarting...');
          restartCount = 0; // reset counter pada manual reset
          child.kill('SIGTERM');
          break;
        case 'uptime':
          child.send({ type: 'uptime', value: formatUptime(Date.now() - startTime), total: Date.now() - startTime });
          break;
        case 'restart_count':
          child.send({ type: 'restart_count', value: restartCount });
          break;
      }
    } else if (typeof msg === 'object') {
      // Memory report dari child
      if (msg.type === 'mem_report') {
        const mbUsed = Math.round(msg.rss / 1024 / 1024);
        if (mbUsed > CONFIG.memThreshold) {
          log('warn', `RAM usage ${mbUsed}MB exceeds ${CONFIG.memThreshold}MB threshold. Restarting...`);
          child.kill('SIGTERM');
        }
      }
    }
  });

  // ----- Exit handler -----
  child.on('exit', (code, signal) => {
    if (isShuttingDown) {
      log('sys', 'Graceful shutdown complete.');
      process.exit(0);
      return;
    }

    logCrash(code, signal);

    const uptime = formatUptime(Date.now() - startTime);
    log('error', `Process exited ${color.gray}(code=${code}, signal=${signal}, uptime=${uptime})${color.reset}`);

    // Reset counter jika proses jalan cukup lama (>5 menit) — artinya bukan crash loop
    if (Date.now() - startTime > 5 * 60 * 1000) {
      restartCount = Math.max(0, restartCount - 3);
    }

    const delay = getDelay();
    log('sys', `Restart in ${delay}ms...`);
    setTimeout(start, delay);
  });

  child.on('error', (err) => {
    log('error', `Spawn error: ${err.message}`);
  });

  startMemoryMonitor();
  startHealthCheck();
}

// ===== Graceful Shutdown =====
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('sys', `${signal} received. Graceful shutdown...`);

  if (memTimer) clearInterval(memTimer);
  if (healthTimer) clearInterval(healthTimer);

  if (child && !child.killed) {
    child.kill('SIGTERM');
    // Force kill setelah 10 detik
    setTimeout(() => {
      if (child && !child.killed) {
        log('warn', 'Force killing child process...');
        child.kill('SIGKILL');
      }
      process.exit(0);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ===== Main =====
printBanner();
start();
