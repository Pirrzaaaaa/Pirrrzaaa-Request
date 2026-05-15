/**
 * index.js — BlackRose Auto-Restart Manager v2
 * 
 * Features:
 *  - Auto restart on crash with exponential backoff
 *  - RAM usage monitor (auto restart jika melebihi threshold)
 *  - Scheduled restart (setiap X jam, configurable)
 *  - Plugin count report via IPC dari child
 *  - File watcher restart (restart jika config.js / main.js berubah)
 *  - Uptime tracking + IPC channel
 *  - Graceful shutdown (SIGINT/SIGTERM)
 *  - Crash counter & log
 *  - Child process health check
 *  - Beautiful console info display
 */

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ===== Configuration =====
const CONFIG = {
  mainFile         : path.join(__dirname, 'main.js'),
  maxRestarts      : 50,
  baseDelay        : 2000,
  maxDelay         : 30000,
  memThreshold     : 512,         // MB
  memCheckInterval : 60000,
  healthInterval   : 30000,
  logFile          : path.join(__dirname, 'crash.log'),
  // File watcher — restart jika file-file ini berubah
  watchFiles       : ['config.js', 'main.js', 'handler.js'],
  // Scheduled restart (dari config.js global)
  scheduledRestartHours: 6
};

// Load global config untuk ambil setting
try {
  require('./config');
  if (global.scheduledRestartHours != null) CONFIG.scheduledRestartHours = global.scheduledRestartHours;
} catch (_) {}

// ===== State =====
let child            = null;
let restartCount     = 0;
let startTime        = Date.now();
let isShuttingDown   = false;
let memTimer         = null;
let healthTimer      = null;
let scheduledTimer   = null;
let fileWatchers     = [];
let lastPluginReport = null; // { plugins, categories, dbStats }

// ===== Colors =====
const c = {
  reset  : '\x1b[0m',
  red    : '\x1b[31m',
  green  : '\x1b[32m',
  yellow : '\x1b[33m',
  blue   : '\x1b[34m',
  magenta: '\x1b[35m',
  cyan   : '\x1b[36m',
  white  : '\x1b[37m',
  gray   : '\x1b[90m',
  bold   : '\x1b[1m',
  dim    : '\x1b[2m',
  bgRed  : '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue : '\x1b[44m',
  bgMag  : '\x1b[45m'
};

// ===== Utilities =====
function log(level, msg) {
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const icons = {
    info : `${c.cyan}ℹ${c.reset}`,
    warn : `${c.yellow}⚠${c.reset}`,
    error: `${c.red}✗${c.reset}`,
    ok   : `${c.green}✓${c.reset}`,
    sys  : `${c.magenta}⚙${c.reset}`,
    plug : `${c.blue}🧩${c.reset}`,
    timer: `${c.yellow}⏰${c.reset}`,
    file : `${c.cyan}📁${c.reset}`
  };
  console.log(`${c.gray}[${time}]${c.reset} ${icons[level] || icons.info}  ${msg}`);
}

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function getDelay() {
  const delay = Math.min(CONFIG.baseDelay * Math.pow(1.5, restartCount), CONFIG.maxDelay);
  return Math.floor(delay);
}

function logCrash(code, signal) {
  const entry = `[${new Date().toISOString()}] Exit code=${code} signal=${signal} restart=#${restartCount} uptime=${formatUptime(Date.now() - startTime)}\n`;
  try { fs.appendFileSync(CONFIG.logFile, entry); } catch (_) {}
}

// ===== Banner =====
function printBanner() {
  console.log('');
  console.log(`${c.magenta}${c.bold}  ╔══════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║                                                  ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║     ${c.red}🌹 B L A C K R O S E  —  W A  B O T 🌹${c.magenta}      ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║                                                  ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ╠══════════════════════════════════════════════════╣${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}Node.js${c.reset}    : ${c.white}${process.version.padEnd(30)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}PID${c.reset}        : ${c.white}${String(process.pid).padEnd(30)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}Platform${c.reset}   : ${c.white}${(process.platform + ' ' + process.arch).padEnd(30)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}Mode${c.reset}       : ${c.white}${(global.connectionMode || 'pairing').padEnd(30)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}Auto-Restart${c.reset}: ${c.green}${'Enabled (max ' + CONFIG.maxRestarts + 'x)'.padEnd(30)}${c.magenta}${c.bold}║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}Scheduled${c.reset}  : ${c.yellow}${'Every ' + CONFIG.scheduledRestartHours + ' hours'.padEnd(28)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}File Watch${c.reset} : ${c.green}${(global.fileWatchRestart !== false ? 'Active' : 'Disabled').padEnd(30)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ║${c.reset}  ${c.cyan}RAM Limit${c.reset}  : ${c.white}${(CONFIG.memThreshold + ' MB').padEnd(30)}${c.magenta}${c.bold}   ║${c.reset}`);
  console.log(`${c.magenta}${c.bold}  ╚══════════════════════════════════════════════════╝${c.reset}`);
  console.log('');
}

// ===== Plugin Report Display =====
function displayPluginReport(report) {
  lastPluginReport = report;
  console.log('');
  log('plug', `${c.bold}Plugin & Database Report${c.reset}`);
  console.log(`${c.gray}  ┌──────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}Total Plugins${c.reset}   : ${c.bold}${c.green}${report.pluginCount}${c.reset} loaded`);
  
  if (report.categories && Object.keys(report.categories).length > 0) {
    const cats = Object.entries(report.categories).sort((a, b) => b[1] - a[1]);
    const catStr = cats.map(([k, v]) => `${k}(${v})`).join(', ');
    console.log(`${c.gray}  │${c.reset} ${c.cyan}Categories${c.reset}     : ${c.white}${catStr}${c.reset}`);
  }

  if (report.pluginList && report.pluginList.length > 0) {
    console.log(`${c.gray}  │${c.reset} ${c.cyan}Plugin Files${c.reset}   :`);
    for (const p of report.pluginList) {
      const ext = path.extname(p);
      const icon = ext === '.mjs' ? '📦' : ext === '.cjs' ? '📋' : '📄';
      console.log(`${c.gray}  │${c.reset}   ${icon} ${c.white}${p}${c.reset}`);
    }
  }

  console.log(`${c.gray}  │${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}Database${c.reset}       : ${c.white}${report.dbType || 'SQLite'}${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}DB File${c.reset}        : ${c.white}${report.dbFile || 'database/database.sqlite'}${c.reset}`);
  
  if (report.dbStats) {
    console.log(`${c.gray}  │${c.reset} ${c.cyan}Users${c.reset}          : ${c.green}${report.dbStats.users}${c.reset}`);
    console.log(`${c.gray}  │${c.reset} ${c.cyan}Groups${c.reset}         : ${c.green}${report.dbStats.groups}${c.reset}`);
  }

  console.log(`${c.gray}  │${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}Connection${c.reset}     : ${c.white}${(global.connectionMode || 'pairing').toUpperCase()}${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}Pairing Number${c.reset} : ${c.yellow}${global.pairingNumber || '-'}${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}Prefix${c.reset}         : ${c.white}${JSON.stringify(global.prefix || ['.'])}${c.reset}`);
  console.log(`${c.gray}  │${c.reset} ${c.cyan}Auto Reload${c.reset}    : ${c.green}${global.autoReload ? 'ON' : 'OFF'}${c.reset}`);
  console.log(`${c.gray}  └──────────────────────────────────────────────┘${c.reset}`);
  console.log('');
}

// ===== Scheduled Restart =====
function startScheduledRestart() {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  const hours = CONFIG.scheduledRestartHours;
  if (!hours || hours <= 0) return;

  const ms = hours * 60 * 60 * 1000;
  log('timer', `Scheduled restart aktif: setiap ${c.bold}${hours} jam${c.reset}`);

  scheduledTimer = setInterval(() => {
    log('timer', `${c.yellow}Scheduled restart triggered (${hours} jam telah berlalu)${c.reset}`);
    if (child && !child.killed) {
      child.kill('SIGTERM');
      // restartCount di-reset karena ini bukan crash
      restartCount = 0;
    }
  }, ms);
}

// ===== File Watcher =====
function startFileWatcher() {
  if (!global.fileWatchRestart) return;

  // Bersihkan watcher lama
  for (const w of fileWatchers) { try { w.close(); } catch (_) {} }
  fileWatchers = [];

  const filesToWatch = CONFIG.watchFiles;
  let debounce = null;

  for (const file of filesToWatch) {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const watcher = fs.watch(fullPath, (event) => {
        if (event !== 'change') return;
        if (debounce) return; // debounce 2 detik
        debounce = setTimeout(() => { debounce = null; }, 2000);

        log('file', `${c.cyan}${file}${c.reset} berubah — restart child process...`);
        if (child && !child.killed) {
          restartCount = 0; // bukan crash, reset counter
          child.kill('SIGTERM');
        }
      });
      fileWatchers.push(watcher);
    } catch (_) {}
  }

  if (fileWatchers.length > 0) {
    log('file', `File watcher aktif: ${c.white}[${filesToWatch.join(', ')}]${c.reset}`);
  }
}

// ===== Memory Monitor =====
function startMemoryMonitor() {
  if (memTimer) clearInterval(memTimer);
  memTimer = setInterval(() => {
    if (!child || child.killed) return;
    try { child.send('mem_check'); } catch (_) {}
  }, CONFIG.memCheckInterval);
}

// ===== Health Check =====
function startHealthCheck() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = setInterval(() => {
    if (!child || child.killed) return;
    try { child.send('health_ping'); } catch (_) {}
  }, CONFIG.healthInterval);
}

// ===== Start Child Process =====
function start() {
  if (isShuttingDown) return;

  if (restartCount >= CONFIG.maxRestarts) {
    log('error', `Restart limit reached (${CONFIG.maxRestarts}). Shutting down.`);
    log('error', `Check ${c.white}${CONFIG.logFile}${c.reset} for crash history.`);
    process.exit(1);
  }

  restartCount++;
  startTime = Date.now();

  console.log('');
  log('sys', `${c.bold}Booting main.js${c.reset} ${c.gray}(attempt #${restartCount})${c.reset}`);
  console.log('');

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
          log('warn', 'Reset signal diterima dari child, restarting...');
          restartCount = 0;
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
      switch (msg.type) {
        case 'mem_report': {
          const mbUsed = Math.round(msg.rss / 1024 / 1024);
          if (mbUsed > CONFIG.memThreshold) {
            log('warn', `RAM ${c.red}${mbUsed}MB${c.reset} > threshold ${CONFIG.memThreshold}MB — restarting...`);
            child.kill('SIGTERM');
          }
          break;
        }
        case 'plugin_report':
          displayPluginReport(msg);
          break;
        case 'health_pong':
          // child masih hidup, OK
          break;
        case 'connected':
          log('ok', `${c.green}${c.bold}Bot terhubung sebagai: ${msg.name || msg.id}${c.reset}`);
          break;
      }
    }
  });

  // ----- Exit handler -----
  child.on('exit', (code, signal) => {
    if (isShuttingDown) {
      log('sys', 'Graceful shutdown complete. Bye!');
      process.exit(0);
      return;
    }

    logCrash(code, signal);

    const uptime = formatUptime(Date.now() - startTime);
    log('error', `Process exited ${c.gray}(code=${code}, signal=${signal}, uptime=${uptime})${c.reset}`);

    // Reset counter jika proses jalan cukup lama (>5 menit)
    if (Date.now() - startTime > 5 * 60 * 1000) {
      restartCount = Math.max(0, restartCount - 3);
    }

    const delay = getDelay();
    log('sys', `Restart in ${c.yellow}${delay}ms${c.reset}...`);
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

  console.log('');
  log('sys', `${c.yellow}${signal}${c.reset} received. Graceful shutdown...`);

  if (memTimer) clearInterval(memTimer);
  if (healthTimer) clearInterval(healthTimer);
  if (scheduledTimer) clearInterval(scheduledTimer);
  for (const w of fileWatchers) { try { w.close(); } catch (_) {} }

  if (child && !child.killed) {
    child.kill('SIGTERM');
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
startScheduledRestart();
startFileWatcher();
start();
