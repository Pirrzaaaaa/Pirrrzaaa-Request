/**
 * handler.js
 * Pipeline pesan: parse prefix/command -> case-handler -> plugins
 */
const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

const { caseFile } = require('./config');

let runCase = null;
let caseMtime = 0;

function loadCase() {
  const file = path.join(__dirname, caseFile);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (stat.mtimeMs !== caseMtime) {
    delete require.cache[require.resolve(file)];
    runCase = require(file);
    caseMtime = stat.mtimeMs;
    if (caseMtime !== 0) console.log(chalk.yellow('↻ case.js di-reload'));
  }
  return runCase;
}

module.exports = async function handler(sock, m, chatUpdate) {
  if (m.isBaileys || !m.message) return;

  // ----- Parse prefix & command -----
  const body = m.body || '';
  const prefixList = Array.isArray(global.prefix) ? global.prefix : [global.prefix || '.'];
  const usedPrefix = prefixList.find(p => body.startsWith(p)) || '';
  const isCmd = !!usedPrefix;

  const args     = body.slice(usedPrefix.length).trim().split(/\s+/);
  const command  = (args.shift() || '').toLowerCase();
  const text     = args.join(' ');
  const fullArgs = body.slice(usedPrefix.length + command.length).trim();

  // ----- Permission flags -----
  const senderNumber = (m.sender || '').split('@')[0];
  const ownerNums    = (global.owner || []).map(o => Array.isArray(o) ? o[0] : o).map(String);
  const isOwner      = ownerNums.includes(senderNumber) || m.fromMe;
  const isCreator    = (global.owner || []).some(o => Array.isArray(o) && String(o[0]) === senderNumber && o[2]);

  let isAdmin = false, isBotAdmin = false, groupMetadata = null;
  if (m.isGroup) {
    try {
      groupMetadata = await sock.groupMetadata(m.chat);
      const participants = groupMetadata.participants || [];
      const me = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
      isAdmin    = participants.find(p => p.id === m.sender)?.admin != null;
      isBotAdmin = participants.find(p => p.id === me)?.admin     != null;
    } catch (_) { /* ignore */ }
  }

  // ----- DB user/chat record -----
  try {
    global.db.ensureUser(m.sender, m.pushName);
    if (m.isGroup) global.db.ensureGroup(m.chat, groupMetadata?.subject);
  } catch (_) {}

  // ----- Logging -----
  if (isCmd || m.isGroup) {
    const tag = isCmd ? chalk.bgRed.white(' CMD ') : chalk.bgBlue.white(' MSG ');
    console.log(
      tag,
      chalk.cyan(m.pushName || senderNumber),
      chalk.gray('→'),
      chalk.yellow(isCmd ? `${usedPrefix}${command}` : (body.slice(0, 60) || '<media>')),
      m.isGroup ? chalk.magenta(`[${groupMetadata?.subject || m.chat}]`) : ''
    );
  }

  const ctx = {
    sock, m, chatUpdate,
    body, args, text, fullArgs, command, usedPrefix, isCmd,
    isOwner, isCreator, isAdmin, isBotAdmin, groupMetadata,
    db: global.db,
    reply : (t)  => sock.sendMessage(m.chat, { text: String(t) }, { quoted: m }),
    react : (e)  => sock.sendMessage(m.chat, { react: { text: e, key: m.key } })
  };

  // ===== 1. CASE HANDLER =====
  try {
    const fn = loadCase();
    if (typeof fn === 'function') {
      const stop = await fn(ctx);
      if (stop === true) return; // case selesai, skip plugin
    }
  } catch (e) {
    console.error(chalk.red('case error:'), e);
    ctx.reply(`❌ Case error: ${e.message}`);
  }

  // ===== 2. PLUGINS =====
  if (!isCmd) return;

  for (const [name, plugin] of global.plugins) {
    try {
      const matched =
        (plugin.command instanceof RegExp && plugin.command.test(command)) ||
        (Array.isArray(plugin.command) && plugin.command.includes(command)) ||
        (typeof plugin.command === 'string' && plugin.command === command);

      if (!matched) continue;

      // Permission gates
      if (plugin.owner    && !isOwner)    { ctx.reply(global.mess.owner);    return; }
      if (plugin.creator  && !isCreator)  { ctx.reply(global.mess.owner);    return; }
      if (plugin.group    && !m.isGroup)  { ctx.reply(global.mess.group);    return; }
      if (plugin.private  &&  m.isGroup)  { ctx.reply(global.mess.private);  return; }
      if (plugin.admin    && !isAdmin)    { ctx.reply(global.mess.admin);    return; }
      if (plugin.botAdmin && !isBotAdmin) { ctx.reply(global.mess.botAdmin); return; }

      const handlerFn = plugin.handler || plugin.run || plugin.default;
      if (typeof handlerFn !== 'function') continue;

      await handlerFn(ctx);
      return; // satu command satu plugin
    } catch (err) {
      console.error(chalk.red(`Plugin ${name} error:`), err);
      ctx.reply(`❌ Error pada plugin *${name}*\n\n${err.message}`);
      return;
    }
  }
};
