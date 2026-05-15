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
  console.log(chalk.magenta.bold('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.magenta.bold('  ║') + chalk.red.bold('        🌹 Ryuuzaa MD WhatsApp Bot 🌹             ') + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ╠══════════════════════════════════════════════════╣'));
  console.log(chalk.magenta.bold('  ║') + chalk.white(`  Baileys    : v${version.join('.')} (latest: ${isLatest})`.padEnd(50)) + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ║') + chalk.white(`  Bot Name   : ${global.botName || 'Ryuuzaa MD'}`.padEnd(50)) + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ║') + chalk.white(`  Owner      : ${global.ownerName || '-'}`.padEnd(50)) + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ║') + chalk.white(`  Prefix     : ${JSON.stringify(global.prefix || ['.'])}`.padEnd(50)) + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ║') + chalk.white(`  Mode       : ${(global.connectionMode || 'pairing').toUpperCase()}`.padEnd(50)) + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ║') + chalk.white(`  Session    : ./${sessionName}/`.padEnd(50)) + chalk.magenta.bold('║'));
  console.log(chalk.magenta.bold('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
}

function printPluginInfo(pluginNames) {
  console.log(chalk.cyan.bold('  ┌─── Plugins Loaded ─────────────────────────────┐'));
  
  // Kategorikan
  const categories = {};
  for (const [name, plugin] of global.plugins) {
    const cat = plugin.category || 'misc';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(name);
  }

  for (const [cat, items] of Object.entries(categories).sort()) {
    console.log(chalk.cyan('  │') + chalk.yellow(` 📂 ${cat.toUpperCase()} (${items.length})`));
    for (const item of items) {
      const ext = path.extname(item);
      const icon = ext === '.mjs' ? '📦' : ext === '.cjs' ? '📋' : '📄';
      console.log(chalk.cyan('  │') + chalk.gray(`   ${icon} ${item}`));
    }
  }

  console.log(chalk.cyan('  │'));
  console.log(chalk.cyan('  │') + chalk.green.bold(` ✓ Total: ${global.plugins.size} plugin(s) loaded`));
  console.log(chalk.cyan.bold('  └──────────────────────────────────────────────────┘'));
  console.log('');
}

function printDatabaseInfo() {
  const stats = global.db.stats();
  console.log(chalk.blue.bold('  ┌─── Database Info ────────────────────────────────┐'));
  console.log(chalk.blue('  │') + chalk.white(` 💾 Engine     : SQLite (better-sqlite3)`));
  console.log(chalk.blue('  │') + chalk.white(` 📁 File       : ${databaseFile}`));
  console.log(chalk.blue('  │') + chalk.white(` 👥 Users      : ${stats.users}`));
  console.log(chalk.blue('  │') + chalk.white(` 💬 Groups     : ${stats.groups}`));
  console.log(chalk.blue('  │') + chalk.white(` 📊 Tables     : users, groups, settings`));
  console.log(chalk.blue.bold('  └──────────────────────────────────────────────────┘'));
  console.log('');
}

function printConnectionInfo() {
  const mode = (global.connectionMode || 'pairing').toUpperCase();
  if (mode === 'PAIRING') {
    console.log(chalk.yellow.bold('  ┌─── Connection Mode ──────────────────────────────┐'));
    console.log(chalk.yellow('  │') + chalk.white(` 🔗 Mode           : PAIRING CODE`));
    console.log(chalk.yellow('  │') + chalk.white(` 📱 Pairing Number : ${global.pairingNumber || '-'}`));
    console.log(chalk.yellow('  │') + chalk.gray(`    Menunggu pairing code...`));
    console.log(chalk.yellow.bold('  └──────────────────────────────────────────────────┘'));
  } else {
    console.log(chalk.yellow.bold('  ┌─── Connection Mode ──────────────────────────────┐'));
    console.log(chalk.yellow('  │') + chalk.white(` 📷 Mode : QR CODE`));
    console.log(chalk.yellow('  │') + chalk.gray(`    Scan QR di bawah...`));
    console.log(chalk.yellow.bold('  └──────────────────────────────────────────────────┘'));
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
console.log(chalk.gray(`  [${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}] Starting Ryuuzaa MD...`));
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
