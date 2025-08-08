// server.js - Mon Billet (minimal edition)
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');
const { customAlphabet } = require('nanoid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const CALLMEBOT_KEY = process.env.CALLMEBOT_KEY || '';
const SUPERADMIN_PHONE = process.env.SUPERADMIN_PHONE || '+237680371957';

const db = new sqlite3.Database('./monbillet.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    type TEXT,
    name TEXT,
    surname TEXT,
    phones TEXT,
    created_at INTEGER,
    used INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    date TEXT,
    created_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    role TEXT
  )`);
});

const nano = customAlphabet('0123456789', 6);

async function sendWhatsApp(phone, text) {
  try {
    const encoded = encodeURIComponent(text);
    if (CALLMEBOT_KEY) {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${CALLMEBOT_KEY}`;
      const resp = await axios.get(url, { timeout: 15000 });
      return resp.data;
    } else {
      const waUrl = `https://wa.me/${phone.replace(/\+/g, '')}?text=${encoded}`;
      return { info: 'no_key', waUrl };
    }
  } catch (e) {
    console.error('sendWhatsApp error', e.message);
    return { error: e.message };
  }
}

async function generateDailyAdminCodes() {
  const date = new Date().toISOString().slice(0,10);
  const codes = [];
  for (let i=0;i<5;i++){
    const c = nano();
    codes.push(c);
    db.run('INSERT INTO admin_codes (code, date, created_at) VALUES (?,?,?)', [c, date, Date.now()]);
  }
  const message = `🔐 Codes admin pour ${date}:\n` + codes.join(' - ');
  const send = await sendWhatsApp(SUPERADMIN_PHONE, message);
  console.log('Daily admin codes sent:', send);
  return { date, codes, send };
}

app.post('/api/generate-daily-codes', async (req,res)=>{
  try {
    const r = await generateDailyAdminCodes();
    res.json({ ok: true, result: r });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.get('/api/daily-codes', (req,res)=>{
  db.all('SELECT id, code, date, created_at FROM admin_codes ORDER BY created_at DESC LIMIT 100', (err, rows)=>{
    if (err) return res.status(500).json({ ok:false, error: err.message });
    res.json({ ok:true, codes: rows });
  });
});

app.post('/api/tickets', (req,res)=>{
  const { code, type, name, surname, phones } = req.body;
  db.run('INSERT INTO tickets (code,type,name,surname,phones,created_at,used,active) VALUES (?,?,?,?,?,?,0,1)',
    [code, type, name, surname, JSON.stringify(phones), Date.now()],
    function(err){
      if (err) return res.status(500).json({ ok:false, error: err.message });
      res.json({ ok:true, id: this.lastID });
    });
});

app.get('/api/tickets', (req,res)=>{
  db.all('SELECT id, code, type, name, surname, phones, created_at, used, active FROM tickets ORDER BY created_at DESC LIMIT 1000', (err, rows)=>{
    if (err) return res.status(500).json({ ok:false, error: err.message });
    const data = rows.map(r => ({ ...r, phones: JSON.parse(r.phones || '[]') }));
    res.json({ ok:true, tickets: data });
  });
});

app.post('/api/deactivate-ticket', (req,res)=>{
  const { code } = req.body;
  db.run('UPDATE tickets SET active=0 WHERE code=?', [code], function(err){
    if (err) return res.status(500).json({ ok:false, error: err.message });
    res.json({ ok:true, changed: this.changes });
  });
});

app.post('/api/double-scan', (req,res)=>{
  const { code } = req.body;
  const msg = `⚠️ Double scan détecté pour le billet : ${code}`;
  sendWhatsApp(SUPERADMIN_PHONE, msg).then(r=>{
    res.json({ ok:true, sent: r });
  }).catch(e=>{
    res.status(500).json({ ok:false, error: e.message });
  });
});

app.get('/admin', (req,res)=>{
  res.sendFile(__dirname + '/admin.html');
});

cron.schedule('0 0 * * *', async () => {
  console.log('Running daily admin code generation job...');
  await generateDailyAdminCodes();
});

const os = require('os');

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let iface in interfaces) {
        for (let alias of interfaces[iface]) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

app.listen(PORT, () => {
    const ip = getLocalIP();
    console.log(`✅ Server is running!`);
    console.log(`🌍 Local:   http://localhost:${PORT}`);
    console.log(`📡 Network: http://${ip}:${PORT}`);
});
