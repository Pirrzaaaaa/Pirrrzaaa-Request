# BlackRose WhatsApp Bot

WhatsApp Bot berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) dengan struktur **BlackRose-style** yang fleksibel:

- ✅ **Case handler** (`case.js`) — gaya legacy `switch/case`
- ✅ **Plugin system** — mendukung **CommonJS (`.cjs`)**, **ESM (`.mjs`)**, dan **JS biasa (`.js`)**
- ✅ **Hot reload** — edit/tambah/hapus plugin tanpa restart
- ✅ **Database SQLite** (`better-sqlite3`) — users, groups, settings
- ✅ **Auto restart** dari `index.js`
- ✅ **Pairing code** & **QR code** login
- ✅ **Group event** (welcome, leave, promote, demote)

---

## Struktur Project

```
wa-bot-blackrose/
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
git clone <repo-url> wa-bot-blackrose
cd wa-bot-blackrose
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

**Dengan QR code (default):**

```bash
npm start
```

**Dengan Pairing Code (tanpa scan QR):**

```bash
node index.js --pairing
```

Setelah login, session disimpan di folder `./session/` agar tidak perlu login ulang.

---

## Membuat Plugin Baru

### Format CommonJS (`.cjs` atau `.js`)

```js
// plugins/halo.js
module.exports = {
  command : ['halo', 'hello'],
  category: 'tools',
  desc    : 'Sapa bot',
  group   : false,   // true = hanya di grup
  admin   : false,   // true = hanya admin grup
  owner   : false,   // true = hanya owner
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

## Context (`ctx`) yang tersedia di handler

| Property      | Tipe        | Keterangan                                    |
| ------------- | ----------- | --------------------------------------------- |
| `sock`        | object      | Instance Baileys socket                       |
| `m`           | object      | Pesan yang sudah di-serialize                 |
| `body`        | string      | Teks pesan                                    |
| `args`        | string[]    | Argumen setelah command                       |
| `text`        | string      | Argumen di-join spasi                         |
| `command`     | string      | Nama command (lowercase)                      |
| `usedPrefix`  | string      | Prefix yang dipakai user                      |
| `isOwner`     | boolean     | Sender adalah owner                           |
| `isAdmin`     | boolean     | Sender adalah admin grup                      |
| `isBotAdmin`  | boolean     | Bot adalah admin grup                         |
| `db`          | Database    | Akses SQLite                                  |
| `reply(text)` | function    | Kirim balasan teks                            |
| `react(emoji)`| function    | Reaksi ke pesan                               |

`m.quoted` (jika ada): pesan yang di-reply, lengkap dengan `m.quoted.download()`.

---

## Database

Tiga tabel default: `users`, `groups`, `settings`.

Contoh penggunaan:

```js
db.ensureUser(m.sender, m.pushName);
db.addExp(m.sender, 25);
db.addMoney(m.sender, 1000);

db.setSetting('foo', 'bar');
const v = db.getSetting('foo');

const stats = db.stats(); // { users, groups }
```

File DB disimpan di `./database/database.sqlite` (otomatis dibuat).

---

## Case Handler

Edit `case.js` untuk command sederhana:

```js
case 'halo':
  await reply('Halo!');
  return true;  // <- return true = hentikan pipeline (skip plugin)
```

Bila `return false`/tidak return, eksekusi lanjut ke plugins.

---

## Lisensi

MIT © Pirrzaaaaa
