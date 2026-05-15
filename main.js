/**
 * main.js — Core bot
 * Membuat koneksi Baileys, memuat plugins (CJS + ESM), dan menjalankan handler.
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

const { sessionName, pluginsDir } = require('./config');
const Database     = require('./lib/database');
const PluginLoader = require('./lib/plugin-loader');
const serialize    = require('./lib/serialize');
const handler      = require('./handler');

// ===== Global storage =====
global.db          = new Database();
global.plugins     = new Map();
global.pluginCache = new Map(); // {filename: mtimeMs}
global.startTime   = Date.now();

// ===== Logger =====
const logger = pino({ level: 'silent' });

// ===== Pairing helper =====
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise(resolve => rl.question(text, resolve));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionName);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(chalk.magenta('╭─────────────────────────────────────────╮'));
  console.log(chalk.magenta('│   ') + chalk.bold.red('BlackRose WhatsApp Bot') + chalk.magenta('              │'));
  console.log(chalk.magenta('│   ') + chalk.gray(`Baileys v${version.join('.')} (latest: ${isLatest})`) + chalk.magenta('     │'));
  console.log(chalk.magenta('╰─────────────────────────────────────────╯'));

  const usePairingCode = !state.creds.registered && process.argv.includes('--pairing');

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !usePairingCode,
    browser: Browsers.macOS('Safari'),
    auth: {
      creds: state.creds,
      keys : makeCacheableSignalKeyStore(state.keys, logger)
    },
    msgRetryCounterCache: new NodeCache(),
    generateHighQualityLinkPreview: true,
    getMessage: async () => ({ conversation: 'BlackRose-Bot' })
  });

  // ----- Pairing Code mode -----
  if (usePairingCode) {
    const phone = await question(chalk.cyan('Masukkan nomor WA (cth: 628xxx): '));
    const code  = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
    console.log(chalk.green('Pairing Code: ') + chalk.bold.yellow(code?.match(/.{1,4}/g)?.join('-') || code));
  }

  // ----- Connection events -----
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && !usePairingCode) qrcode.generate(qr, { small: true });

    if (connection === 'open') {
      console.log(chalk.green('✓ Terhubung sebagai'), chalk.bold(sock.user?.name || sock.user?.id));
      try { rl.close(); } catch (_) {}
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] || code;
      console.log(chalk.red('✗ Koneksi terputus:'), reason);

      if (code !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 2500);
      } else {
        console.log(chalk.red('Logout terdeteksi. Hapus folder session lalu jalankan ulang.'));
        process.exit(0);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ----- Plugin loader -----
  const loader = new PluginLoader(path.join(__dirname, pluginsDir));
  await loader.loadAll();
  console.log(chalk.cyan(`✓ Plugin dimuat: ${global.plugins.size}`));

  if (global.autoReload) {
    loader.watch(); // hot reload
  }

  // ----- Message handler -----
  sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      let m = chatUpdate.messages[0];
      if (!m?.message) return;
      m = serialize(sock, m);
      await handler(sock, m, chatUpdate);
    } catch (e) {
      console.error(chalk.red('Handler error:'), e);
    }
  });

  // ----- Group participant updates -----
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const groupEvent = require('./lib/group-event');
      await groupEvent(sock, update);
    } catch (e) { /* silent */ }
  });

  // ----- IPC reset -----
  process.on('message', (m) => {
    if (m === 'reset') process.exit(0);
  });

  return sock;
}

startBot().catch(err => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(1);
});

// Cegah crash global
process.on('uncaughtException',  (e) => console.error(chalk.red('uncaughtException:'),  e));
process.on('unhandledRejection', (e) => console.error(chalk.red('unhandledRejection:'), e));
