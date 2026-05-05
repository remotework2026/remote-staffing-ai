require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = "digitaltrading76@gmail.com"; // CHANGE THIS

console.log("SENDGRID_API_KEY loaded:", process.env.SENDGRID_API_KEY ? "YES" : "NO");
console.log("FROM_EMAIL:", FROM_EMAIL);

const DATA_DIR = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

async function sendMail(to, subject, text) {
  const msg = {
    to,
    from: FROM_EMAIL,
    subject,
    text
  };

  try {
    await sgMail.send(msg);
    console.log("✅ EMAIL SENT TO:", to);
    return true;
  } catch (err) {
    console.log("❌ SENDGRID ERROR:");
    console.log(err.response?.body || err.message);
    return false;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/add-client', (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const { name, role, email } = req.body;

  clients.push({
    id: Date.now() + Math.random(),
    name,
    role,
    email,
    status: "New",
    followUpStage: 0,
    createdAt: new Date().toISOString()
  });

  saveJSON(CLIENTS_FILE, clients);
  res.json({ message: "Client added" });
});

app.get('/clients', (req, res) => {
  res.json(readJSON(CLIENTS_FILE));
});

app.post('/import-clients-csv', (req, res) => {
  const { csv } = req.body;
  const clients = readJSON(CLIENTS_FILE);

  if (!csv) {
    return res.json({ message: "No CSV provided", imported: 0 });
  }

  const lines = csv.trim().split("\n");
  let imported = 0;

  lines.slice(1).forEach(line => {
    const [name, role, email] = line.split(",").map(x => x.trim());

    if (name && role && email) {
      const exists = clients.some(c => c.email && c.email.toLowerCase() === email.toLowerCase());

      if (!exists) {
        clients.push({
          id: Date.now() + Math.random(),
          name,
          role,
          email,
          status: "New",
          followUpStage: 0,
          createdAt: new Date().toISOString()
        });
        imported++;
      }
    }
  });

  saveJSON(CLIENTS_FILE, clients);
  res.json({ message: "CSV imported", imported });
});

app.get('/emails', (req, res) => {
  res.json(readJSON(EMAILS_FILE));
});

async function sendAutoEmails() {
  const clients = readJSON(CLIENTS_FILE);
  const emails = readJSON(EMAILS_FILE);

  if (!process.env.SENDGRID_API_KEY) {
    throw new Error("SendGrid API key missing");
  }

  const targets = clients.filter(c => c.status === "New" && c.email);
  let sent = 0;
  let failed = 0;

  for (const client of targets) {
    const ok = await sendMail(
      client.email,
      "Remote staffing support",
      `Hi ${client.name},

We provide trained remote staff for your business.

Let me know if you're interested.

Best regards`
    );

    if (ok) {
      client.status = "Contacted";

      emails.push({
        id: Date.now() + Math.random(),
        type: "Auto Email",
        clientName: client.name,
        to: client.email,
        subject: "Remote staffing support",
        sentAt: new Date().toISOString()
      });

      sent++;
    } else {
      failed++;
    }
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  return {
    message: "Auto email run completed",
    sent,
    failed
  };
}

app.post('/run-auto-emails', async (req, res) => {
  try {
    const result = await sendAutoEmails();
    res.json(result);
  } catch (error) {
    console.log("AUTO EMAIL ERROR:", error.message);
    res.status(500).json({
      message: "Auto email failed",
      error: error.message,
      sent: 0
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});