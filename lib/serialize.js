/**
 * lib/serialize.js — Full-Featured Ryuuzaa MD Message Serializer
 * 
 * Memperkaya objek pesan Baileys dengan berbagai utilitas:
 *  - m.body, m.chat, m.sender, m.isGroup, m.type
 *  - m.quoted (lengkap dengan download, reply, forward, delete)
 *  - m.download() — download media (image, video, audio, sticker, document, ptt)
 *  - m.reply(text, opts) — kirim balasan teks
 *  - m.replyImage(buffer, caption, opts)
 *  - m.replyVideo(buffer, caption, opts)
 *  - m.replyAudio(buffer, opts)
 *  - m.replyDocument(buffer, filename, mimetype, opts)
 *  - m.replySticker(buffer, opts)
 *  - m.replyContact(name, number)
 *  - m.replyLocation(lat, long)
 *  - m.react(emoji) — react ke pesan
 *  - m.forward(jid) — forward pesan
 *  - m.copy() — copy pesan ke chat yang sama
 *  - m.delete() — hapus pesan sendiri
 *  - m.mentions — array JID yang di-mention
 *  - m.isMedia, m.isImage, m.isVideo, m.isAudio, m.isSticker, m.isDocument
 *  - m.isViewOnce, m.isEphemeral
 *  - m.mediaType — tipe media string
 *  - m.fileSize — ukuran file
 *  - m.mimetype — mimetype media
 *  - m.url — URL button/template
 */

const {
  downloadContentFromMessage,
  jidNormalizedUser,
  getContentType,
  generateWAMessageFromContent,
  generateWAMessage,
  generateForwardMessageContent,
  proto,
  areJidsSameUser,
  extractMessageContent
} = require('@whiskeysockets/baileys');

const fs   = require('fs');
const path = require('path');

// ===== Helper: extract body dari berbagai tipe pesan =====
function extractBody(msg) {
  if (!msg) return '';
  const type = getContentType(msg);
  if (!type) return '';
  const node = msg[type];
  if (typeof node === 'string') return node;

  return (
    node?.text ||
    node?.caption ||
    node?.contentText ||
    node?.selectedDisplayText ||
    node?.title ||
    node?.name ||
    // Interactive / button response
    node?.singleSelectReply?.selectedRowId ||
    node?.selectedButtonId ||
    node?.selectedId ||
    node?.templateButtonReplyMessage?.selectedId ||
    node?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    // Poll
    node?.pollCreationMessage?.name ||
    ''
  );
}

// ===== Helper: Media type map =====
const MEDIA_TYPE_MAP = {
  imageMessage      : 'image',
  videoMessage      : 'video',
  audioMessage      : 'audio',
  stickerMessage    : 'sticker',
  documentMessage   : 'document',
  ptvMessage        : 'video',        // video note (circular)
  documentWithCaptionMessage: 'document'
};

// ===== Helper: Download media dari pesan =====
async function downloadMedia(msgContent, type) {
  if (!msgContent || !type) return null;
  const mediaType = MEDIA_TYPE_MAP[type];
  if (!mediaType) return null;

  let node = msgContent[type];
  // documentWithCaptionMessage wrapper
  if (type === 'documentWithCaptionMessage') {
    node = node?.message?.documentMessage;
    if (!node) return null;
  }

  const stream = await downloadContentFromMessage(node, mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ===== Helper: get quoted message content =====
function getQuotedContent(m, type) {
  const ctx = m.message?.[type]?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  
  let quotedMsg = ctx.quotedMessage;
  // Handle view once dalam quoted
  if (quotedMsg.viewOnceMessageV2) quotedMsg = quotedMsg.viewOnceMessageV2.message;
  else if (quotedMsg.viewOnceMessage) quotedMsg = quotedMsg.viewOnceMessage.message;
  // Handle ephemeral dalam quoted
  if (quotedMsg.ephemeralMessage) quotedMsg = quotedMsg.ephemeralMessage.message;
  
  return { msg: quotedMsg, ctx };
}

// ===== Main serialize function =====
module.exports = function serialize(sock, m) {
  if (!m) return m;
  if (m._serialized) return m; // prevent double serialize

  // ===== Basic props =====
  m._serialized = true;
  m.id          = m.key?.id || '';
  m.chat        = m.key?.remoteJid || '';
  m.fromMe      = m.key?.fromMe || false;
  m.isGroup     = m.chat?.endsWith('@g.us') || false;
  m.isStatus    = m.chat === 'status@broadcast';
  
  // Sender
  const botId = jidNormalizedUser(sock.user?.id || '');
  if (m.fromMe) {
    m.sender = botId;
  } else if (m.isGroup) {
    m.sender = jidNormalizedUser(m.key?.participant || '');
  } else {
    m.sender = jidNormalizedUser(m.chat || '');
  }

  m.senderNumber = (m.sender || '').split('@')[0];
  m.pushName     = m.pushName || m.verifiedBizName || '';
  m.isBaileys    = m.id?.startsWith('BAE5') || m.id?.startsWith('3EB0') || m.id?.length === 16;

  // ===== Message extraction (handle wrappers) =====
  let rawMsg = m.message || {};
  
  // ViewOnce
  m.isViewOnce = !!(rawMsg.viewOnceMessageV2 || rawMsg.viewOnceMessage || rawMsg.viewOnceMessageV2Extension);
  if (rawMsg.viewOnceMessageV2) rawMsg = rawMsg.viewOnceMessageV2.message || rawMsg;
  else if (rawMsg.viewOnceMessage) rawMsg = rawMsg.viewOnceMessage.message || rawMsg;
  else if (rawMsg.viewOnceMessageV2Extension) rawMsg = rawMsg.viewOnceMessageV2Extension.message || rawMsg;

  // Ephemeral
  m.isEphemeral = !!rawMsg.ephemeralMessage;
  if (rawMsg.ephemeralMessage) rawMsg = rawMsg.ephemeralMessage.message || rawMsg;

  // DocumentWithCaption wrapper
  if (rawMsg.documentWithCaptionMessage) {
    rawMsg = { documentMessage: rawMsg.documentWithCaptionMessage.message?.documentMessage, ...rawMsg };
  }

  m.message = rawMsg;

  // ===== Type detection =====
  m.type = getContentType(m.message) || '';

  // ===== Body =====
  m.body = extractBody(m.message);

  // ===== Media detection =====
  const mediaNode = m.message?.[m.type];
  m.isImage    = m.type === 'imageMessage';
  m.isVideo    = m.type === 'videoMessage' || m.type === 'ptvMessage';
  m.isAudio    = m.type === 'audioMessage';
  m.isSticker  = m.type === 'stickerMessage';
  m.isDocument = m.type === 'documentMessage' || m.type === 'documentWithCaptionMessage';
  m.isContact  = m.type === 'contactMessage' || m.type === 'contactsArrayMessage';
  m.isLocation = m.type === 'locationMessage' || m.type === 'liveLocationMessage';
  m.isPoll     = m.type === 'pollCreationMessage' || m.type === 'pollCreationMessageV3';
  m.isMedia    = m.isImage || m.isVideo || m.isAudio || m.isSticker || m.isDocument;
  m.isText     = m.type === 'conversation' || m.type === 'extendedTextMessage';

  m.mediaType = m.isImage ? 'image' : m.isVideo ? 'video' : m.isAudio ? 'audio' :
                m.isSticker ? 'sticker' : m.isDocument ? 'document' : null;

  // Media metadata
  m.mimetype = mediaNode?.mimetype || null;
  m.fileSize = mediaNode?.fileLength || mediaNode?.fileSha256?.length || 0;
  m.fileName = mediaNode?.fileName || null;
  m.seconds  = mediaNode?.seconds || 0; // durasi audio/video
  m.isGif    = m.isVideo && mediaNode?.gifPlayback === true;
  m.isPtt    = m.isAudio && mediaNode?.ptt === true; // voice note
  m.url      = mediaNode?.url || null;

  // Mentions
  m.mentionedJid = m.message?.[m.type]?.contextInfo?.mentionedJid || [];
  m.mentions     = m.mentionedJid;

  // ===== Download media =====
  m.download = async () => {
    if (!m.isMedia) {
      throw new Error('Pesan ini bukan media.');
    }
    return downloadMedia(m.message, m.type);
  };

  // ===== Save to file =====
  m.saveToFile = async (filePath) => {
    const buf = await m.download();
    if (!buf) throw new Error('Gagal download media.');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buf);
    return filePath;
  };

  // ===== QUOTED MESSAGE =====
  const quotedData = getQuotedContent(m, m.type);
  if (quotedData) {
    const { msg: quotedMsg, ctx } = quotedData;
    const qType = getContentType(quotedMsg) || '';
    const qNode = quotedMsg?.[qType];

    m.quoted = {
      message    : quotedMsg,
      type       : qType,
      id         : ctx.stanzaId || '',
      sender     : jidNormalizedUser(ctx.participant || ''),
      fromMe     : areJidsSameUser(ctx.participant, botId),
      pushName   : '',
      body       : extractBody(quotedMsg),
      isImage    : qType === 'imageMessage',
      isVideo    : qType === 'videoMessage' || qType === 'ptvMessage',
      isAudio    : qType === 'audioMessage',
      isSticker  : qType === 'stickerMessage',
      isDocument : qType === 'documentMessage' || qType === 'documentWithCaptionMessage',
      isContact  : qType === 'contactMessage' || qType === 'contactsArrayMessage',
      isLocation : qType === 'locationMessage',
      isMedia    : ['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage','ptvMessage'].includes(qType),
      mimetype   : qNode?.mimetype || null,
      fileSize   : qNode?.fileLength || 0,
      fileName   : qNode?.fileName || null,
      seconds    : qNode?.seconds || 0,
      isPtt      : qType === 'audioMessage' && qNode?.ptt === true,
      mentions   : ctx.mentionedJid || [],

      // Key untuk operasi
      key: {
        remoteJid  : ctx.remoteJid || m.chat,
        fromMe     : areJidsSameUser(ctx.participant, botId),
        id         : ctx.stanzaId,
        participant: m.isGroup ? ctx.participant : undefined
      },

      // Download quoted media
      download: async () => {
        if (!['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage','ptvMessage'].includes(qType)) {
          throw new Error('Quoted bukan media.');
        }
        return downloadMedia(quotedMsg, qType);
      },

      // Save quoted media
      saveToFile: async (filePath) => {
        const buf = await m.quoted.download();
        if (!buf) throw new Error('Gagal download quoted media.');
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, buf);
        return filePath;
      },

      // Reply ke quoted
      reply: (text, opts = {}) => {
        return sock.sendMessage(m.chat, { text: String(text), ...opts }, { quoted: m.quoted._fakeMsg || m });
      },

      // Delete quoted msg
      delete: () => {
        return sock.sendMessage(m.chat, { delete: m.quoted.key });
      },

      // Forward quoted
      forward: async (jid, opts = {}) => {
        const content = generateForwardMessageContent(
          { key: m.quoted.key, message: quotedMsg },
          opts.force || false
        );
        const waMsg = generateWAMessageFromContent(jid, content, {
          userJid: botId,
          ...opts
        });
        return sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
      }
    };

    // Fake msg object (untuk quoting quoted)
    m.quoted._fakeMsg = {
      key: m.quoted.key,
      message: quotedMsg
    };

  } else {
    m.quoted = null;
  }

  // ===== REPLY FUNCTIONS =====

  // Reply teks
  m.reply = (text, opts = {}) => {
    return sock.sendMessage(m.chat, { text: String(text), ...opts }, { quoted: m });
  };

  // Reply tanpa quote
  m.send = (text, opts = {}) => {
    return sock.sendMessage(m.chat, { text: String(text), ...opts });
  };

  // React
  m.react = (emoji) => {
    return sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } });
  };

  // Reply image
  m.replyImage = (buffer, caption = '', opts = {}) => {
    const msg = { image: buffer, caption, ...opts };
    if (opts.mentions) msg.mentions = opts.mentions;
    return sock.sendMessage(m.chat, msg, { quoted: m });
  };

  // Reply video
  m.replyVideo = (buffer, caption = '', opts = {}) => {
    const msg = { video: buffer, caption, ...opts };
    if (opts.gifPlayback) msg.gifPlayback = true;
    return sock.sendMessage(m.chat, msg, { quoted: m });
  };

  // Reply audio
  m.replyAudio = (buffer, opts = {}) => {
    const msg = { audio: buffer, mimetype: 'audio/mpeg', ...opts };
    return sock.sendMessage(m.chat, msg, { quoted: m });
  };

  // Reply voice note (PTT)
  m.replyPtt = (buffer, opts = {}) => {
    const msg = { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true, ...opts };
    return sock.sendMessage(m.chat, msg, { quoted: m });
  };

  // Reply sticker
  m.replySticker = (buffer, opts = {}) => {
    return sock.sendMessage(m.chat, { sticker: buffer, ...opts }, { quoted: m });
  };

  // Reply document
  m.replyDocument = (buffer, fileName = 'file', mimetype = 'application/octet-stream', opts = {}) => {
    const msg = { document: buffer, mimetype, fileName, ...opts };
    return sock.sendMessage(m.chat, msg, { quoted: m });
  };

  // Reply contact
  m.replyContact = (name, number) => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${number}:+${number}\nEND:VCARD`;
    return sock.sendMessage(m.chat, {
      contacts: { displayName: name, contacts: [{ vcard }] }
    }, { quoted: m });
  };

  // Reply multiple contacts
  m.replyContacts = (contacts) => {
    // contacts = [{ name, number }, ...]
    const vcards = contacts.map(c => ({
      vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;type=CELL;type=VOICE;waid=${c.number}:+${c.number}\nEND:VCARD`
    }));
    return sock.sendMessage(m.chat, {
      contacts: { displayName: `${contacts.length} contacts`, contacts: vcards }
    }, { quoted: m });
  };

  // Reply location
  m.replyLocation = (latitude, longitude, opts = {}) => {
    return sock.sendMessage(m.chat, {
      location: { degreesLatitude: latitude, degreesLongitude: longitude },
      ...opts
    }, { quoted: m });
  };

  // Reply with buttons (jika supported)
  m.replyButtons = (text, buttons, footer = '', opts = {}) => {
    return sock.sendMessage(m.chat, {
      text,
      footer,
      buttons: buttons.map((b, i) => ({
        buttonId: b.id || `btn_${i}`,
        buttonText: { displayText: b.text || b },
        type: 1
      })),
      headerType: 1,
      ...opts
    }, { quoted: m });
  };

  // Reply with template buttons
  m.replyTemplate = (text, templateButtons, footer = '', opts = {}) => {
    return sock.sendMessage(m.chat, {
      text, footer, templateButtons, ...opts
    }, { quoted: m });
  };

  // Reply with list/sections
  m.replyList = (text, buttonText, sections, footer = '', title = '', opts = {}) => {
    return sock.sendMessage(m.chat, {
      text, footer, title, buttonText, sections, ...opts
    }, { quoted: m });
  };

  // ===== FORWARD =====
  m.forward = async (jid, opts = {}) => {
    if (!m.message) throw new Error('Tidak ada pesan untuk forward.');
    const content = generateForwardMessageContent(
      { key: m.key, message: m.message },
      opts.force || false
    );
    const waMsg = generateWAMessageFromContent(jid, content, {
      userJid: botId,
      ...opts
    });
    return sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
  };

  // ===== COPY (forward ke chat yang sama) =====
  m.copy = () => m.forward(m.chat);

  // ===== DELETE =====
  m.delete = () => {
    return sock.sendMessage(m.chat, { delete: m.key });
  };

  // ===== EDIT (edit pesan sendiri) =====
  m.edit = (newText) => {
    if (!m.fromMe) throw new Error('Hanya bisa edit pesan sendiri.');
    return sock.sendMessage(m.chat, {
      text: newText,
      edit: m.key
    });
  };

  // ===== SEND TO (kirim teks ke JID lain) =====
  m.sendTo = (jid, content, opts = {}) => {
    return sock.sendMessage(jid, content, opts);
  };

  // ===== TYPING INDICATOR =====
  m.typing = () => sock.sendPresenceUpdate('composing', m.chat);
  m.recording = () => sock.sendPresenceUpdate('recording', m.chat);
  m.online = () => sock.sendPresenceUpdate('available', m.chat);
  m.offline = () => sock.sendPresenceUpdate('unavailable', m.chat);

  // ===== READ MESSAGE =====
  m.read = () => sock.readMessages([m.key]);

  // ===== GET PROFILE PICTURE =====
  m.getProfilePic = async (jid) => {
    try {
      return await sock.profilePictureUrl(jid || m.sender, 'image');
    } catch (_) {
      return null;
    }
  };

  // ===== GET STATUS/ABOUT =====
  m.getStatus = async (jid) => {
    try {
      return await sock.fetchStatus(jid || m.sender);
    } catch (_) {
      return null;
    }
  };

  // ===== POLL (create poll) =====
  m.replyPoll = (name, values, selectableCount = 1) => {
    return sock.sendMessage(m.chat, {
      poll: { name, values, selectableCount }
    }, { quoted: m });
  };

  // ===== IPC support (respond to parent health/mem check) =====
  if (process.send) {
    // Respond memory check dari parent (index.js)
    process.on('message', (msg) => {
      if (msg === 'mem_check') {
        process.send({ type: 'mem_report', rss: process.memoryUsage().rss });
      }
      if (msg === 'health_ping') {
        process.send({ type: 'health_pong', time: Date.now() });
      }
    });
  }

  return m;
};

// ===== Export tambahan: smsg helper untuk backward compat =====
module.exports.smsg = module.exports;
module.exports.extractBody = extractBody;
module.exports.downloadMedia = downloadMedia;
