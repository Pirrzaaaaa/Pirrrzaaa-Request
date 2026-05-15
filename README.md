# Ryuuzaa MD

WhatsApp Bot berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) yang fleksibel:

- ✅ **Case handler** (`case.js`) — gaya legacy `switch/case`
- ✅ **Plugin system** — mendukung **CommonJS (`.cjs`)**, **ESM (`.mjs`)**, dan **JS biasa (`.js`)**
- ✅ **Hot reload** — edit/tambah/hapus plugin tanpa restart
- ✅ **Database SQLite** (`better-sqlite3`) — users, groups, settings
- ✅ **Auto restart** dari `index.js`
- ✅ **Pairing code** & **QR code** login
- ✅ **Scheduled restart** (setiap 6 jam)
- ✅ **File watcher** (auto-restart saat config/main/handler berubah)
- ✅ **Plugin report** (tampil di console saat boot)
- ✅ **Group event** (welcome, leave, promote, demote)

---

## Struktur Project

```
ryuuzaa-md/
├── index.js              # Auto-restart wrapper
├── main.js               # Core (Baileys connect + load plugins + handler)
├── handler.js            # Pipeline pesan: case -> plugins
├── case.js               # Case-style handler
├── config.js             # Konfigurasi global (owner, prefix, dll)
├── package.json
├── lib/
│   ├── database.js       # Wrapper SQLite
│   ├── plugin-loader.js  # Loader CJS + ESM + hot reload
│   ├── serialize.js      # Pembungkus pesan Baileys
│   └── group-event.js    # Handler welcome/leave
└── plugins/
    ├── _template.js      # (diabaikan loader, contoh saja)
    ├── ping.cjs          # Plugin format CommonJS
    ├── info.mjs          # Plugin format ESM
    ├── menu.js           # Auto-generate menu
    ├── profile.js        # Profile + daily reward (DB)
    ├── sticker.js        # Image/video -> sticker
    ├── group-admin.js    # kick / promote / demote (multi-export)
    ├── group-welcome.js  # Toggle welcome message
    └── owner-broadcast.js
```

---

## Instalasi

```bash
git clone <repo-url> ryuuzaa-md
cd ryuuzaa-md
npm install
```

Edit `config.js` — minimal isi nomor owner kamu:

```js
global.owner = [
  ['62812xxxxxxxx', 'NamaKamu', true]
];
```

---

## Menjalankan

**Dengan Pairing Code (default):**

```bash
npm start
```

**Dengan QR Code:**

Ubah di `config.js`:
```js
global.connectionMode = 'qr';
```

Lalu jalankan:
```bash
npm start
```

---

## Membuat Plugin Baru

### Format CommonJS (`.cjs` atau `.js`)

```js
// plugins/halo.js
module.exports = {
  command : ['halo', 'hello'],
  category: 'tools',
  desc    : 'Sapa bot',
  handler : async ({ reply, m }) => {
    await reply(`Halo ${m.pushName}!`);
  }
};
```

### Format ESM (`.mjs`)

```js
// plugins/halo.mjs
export default {
  command : 'halo',
  handler : async (ctx) => {
    await ctx.reply('Halo dari ESM!');
  }
};
```

### Multi-command dalam satu file

Export array:

```js
module.exports = [
  { command: 'a', handler: async (c) => c.reply('A') },
  { command: 'b', handler: async (c) => c.reply('B') }
];
```

> File yang diawali `_` akan **diabaikan** loader (cocok untuk template).

---

## Database

Tiga tabel default: `users`, `groups`, `settings`.

```js
db.ensureUser(m.sender, m.pushName);
db.addExp(m.sender, 25);
db.addMoney(m.sender, 1000);
db.setSetting('foo', 'bar');
const stats = db.stats(); // { users, groups }
```

File DB disimpan di `./database/database.sqlite` (otomatis dibuat).

---

## Lisensi

MIT
