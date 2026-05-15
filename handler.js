/**
 * handler.js — Ryuuzaa MD Full-Featured Message Handler
 *
 * Pipeline:
 *  1. Filter (baileys msg, status broadcast, banned user)
 *  2. Auto-read (opsional)
 *  3. Parse prefix & command
 *  4. Permission flags (owner, admin, botAdmin, premium, group/private)
 *  5. Anti-spam / cooldown
 *  6. EXP & leveling system
 *  7. Group features (antilink, antispam group, antidelete)
 *  8. Case handler (case.js)
 *  9. Plugin executor (dengan error handling + performance timer)
 *
 * Performa:
 *  - Minimal await di hot path
 *  - Early return pada setiap gate
 *  - Lazy metadata fetch (hanya jika benar-benar butuh)
 *  - Plugin lookup O(n) dengan short-circuit pada match pertama
 *  - Cooldown via Map (bukan DB) untuk speed
 */

const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

const { caseFile } = require('./config');

// ===== ANTI-SPAM / COOLDOWN =====
const cooldowns = new Map();  // Map<senderJid, timestamp>
const COOLDOWN_MS = 3000;     // 3 detik antar command

// ===== SPAM TRACKER (group antispam) =====
const spamTracker = new Map(); // Map<senderJid, { count, firstMsg }>
const SPAM_LIMIT  = 10;        // pesan per window
const SPAM_WINDOW = 8000;      // 8 detik

// ===== CASE HANDLER (hot reload) =====
let runCase   = null;
let caseMtime = 0;

function loadCase() {
  const file = path.join(__dirname, caseFile);
  if (!fs.existsSync(file)) return null;
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs !== caseMtime) {
      delete require.cache[require.resolve(file)];
      runCase = require(file);
      caseMtime = stat.mtimeMs;
      console.log(chalk.yellow('↻ case.js reloaded'));
    }
  } catch (e) {
    console.error(chalk.red('case.js load error:'), e.message);
  }
  return runCase;
}

// ===== EXP & LEVELING =====
const EXP_PER_MSG   = 5;
const EXP_PER_CMD   = 15;
const LEVEL_BASE    = 100; // exp needed = level * LEVEL_BASE

function calcLevel(exp) {
  let level = 0;
  let need = LEVEL_BASE;
  while (exp >= need) {
    exp -= need;
    level++;
    need = (level + 1) * LEVEL_BASE;
  }
  return level;
}

async function giveExp(db, sender, pushName, amount, sock, chat) {
  try {
    db.ensureUser(sender, pushName);
    db.addExp(sender, amount);
    const user = db.getUser(sender);
    if (!user) return;
    const newLevel = calcLevel(user.exp);
    if (newLevel > user.level) {
      db.setUser(sender, 'level', newLevel);
      // Notify level up
      await sock.sendMessage(chat, {
        text: `🎉 *Level Up!*\n\n@${sender.split('@')[0]} naik ke level *${newLevel}*!`,
        mentions: [sender]
      }).catch(() => {});
    }
  } catch (_) {}
}

// ===== ANTILINK DETECTOR =====
const LINK_REGEX = /(?:https?:\/\/|www\.)[^\s]+|chat\.whatsapp\.com\/[^\s]+/gi;

function containsLink(text) {
  return LINK_REGEX.test(text);
}

// ===== MAIN HANDLER =====
module.exports = async function handler(sock, m, chatUpdate) {
  // ─── 1. FILTER ───
  if (!m || !m.message) return;
  if (m.isBaileys) return;
  if (m.isStatus) return;

  const db = global.db;
  const startMs = Date.now(); // performance timer

  // ─── 2. AUTO-READ (opsional, bisa di-set di config) ───
  // m.read(); // uncomment jika mau auto-read

  // ─── 3. PARSE PREFIX & COMMAND ───
  const body = m.body || '';
  const prefixList = Array.isArray(global.prefix) ? global.prefix : [global.prefix || '.'];
  const usedPrefix = prefixList.find(p => body.startsWith(p)) || '';
  const isCmd = !!usedPrefix && body.length > usedPrefix.length;

  const full     = body.slice(usedPrefix.length).trim();
  const args     = full.split(/\s+/);
  const command  = (args.shift() || '').toLowerCase();
  const text     = args.join(' ');
  const fullArgs = body.slice(usedPrefix.length + command.length).trim();

  // ─── 4. PERMISSION FLAGS ───
  const senderNumber = m.senderNumber || (m.sender || '').split('@')[0];
  const ownerNums    = (global.owner || []).map(o => Array.isArray(o) ? o[0] : o).map(String);
  const isOwner      = ownerNums.includes(senderNumber) || m.fromMe;
  const isCreator    = (global.owner || []).some(o => Array.isArray(o) && String(o[0]) === senderNumber && o[2]);

  // Lazy group metadata (hanya fetch jika di grup)
  let _groupMeta = null;
  let _isAdmin = null;
  let _isBotAdmin = null;

  const getGroupMeta = async () => {
    if (_groupMeta !== null) return _groupMeta;
    if (!m.isGroup) { _groupMeta = false; return false; }
    try {
      _groupMeta = await sock.groupMetadata(m.chat);
    } catch (_) {
      _groupMeta = { participants: [], subject: '' };
    }
    return _groupMeta;
  };

  const getIsAdmin = async () => {
    if (_isAdmin !== null) return _isAdmin;
    const meta = await getGroupMeta();
    if (!meta || !meta.participants) { _isAdmin = false; return false; }
    _isAdmin = meta.participants.some(p => p.id === m.sender && p.admin);
    return _isAdmin;
  };

  const getIsBotAdmin = async () => {
    if (_isBotAdmin !== null) return _isBotAdmin;
    const meta = await getGroupMeta();
    if (!meta || !meta.participants) { _isBotAdmin = false; return false; }
    const botJid = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
    _isBotAdmin = meta.participants.some(p => p.id === botJid && p.admin);
    return _isBotAdmin;
  };

  // Premium check
  const isPremium = isOwner || (db ? db.isPremium(m.sender) : false);

  // ─── 5. BANNED CHECK ───
  if (db && db.isBanned(m.sender) && !isOwner) {
    return; // silent ignore banned user
  }

  // ─── 6. DB ENSURE (user & group) ───
  try {
    if (db) {
      db.ensureUser(m.sender, m.pushName);
      if (m.isGroup) {
        const meta = await getGroupMeta();
        db.ensureGroup(m.chat, meta?.subject || '');
      }
    }
  } catch (_) {}

  // ─── 7. GROUP FEATURES ───
  if (m.isGroup && db) {
    const groupData = db.getGroup(m.chat);

    // --- ANTILINK ---
    if (groupData?.antilink && !isOwner) {
      const isAdm = await getIsAdmin();
      if (!isAdm && containsLink(body)) {
        const botAdm = await getIsBotAdmin();
        if (botAdm) {
          await m.delete().catch(() => {});
          await m.reply('🔗 *Antilink aktif!* Pesan mengandung link dihapus.');
          try {
            await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
          } catch (_) {}
          return;
        }
      }
    }

    // --- GROUP ANTISPAM ---
    const now = Date.now();
    const tracker = spamTracker.get(m.sender);
    if (tracker && (now - tracker.firstMsg) < SPAM_WINDOW) {
      tracker.count++;
      if (tracker.count >= SPAM_LIMIT) {
        const isAdm = await getIsAdmin();
        if (!isAdm && !isOwner) {
          const botAdm = await getIsBotAdmin();
          if (botAdm) {
            await sock.sendMessage(m.chat, {
              text: `⚠️ @${senderNumber} terdeteksi spam (${tracker.count} pesan dalam ${SPAM_WINDOW/1000}s). Dikeluarkan.`,
              mentions: [m.sender]
            });
            await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
            spamTracker.delete(m.sender);
            return;
          }
        }
      }
    } else {
      spamTracker.set(m.sender, { count: 1, firstMsg: now });
    }
  }

  // ─── 8. EXP SYSTEM (setiap pesan) ───
  if (db && !m.fromMe) {
    // Async, non-blocking
    giveExp(db, m.sender, m.pushName, isCmd ? EXP_PER_CMD : EXP_PER_MSG, sock, m.chat);
  }

  // ─── 9. ANTI-SPAM COOLDOWN (per user, command only) ───
  if (isCmd && !isOwner && !isPremium) {
    const lastCmd = cooldowns.get(m.sender) || 0;
    if (Date.now() - lastCmd < COOLDOWN_MS) {
      const remain = Math.ceil((COOLDOWN_MS - (Date.now() - lastCmd)) / 1000);
      await m.react('⏳');
      return; // silent cooldown (just react)
    }
    cooldowns.set(m.sender, Date.now());
  }

  // ─── 10. LOGGING ───
  if (isCmd) {
    const meta = m.isGroup ? await getGroupMeta() : null;
    const tag = chalk.bgRed.white(' CMD ');
    console.log(
      tag,
      chalk.cyan(m.pushName || senderNumber),
      chalk.gray('→'),
      chalk.yellow(`${usedPrefix}${command}`),
      chalk.gray(text ? `[${text.slice(0, 40)}]` : ''),
      m.isGroup ? chalk.magenta(`(${meta?.subject || m.chat})`) : chalk.blue('(private)'),
      chalk.gray(`${Date.now() - startMs}ms`)
    );
  }

  // ─── BUILD CONTEXT ───
  const isAdmin    = m.isGroup ? await getIsAdmin() : false;
  const isBotAdmin = m.isGroup ? await getIsBotAdmin() : false;
  const groupMetadata = m.isGroup ? await getGroupMeta() : null;

  const ctx = {
    // Core
    sock, m, chatUpdate,
    // Parsed
    body, args, text, fullArgs, command, usedPrefix, isCmd,
    // Permissions
    isOwner, isCreator, isAdmin, isBotAdmin, isPremium,
    // Group
    isGroup: m.isGroup,
    groupMetadata,
    groupName: groupMetadata?.subject || '',
    participants: groupMetadata?.participants || [],
    // Database
    db,
    // Helpers (shortcut)
    reply    : (t, opts) => m.reply(t, opts),
    react    : (e) => m.react(e),
    send     : (t, opts) => m.send(t, opts),
    typing   : () => m.typing(),
    // Media helpers
    replyImage   : (buf, cap, opts) => m.replyImage(buf, cap, opts),
    replyVideo   : (buf, cap, opts) => m.replyVideo(buf, cap, opts),
    replyAudio   : (buf, opts) => m.replyAudio(buf, opts),
    replyPtt     : (buf, opts) => m.replyPtt(buf, opts),
    replySticker : (buf, opts) => m.replySticker(buf, opts),
    replyDocument: (buf, fn, mt, opts) => m.replyDocument(buf, fn, mt, opts),
    replyContact : (name, num) => m.replyContact(name, num),
    replyLocation: (lat, lon, opts) => m.replyLocation(lat, lon, opts),
    replyPoll    : (name, vals, cnt) => m.replyPoll(name, vals, cnt),
    // Utility
    download   : () => (m.quoted?.isMedia ? m.quoted.download() : m.download()),
    forward    : (jid) => m.forward(jid),
    delete     : () => m.delete(),
    // Performance
    startMs
  };

  // ═══════ 11. CASE HANDLER ═══════
  try {
    const fn = loadCase();
    if (typeof fn === 'function') {
      const stop = await fn(ctx);
      if (stop === true) return; // case handled, skip plugins
    }
  } catch (e) {
    console.error(chalk.red('Case error:'), e.message);
    await m.reply(`❌ Case error: ${e.message}`).catch(() => {});
  }

  // ═══════ 12. PLUGIN EXECUTOR ═══════
  if (!isCmd) return;

  for (const [name, plugin] of global.plugins) {
    try {
      // --- Match command ---
      let matched = false;
      if (plugin.command instanceof RegExp) {
        matched = plugin.command.test(command);
      } else if (Array.isArray(plugin.command)) {
        matched = plugin.command.includes(command);
      } else if (typeof plugin.command === 'string') {
        matched = plugin.command === command;
      }

      if (!matched) continue;

      // --- Permission gates (early return) ---
      if (plugin.owner && !isOwner) {
        await m.reply(global.mess.owner);
        return;
      }
      if (plugin.creator && !isCreator) {
        await m.reply(global.mess.owner);
        return;
      }
      if (plugin.premium && !isPremium) {
        await m.reply(global.mess.premium);
        return;
      }
      if (plugin.group && !m.isGroup) {
        await m.reply(global.mess.group);
        return;
      }
      if (plugin.private && m.isGroup) {
        await m.reply(global.mess.private);
        return;
      }
      if (plugin.admin && !isAdmin) {
        await m.reply(global.mess.admin);
        return;
      }
      if (plugin.botAdmin && !isBotAdmin) {
        await m.reply(global.mess.botAdmin);
        return;
      }

      // --- Execute handler ---
      const handlerFn = plugin.handler || plugin.run || plugin.exec || plugin.default;
      if (typeof handlerFn !== 'function') continue;

      // Performance react (opsional — uncomment untuk memberi react saat proses)
      // await m.react('⏳');

      await handlerFn(ctx);

      // Log execution time
      const elapsed = Date.now() - startMs;
      if (elapsed > 5000) {
        console.log(chalk.yellow(`⚠ Plugin ${name} slow: ${elapsed}ms`));
      }

      return; // satu command = satu plugin (first match wins)
    } catch (err) {
      console.error(chalk.red(`Plugin [${name}] error:`), err);
      await m.reply(`❌ Error plugin *${name}*\n\n\`\`\`${err.message}\`\`\``).catch(() => {});
      return;
    }
  }

  // ─── NO MATCH ───
  // (Opsional: reply "command tidak ditemukan")
  // await m.reply(`❓ Command *${usedPrefix}${command}* tidak ditemukan.\nKetik *${usedPrefix}menu* untuk daftar fitur.`);
};

// ===== Cleanup cooldown map secara periodik (memory leak prevention) =====
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of cooldowns) {
    if (now - ts > 60000) cooldowns.delete(key); // hapus yang >1 menit
  }
  for (const [key, data] of spamTracker) {
    if (now - data.firstMsg > 30000) spamTracker.delete(key);
  }
}, 30000);
