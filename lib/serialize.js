/**
 * lib/serialize.js — Memperkaya objek pesan Baileys
 * agar mudah diakses (m.body, m.chat, m.sender, m.isGroup, m.quoted, m.download(), dll)
 */
const {
  downloadContentFromMessage,
  jidNormalizedUser,
  getContentType
} = require('@whiskeysockets/baileys');

function getBody(msg) {
  if (!msg) return '';
  const type = getContentType(msg);
  if (!type) return '';
  const node = msg[type];
  if (typeof node === 'string') return node;
  return node?.text || node?.caption || node?.singleSelectReply?.selectedRowId ||
         node?.selectedButtonId || node?.selectedId || '';
}

async function downloadMedia(messagePart) {
  const type = Object.keys(messagePart || {})[0];
  const mediaTypeMap = {
    imageMessage   : 'image',
    videoMessage   : 'video',
    audioMessage   : 'audio',
    stickerMessage : 'sticker',
    documentMessage: 'document'
  };
  const mediaType = mediaTypeMap[type];
  if (!mediaType) return null;

  const stream = await downloadContentFromMessage(messagePart[type], mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = function serialize(sock, m) {
  if (!m) return m;

  m.id        = m.key.id;
  m.chat      = m.key.remoteJid;
  m.fromMe    = m.key.fromMe;
  m.isGroup   = m.chat?.endsWith('@g.us');
  m.sender    = jidNormalizedUser(m.fromMe ? sock.user?.id : (m.key.participant || m.chat));
  m.isBaileys = m.id?.startsWith('BAE5') || m.id?.length === 16;
  m.pushName  = m.pushName || '';

  const type = getContentType(m.message) || '';
  m.type     = type;
  m.message  = m.message?.viewOnceMessageV2?.message || m.message?.viewOnceMessage?.message || m.message;
  m.body     = getBody(m.message);

  // Quoted
  const ctx = m.message?.[type]?.contextInfo;
  if (ctx?.quotedMessage) {
    const qType  = getContentType(ctx.quotedMessage);
    m.quoted = {
      type     : qType,
      sender   : jidNormalizedUser(ctx.participant),
      message  : ctx.quotedMessage,
      body     : getBody(ctx.quotedMessage),
      key      : { remoteJid: ctx.remoteJid || m.chat, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
      download : () => downloadMedia(ctx.quotedMessage)
    };
    m.mentionedJid = ctx.mentionedJid || [];
  } else {
    m.quoted = null;
    m.mentionedJid = m.message?.[type]?.contextInfo?.mentionedJid || [];
  }

  m.download = () => downloadMedia(m.message);

  m.reply = (text, opts = {}) => sock.sendMessage(m.chat, { text: String(text), ...opts }, { quoted: m });

  return m;
};
