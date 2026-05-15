/**
 * plugins/owner-broadcast.js — broadcast ke semua chat (owner only)
 * Penggunaan: .bc <pesan>  (atau reply media + .bc)
 */
module.exports = {
  command : ['bc', 'broadcast'],
  category: 'owner',
  desc    : 'Broadcast pesan ke semua chat (owner)',
  owner   : true,
  handler : async ({ sock, m, text, reply }) => {
    if (!text) return reply('Contoh: .bc Halo semua!');
    const chats = await sock.groupFetchAllParticipating().catch(() => ({}));
    const ids = Object.keys(chats);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await sock.sendMessage(id, { text: `📢 *Broadcast*\n\n${text}` });
        ok++;
      } catch (_) { fail++; }
    }
    await reply(`✅ Broadcast selesai\nSukses: ${ok}\nGagal : ${fail}`);
  }
};
