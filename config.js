/**
 * Konfigurasi Bot — Ryuuzaa MD
 * Edit nilai di bawah sesuai kebutuhan kamu.
 */

global.owner = [
  ['628xxxxxxxxxx', 'Ryuuzaa', true] // [nomor, nama, isCreator]
];

global.botName   = 'Ryuuzaa MD';
global.ownerName = 'Ryuuzaa';
global.prefix    = ['.', '!', '/', '#']; // multi-prefix; set false untuk no-prefix
global.packname  = 'Ryuuzaa MD';
global.author    = 'Ryuuzaa';

// ===== CONNECTION MODE =====
// 'pairing' = login via pairing code (tanpa scan QR)
// 'qr'      = login via QR code
global.connectionMode = 'pairing';

// Nomor yang digunakan untuk pairing code (tanpa +, spasi, atau strip)
global.pairingNumber = 'RYUUZAAA';

// ===== Pesan default =====
global.mess = {
  wait    : '⏳ Sedang diproses, mohon tunggu...',
  success : '✅ Berhasil!',
  error   : '❌ Terjadi kesalahan.',
  owner   : '🚫 Khusus owner bot.',
  group   : '👥 Khusus di dalam grup.',
  private : '🔒 Khusus di chat pribadi.',
  admin   : '🔱 Khusus admin grup.',
  botAdmin: '🤖 Bot harus jadi admin grup dulu.',
  premium : '💎 Khusus user premium.'
};

// Timezone tampilan
global.timezone = 'Asia/Jakarta';

// API key (kalau ada)
global.APIs = {
  // contoh: lol: 'https://api.lolhuman.xyz'
};
global.APIKeys = {
  // 'https://api.lolhuman.xyz': 'apikeykamu'
};

// Reload otomatis saat file plugin berubah
global.autoReload = true;

// ===== SCHEDULED RESTART =====
// Restart otomatis setiap X jam (set 0 untuk nonaktifkan)
global.scheduledRestartHours = 6; // setiap 6 jam

// ===== FILE WATCHER (dev mode) =====
// Auto-restart jika file config.js atau main.js berubah
global.fileWatchRestart = true;

module.exports = {
  sessionName : 'session',
  storeFile   : 'baileys_store.json',
  databaseFile: './database/database.sqlite',
  pluginsDir  : './plugins',
  caseFile    : './case.js'
};
