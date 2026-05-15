/**
 * main.js — Ryuuzaa MD Core Bot
 * Membuat koneksi Baileys, memuat plugins (CJS + ESM), dan menjalankan handler.
 * Mengirim plugin report & DB info ke parent (index.js) via IPC.
 * Connection mode: pairing / qr (dari config.js)
 */
require('./config');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers
} = require('@whiskeysockets/baileys');

const pino       = require('pino');
const NodeCache  = require('node-cache');
const path       = require('path');
const fs         = require('fs');
const chalk      = require('chalk');
const readline   = require('readline');
const qrcode     = require('qrcode-terminal');

const { sessionName, pluginsDir, databaseFile } = require('./config');
const Database     = require('./lib/database');
const PluginLoader = require('./lib/plugin-loader');
const serialize    = require('./lib/serialize');
const handler      = require('./handler');

// ===== Global storage =====
global.db          = new Database();
global.plugins     = new Map();
global.pluginCache = new Map();
global.startTime   = Date.now();

// ===== Logger =====
const logger = pino({ level: 'silent' });

// ===== Pairing helper =====
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise(resolve => rl.question(text, resolve));

// ===== Console info helpers =====
function printStartupInfo(version, isLatest) {
  console.log('');
  console.log(chalk.white.bold('     ╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮'));
  console.log(chalk.white.bold('     ┃') + '                                            ' + chalk.white.bold('┃'));
  console.log(chalk.white.bold('     ┃') + chalk.cyan.bold('   R Y U U Z A A') + chalk.gray(' · ') + chalk.magenta.bold('M D') + '                  ' + chalk.white.bold('┃'));
  console.log(chalk.white.bold('     ┃') + chalk.gray('   WhatsApp Multi-Device Bot') + '               ' + chalk.white.bold('┃'));
  console.log(chalk.white.bold('     ┃') + '                                            ' + chalk.white.bold('┃'));
  console.log(chalk.white.bold('     ╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯'));
  console.log('');
  console.log(chalk.gray('     ┌─────────────┬────────────────────────────────┐'));
  console.log(chalk.gray('     │') + chalk.cyan(' baileys') + chalk.gray('     │ ') + chalk.white(`v${version.join('.')}`) + chalk.gray(` (latest: ${isLatest})`));
  console.log(chalk.gray('     │') + chalk.cyan(' bot') + chalk.gray('         │ ') + chalk.white(global.botName || 'Ryuuzaa MD'));
  console.log(chalk.gray('     │') + chalk.cyan(' owner') + chalk.gray('       │ ') + chalk.white(global.ownerName || '-'));
  console.log(chalk.gray('     │') + chalk.cyan(' prefix') + chalk.gray('      │ ') + chalk.yellow(JSON.stringify(global.prefix || ['.'])));
  console.log(chalk.gray('     │') + chalk.cyan(' mode') + chalk.gray('        │ ') + chalk.yellow((global.connectionMode || 'pairing').toUpperCase()));
  console.log(chalk.gray('     │') + chalk.cyan(' session') + chalk.gray('     │ ') + chalk.gray(`./${sessionName}/`));
  console.log(chalk.gray('     └─────────────┴────────────────────────────────┘'));
  console.log('');
}

function printPluginInfo() {
  const categories = {};
  for (const [name, plugin] of global.plugins) {
    const cat = plugin.category || 'misc';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(name);
  }

  console.log(chalk.gray('     ┌─ plugins ──────────────────────────────────────┐'));
  for (const [cat, items] of Object.entries(categories).sort()) {
    console.log(chalk.gray('     │ ') + chalk.yellow(`${cat}`) + chalk.gray(` (${items.length})`));
    for (const item of items) {
      const ext = path.extname(item);
      const tag = ext === '.mjs' ? chalk.magenta('esm') : ext === '.cjs' ? chalk.blue('cjs') : chalk.gray(' js');
      console.log(chalk.gray('     │   ') + tag + chalk.gray(' ') + chalk.white(item));
    }
  }
  console.log(chalk.gray('     │'));
  console.log(chalk.gray('     │ ') + chalk.green.bold(`✓ ${global.plugins.size} plugin(s) loaded`));
  console.log(chalk.gray('     └──────────────────────────────────────────────────┘'));
  console.log('');
}

function printDatabaseInfo() {
  const stats = global.db.stats();
  console.log(chalk.gray('     ┌─ database ─────────────────────────────────────┐'));
  console.log(chalk.gray('     │ ') + chalk.cyan('engine') + chalk.gray('  │ ') + chalk.white('SQLite (better-sqlite3)'));
  console.log(chalk.gray('     │ ') + chalk.cyan('file') + chalk.gray('    │ ') + chalk.white(databaseFile));
  console.log(chalk.gray('     │ ') + chalk.cyan('users') + chalk.gray('   │ ') + chalk.green(stats.users));
  console.log(chalk.gray('     │ ') + chalk.cyan('groups') + chalk.gray('  │ ') + chalk.green(stats.groups));
  console.log(chalk.gray('     │ ') + chalk.cyan('tables') + chalk.gray('  │ ') + chalk.gray('users, groups, settings'));
  console.log(chalk.gray('     └──────────────────────────────────────────────────┘'));
  console.log('');
}

function printConnectionInfo() {
  const mode = (global.connectionMode || 'pairing').toUpperCase();
  if (mode === 'PAIRING') {
    console.log(chalk.gray('     ┌─ connection ───────────────────────────────────┐'));
    console.log(chalk.gray('     │ ') + chalk.cyan('mode') + chalk.gray('    │ ') + chalk.yellow('PAIRING CODE'));
    console.log(chalk.gray('     │ ') + chalk.cyan('number') + chalk.gray('  │ ') + chalk.white(global.pairingNumber || '-'));
    console.log(chalk.gray('     │ ') + chalk.gray('          menunggu pairing code...'));
    console.log(chalk.gray('     └──────────────────────────────────────────────────┘'));
  } else {
    console.log(chalk.gray('     ┌─ connection ───────────────────────────────────┐'));
    console.log(chalk.gray('     │ ') + chalk.cyan('mode') + chalk.gray('    │ ') + chalk.yellow('QR CODE'));
    console.log(chalk.gray('     │ ') + chalk.gray('          scan QR di bawah...'));
    console.log(chalk.gray('     └──────────────────────────────────────────────────┘'));
  }
  console.log('');
}

// ===== Send plugin report to parent (index.js) =====
function sendPluginReport() {
  if (!process.send) return; // tidak ada IPC (jalankan langsung tanpa index.js)

  const categories = {};
  const pluginList = [];
  for (const [name, plugin] of global.plugins) {
    const cat = plugin.category || 'misc';
    categories[cat] = (categories[cat] || 0) + 1;
    pluginList.push(name);
  }

  const dbStats = global.db.stats();

  process.send({
    type: 'plugin_report',
    pluginCount: global.plugins.size,
    categories,
    pluginList,
    dbType: 'SQLite (better-sqlite3)',
    dbFile: databaseFile,
    dbStats
  });
}

// ===== Main bot function =====
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionName);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  // --- Print startup info ---
  printStartupInfo(version, isLatest);

  // --- Determine connection mode ---
  const mode = (global.connectionMode || 'pairing').toLowerCase();
  const usePairingCode = !state.creds.registered && mode === 'pairing';
  const useQR = !usePairingCode;

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: useQR,
    browser: Browsers.macOS('Safari'),
    auth: {
      creds: state.creds,
      keys : makeCacheableSignalKeyStore(state.keys, logger)
    },
    msgRetryCounterCache: new NodeCache(),
    generateHighQualityLinkPreview: true,
    getMessage: async () => ({ conversation: 'Ryuuzaa MD' })
  });

  // ----- Pairing Code mode -----
  if (usePairingCode) {
    printConnectionInfo();
    
    let phone = global.pairingNumber || '';
    
    // Jika pairingNumber kosong atau placeholder, tanya manual
    if (!phone || phone === 'RYUUZAAA' || phone.length < 6) {
      phone = await question(chalk.cyan('  📱 Masukkan nomor WA (cth: 628xxx): '));
    }

    // Bersihkan nomor
    phone = phone.replace(/[^0-9]/g, '');
    
    if (phone.length >= 6) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // delay sebelum request
      const code = await sock.requestPairingCode(phone);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log('');
      console.log(chalk.green.bold('  ╔══════════════════════════════════════════════════╗'));
      console.log(chalk.green.bold('  ║') + chalk.white.bold(`  🔑 PAIRING CODE: ${chalk.yellow.bold(formatted)}`.padEnd(59)) + chalk.green.bold('║'));
      console.log(chalk.green.bold('  ║') + chalk.gray(`  Masukkan code ini di WhatsApp > Linked Devices`.padEnd(50)) + chalk.green.bold('║'));
      console.log(chalk.green.bold('  ╚══════════════════════════════════════════════════╝'));
      console.log('');
    }
  } else if (!state.creds.registered) {
    printConnectionInfo();
  }

  // ----- Connection events -----
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && useQR) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      const name = sock.user?.name || sock.user?.id || 'Unknown';
      console.log('');
      console.log(chalk.green.bold('  ═══════════════════════════════════════════════════'));
      console.log(chalk.green.bold(`  ✓ CONNECTED! Logged in as: ${name}`));
      console.log(chalk.green.bold('  ═══════════════════════════════════════════════════'));
      console.log('');

      try { rl.close(); } catch (_) {}

      // Kirim info connected ke parent
      if (process.send) {
        process.send({ type: 'connected', name, id: sock.user?.id });
      }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] || code;
      
      console.log('');
      console.log(chalk.red(`  ✗ Koneksi terputus: ${reason} (code: ${code})`));

      if (code !== DisconnectReason.loggedOut) {
        console.log(chalk.yellow('  ↻ Reconnecting in 2.5s...'));
        setTimeout(startBot, 2500);
      } else {
        console.log(chalk.red.bold('  ⚠ LOGGED OUT — Hapus folder session/ lalu jalankan ulang.'));
        process.exit(0);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ----- Plugin loader -----
  const loader = new PluginLoader(path.join(__dirname, pluginsDir));
  await loader.loadAll();

  // Print plugin & database info ke console
  printPluginInfo();
  printDatabaseInfo();

  // Kirim report ke parent (index.js)
  sendPluginReport();

  if (global.autoReload) {
    loader.watch();
    console.log(chalk.gray('  👁  Plugin hot-reload: ACTIVE'));
    console.log('');
  }

  // ----- Message handler -----
  sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      let m = chatUpdate.messages[0];
      if (!m?.message) return;
      m = serialize(sock, m);
      await handler(sock, m, chatUpdate);
    } catch (e) {
      console.error(chalk.red('  [Handler Error]'), e.message || e);
    }
  });

  // ----- Group participant updates -----
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const groupEvent = require('./lib/group-event');
      await groupEvent(sock, update);
    } catch (_) {}
  });

  // ----- IPC handlers (dari index.js) -----
  if (process.send) {
    process.on('message', (msg) => {
      if (typeof msg === 'string') {
        if (msg === 'reset') process.exit(0);
        if (msg === 'mem_check') {
          process.send({ type: 'mem_report', rss: process.memoryUsage().rss });
        }
        if (msg === 'health_ping') {
          process.send({ type: 'health_pong', time: Date.now() });
        }
      }
    });
  }

  return sock;
}

// ===== Boot =====
console.log(chalk.gray(`     [${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}] starting ryuuzaa md...`));
console.log('');

startBot().catch(err => {
  console.error(chalk.red.bold('  [FATAL]'), err);
  process.exit(1);
});

// Cegah crash global
process.on('uncaughtException', (e) => {
  console.error(chalk.red('  [uncaughtException]'), e.message || e);
});
process.on('unhandledRejection', (e) => {
  console.error(chalk.red('  [unhandledRejection]'), e?.message || e);
});
