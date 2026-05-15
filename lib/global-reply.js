/**
 * lib/global-reply.js — Ryuuzaa MD Global Styled Reply
 *
 * Ported dari ourin-style-reply (ESM) ke CommonJS.
 * Menyediakan:
 *  - sendTrolleyText(sock, m, text, opts)
 *  - sendTrolleyImage(sock, m, buffer, caption, opts)
 *  - sendTrolleyDocument(sock, m, buffer, docOpts, opts)
 *  - sendTrolleyAudio(sock, m, buffer, audioOpts, opts)
 *  - sendNativeTrolleyReply(sock, m, interactiveOpts, opts)
 *  - sendProgress / editProgress / finishProgress
 *  - safeStyledReply(sock, m, text, opts)
 *  - createFakeTrolleyQuoted / createFakeContactQuoted / createFakePaymentQuoted
 *  - getNewsletterContext / buildAwanText / createDefaultNativeButtons
 */

const { proto, generateWAMessageFromContent } = require('baileys');
const fs   = require('fs');
const path = require('path');

// ===== Lazy sharp loader =====
let __sharpMod = null;
async function __getSharp() {
  if (!__sharpMod) __sharpMod = require('sharp');
  return __sharpMod;
}

// ===== PP Cache =====
const ppCache = new Map();
const PP_CACHE_TTL = 5 * 60 * 1000;

// ===== Defaults =====
const PORTFOLIO_ADMIN = 'https://pirrzaa-web.vercel.app/';
const DEFAULT_SALURAN_ID = '120363208449943317@newsletter';
const DEFAULT_SALURAN_LINK = 'https://whatsapp.com/channel/0029VbB37bgBfxoAmAlsgE0t';

// ===== Helpers =====
function readBufferSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch { return null; }
}

function cleanText(text = '') {
  return String(text).replace(/[\n\r\t;]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function getBotName() {
  return global.botName || 'Ryuuzaa MD';
}

function getSaluranInfo() {
  return {
    saluranId: DEFAULT_SALURAN_ID,
    saluranName: getBotName(),
    saluranLink: DEFAULT_SALURAN_LINK
  };
}

function getSellerJid(m) {
  const ownerArr = global.owner || [];
  const raw = Array.isArray(ownerArr[0]) ? ownerArr[0][0] : ownerArr[0];
  if (raw) {
    const number = String(raw).replace(/[^0-9]/g, '');
    if (number) return `${number}@s.whatsapp.net`;
  }
  return m?.sender || '0@s.whatsapp.net';
}

async function resizeThumb(buffer, size = 300) {
  try {
    if (!buffer) return null;
    const sharp = await __getSharp();
    return await sharp(buffer).resize(size, size, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
  } catch { return buffer || null; }
}

async function getUserThumb(sock, m) {
  const jid = m?.sender;
  if (!jid) return null;

  const cached = ppCache.get(jid);
  if (cached && Date.now() - cached.ts < PP_CACHE_TTL) return cached.buffer;

  let source = null;
  try {
    const ppUrl = await sock.profilePictureUrl(jid, 'image');
    const fetch = require('node-fetch');
    const res = await fetch(ppUrl, { timeout: 5000 });
    source = Buffer.from(await res.arrayBuffer());
  } catch {
    source = readBufferSafe(path.join(process.cwd(), 'assets', 'images', 'default.jpg'));
  }

  const thumb = await resizeThumb(source);
  ppCache.set(jid, { buffer: thumb, ts: Date.now() });
  return thumb;
}

// ===== Newsletter Context =====
function getNewsletterContext(m, options = {}) {
  const { saluranId, saluranName } = getSaluranInfo();
  const mentionedJid = options.mentionedJid || options.mentions || (m?.sender ? [m.sender] : []);

  return {
    mentionedJid,
    forwardingScore: options.forwardingScore ?? 9,
    isForwarded: options.isForwarded ?? true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: saluranId,
      newsletterName: saluranName,
      serverMessageId: options.serverMessageId || 127
    }
  };
}

// ===== Fake Trolley Quoted =====
async function createFakeTrolleyQuoted(m, sock, options = {}) {
  const { saluranId, saluranName } = getSaluranInfo();
  const ppThumb = options.thumbnail || await getUserThumb(sock, m);

  const botName = getBotName();
  const title = options.title || `☁︎ ${botName}`;
  const message = options.message || `• ${botName}\n• Permintaan sedang diproses`;

  return {
    key: {
      fromMe: false,
      participant: '0@s.whatsapp.net',
      remoteJid: 'status@broadcast'
    },
    message: {
      orderMessage: {
        orderId: options.orderId || '44444444444444',
        ...(ppThumb ? { thumbnail: ppThumb } : {}),
        itemCount: Number(options.itemCount || 1),
        status: 'INQUIRY',
        surface: 'CATALOG',
        message,
        orderTitle: title,
        sellerJid: getSellerJid(m),
        token: options.token || 'ryuuzaa-style-reply',
        totalAmount1000: Number(options.totalAmount1000 || 1000),
        totalCurrencyCode: options.currency || 'IDR',
        contextInfo: {
          isForwarded: true,
          forwardingScore: 9,
          forwardedNewsletterMessageInfo: {
            newsletterJid: saluranId,
            newsletterName: saluranName,
            serverMessageId: 127
          }
        }
      }
    }
  };
}

// ===== Fake Contact Quoted =====
function createFakeContactQuoted(m, options = {}) {
  const botName = getBotName();
  const displayName = cleanText(options.displayName || `☁︎ ${botName}`);
  const ownerArr = global.owner || [];
  const number = String(Array.isArray(ownerArr[0]) ? ownerArr[0][0] : ownerArr[0] || '0').replace(/[^0-9]/g, '');

  return {
    key: { fromMe: false, participant: '0@s.whatsapp.net', remoteJid: 'status@broadcast' },
    message: {
      contactMessage: {
        displayName,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:XL;${displayName},;;;\nFN:${displayName}\nitem1.TEL;waid=${number}:+${number}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`,
        contextInfo: getNewsletterContext(m)
      }
    }
  };
}

// ===== Fake Payment Quoted =====
function createFakePaymentQuoted(m, options = {}) {
  const botName = getBotName();
  return {
    key: { fromMe: false, participant: '0@s.whatsapp.net', remoteJid: 'status@broadcast' },
    message: {
      requestPaymentMessage: {
        currencyCodeIso4217: options.currency || 'IDR',
        amount1000: Number(options.amount1000 || 999999),
        requestFrom: '0@s.whatsapp.net',
        noteMessage: { extendedTextMessage: { text: options.note || `☁︎ ${botName}` } },
        expiryTimestamp: Math.floor(Date.now() / 1000) + 86400,
        amount: { value: Number(options.value || 999999), offset: 1000, currencyCode: options.currency || 'IDR' }
      }
    }
  };
}

// ===== Default Native Buttons =====
function createDefaultNativeButtons(m, options = {}) {
  const prefix = (Array.isArray(global.prefix) ? global.prefix[0] : global.prefix) || '.';
  const buttons = [
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: options.menuText || '☁︎ Kembali ke Menu', id: `${prefix}menu` }) },
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: options.ownerText || 'Owner', id: `${prefix}owner` }) },
    { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: options.copyText || 'Portfolio Admin', copy_code: options.copyCode || PORTFOLIO_ADMIN }) }
  ];
  if (Array.isArray(options.extraButtons)) buttons.push(...options.extraButtons);
  return buttons;
}

// ===== Build Awan Text =====
function buildAwanText({ title = 'INFORMASI', lines = [], note = '', footer = '' }) {
  const body = [`☁︎ *${String(title).toUpperCase()}* ☁︎`, '', ...lines.map(l => `• ${l}`)];
  if (note) body.push('', `☁︎ *CATATAN* ☁︎`, `• ${note}`);
  if (footer) body.push('', footer);
  return body.join('\n');
}

// ===== Send Trolley Text =====
async function sendTrolleyText(sock, m, text, options = {}) {
  const quoted = options.quoted || await createFakeTrolleyQuoted(m, sock, {
    title: options.title, message: options.message, itemCount: options.itemCount, thumbnail: options.thumbnail
  });
  return sock.sendMessage(m.chat, { text: String(text || ''), contextInfo: getNewsletterContext(m, options) }, { quoted });
}

// ===== Send Trolley Image =====
async function sendTrolleyImage(sock, m, imageBuffer, caption = '', options = {}) {
  const quoted = options.quoted || await createFakeTrolleyQuoted(m, sock, {
    title: options.title || '🖼️ Image Result', message: options.message || '• Gambar berhasil diproses',
    itemCount: options.itemCount || 1, thumbnail: options.thumbnail
  });
  return sock.sendMessage(m.chat, { image: imageBuffer, caption: String(caption || ''), mimetype: options.mimetype || 'image/jpeg', contextInfo: getNewsletterContext(m, options) }, { quoted });
}

// ===== Send Trolley Document =====
async function sendTrolleyDocument(sock, m, buffer, { fileName = 'file.bin', mimetype = 'application/octet-stream', caption = '' } = {}, options = {}) {
  const quoted = options.quoted || await createFakeTrolleyQuoted(m, sock, {
    title: options.title || '📄 Document Result', message: options.message || '• Dokumen berhasil diproses',
    itemCount: options.itemCount || 1, thumbnail: options.thumbnail
  });
  return sock.sendMessage(m.chat, { document: buffer, fileName, mimetype, caption: String(caption || ''), contextInfo: getNewsletterContext(m, options) }, { quoted });
}

// ===== Send Trolley Audio =====
async function sendTrolleyAudio(sock, m, audioBuffer, { fileName = 'audio.mp3', mimetype = 'audio/mpeg', ptt = false } = {}, options = {}) {
  const quoted = options.quoted || await createFakeTrolleyQuoted(m, sock, {
    title: options.title || '🎧 Audio Result', message: options.message || '• Audio berhasil diproses',
    itemCount: options.itemCount || 1, thumbnail: options.thumbnail
  });
  return sock.sendMessage(m.chat, { audio: audioBuffer, mimetype, ptt, fileName, contextInfo: getNewsletterContext(m, options) }, { quoted });
}

// ===== Send Native Trolley Reply (Interactive) =====
async function sendNativeTrolleyReply(sock, m, { body = '', footer = '', title = '', buttons = null, headerImage = null } = {}, options = {}) {
  const { saluranId, saluranName, saluranLink } = getSaluranInfo();
  const nativeButtons = buttons || createDefaultNativeButtons(m, options);

  const interactive = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      hasMediaAttachment: false,
      title: title || getBotName()
    }),
    body: proto.Message.InteractiveMessage.Body.create({ text: String(body || '') }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: String(footer || `☁︎ ${getBotName()}`) }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: nativeButtons,
      messageParamsJson: JSON.stringify({
        limited_time_offer: {
          text: options.offerText || `${getBotName()} • Menu`,
          url: options.offerUrl || saluranLink,
          copy_code: options.copyCode || getBotName(),
          expiration_time: Date.now() + 86400000
        },
        bottom_sheet: {
          in_thread_buttons_limit: options.inThreadLimit || 2,
          divider_indices: options.dividerIndices || [1, 2, 999],
          list_title: options.listTitle || 'Silahkan pilih menu',
          button_title: options.buttonTitle || '☁︎ Buka Menu'
        },
        tap_target_configuration: {
          title: options.tapTitle || 'Menu Center',
          description: options.tapDescription || getBotName(),
          canonical_url: options.canonicalUrl || PORTFOLIO_ADMIN,
          domain: options.domain || 'ryuuzaa.site',
          button_index: options.buttonIndex || 0
        }
      })
    }),
    contextInfo: {
      mentionedJid: options.mentionedJid || (m?.sender ? [m.sender] : []),
      forwardingScore: 9,
      isForwarded: true,
      forwardedNewsletterMessageInfo: { newsletterJid: saluranId, newsletterName: saluranName, serverMessageId: 127 }
    }
  });

  const quoted = options.quoted || await createFakeTrolleyQuoted(m, sock, {
    title: options.quotedTitle || `☁︎ ${getBotName()}`,
    message: options.quotedMessage || `• ${getBotName()}\n• Pesan interaktif`,
    itemCount: options.itemCount || 1, thumbnail: options.thumbnail
  });

  const msg = generateWAMessageFromContent(m.chat, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: interactive
      }
    }
  }, { quoted });

  await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
  return msg;
}

// ===== Progress Helpers =====
async function sendProgress(sock, m, text, options = {}) {
  return sendTrolleyText(sock, m, text, {
    title: options.title || '☁︎ Progress Command',
    message: options.message || '• Progress berjalan\n• Pesan ini akan diperbarui',
    itemCount: options.itemCount || 3,
    ...options
  });
}

async function editProgress(sock, m, progressMsg, text) {
  if (!progressMsg?.key) return null;
  try { return await sock.sendMessage(m.chat, { text: String(text || ''), edit: progressMsg.key }); }
  catch { return null; }
}

async function updateProgress(sock, m, progressMsg, text) {
  return editProgress(sock, m, progressMsg, text);
}

async function finishProgress(sock, m, progressMsg, text, options = {}) {
  const edited = await editProgress(sock, m, progressMsg, text);
  if (edited) return edited;
  return sendTrolleyText(sock, m, text, {
    title: options.title || '✅ Proses Selesai',
    message: options.message || '• Command selesai\n• Hasil sudah dikirim',
    itemCount: options.itemCount || 1,
    ...options
  });
}

// ===== Safe Styled Reply (fallback ke reply biasa) =====
async function safeStyledReply(sock, m, text, options = {}) {
  try {
    if (options.native) {
      return await sendNativeTrolleyReply(sock, m, {
        body: text, footer: options.footer || `☁︎ ${getBotName()}`,
        title: options.title || getBotName(), buttons: options.buttons, headerImage: options.headerImage
      }, options);
    }
    return await sendTrolleyText(sock, m, text, options);
  } catch {
    return sock.sendMessage(m.chat, { text: String(text || '') }, { quoted: m });
  }
}

// ===== Exports =====
module.exports = {
  buildAwanText,
  getNewsletterContext,
  createFakeTrolleyQuoted,
  createFakeContactQuoted,
  createFakePaymentQuoted,
  createDefaultNativeButtons,
  sendTrolleyText,
  sendTrolleyImage,
  sendTrolleyDocument,
  sendTrolleyAudio,
  sendNativeTrolleyReply,
  sendProgress,
  editProgress,
  updateProgress,
  finishProgress,
  safeStyledReply,
  getUserThumb,
  resizeThumb,
  getBotName,
  getSaluranInfo,
  getSellerJid
};
