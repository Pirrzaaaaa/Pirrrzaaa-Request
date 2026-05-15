/**
 * lib/group-event.js — Welcome / leave handler
 * Aktifkan dengan command `.welcome on` (lihat plugins/group-welcome.js)
 */
module.exports = async function groupEvent(sock, update) {
  try {
    const { id, participants, action } = update;
    const g = global.db.getGroup(id);
    if (!g || !g.welcome) return;

    let metadata;
    try { metadata = await sock.groupMetadata(id); } catch (_) { metadata = { subject: 'Group' }; }

    for (const jid of participants) {
      const tag = '@' + jid.split('@')[0];
      let text = '';
      if (action === 'add')      text = `👋 Halo ${tag}, selamat datang di *${metadata.subject}*!`;
      else if (action === 'remove') text = `👋 Selamat tinggal ${tag}.`;
      else if (action === 'promote') text = `🎉 ${tag} sekarang admin.`;
      else if (action === 'demote')  text = `📉 ${tag} bukan admin lagi.`;
      if (text) await sock.sendMessage(id, { text, mentions: [jid] });
    }
  } catch (_) {}
};
