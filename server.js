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
    createdAt: new Date().toISOString(),
    lastEmailAt: null
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
          createdAt: new Date().toISOString(),
          lastEmailAt: null
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

  let sent = 0;
  let failed = 0;

  for (const client of clients) {
    if (!client.email) continue;
    if (client.status === "Replied" || client.status === "Closed") continue;

    const lastEmailAt = client.lastEmailAt || client.createdAt;
    const daysSinceLastEmail = (Date.now() - new Date(lastEmailAt)) / (1000 * 60 * 60 * 24);

    let subject = "";
    let text = "";
    let emailType = "";

    if (client.followUpStage === 0 || client.status === "New") {
      subject = "Quick question";
      text = `Hi ${client.name},

Quick question — are you currently hiring any remote staff?

I help businesses find trained VAs and support agents.

Happy to share options if you're open.

Best,
Emerson`;
      emailType = "Initial Email";
    } else if (client.followUpStage === 1 && daysSinceLastEmail >= 2) {
      subject = "Just following up";
      text = `Hi ${client.name},

Just wanted to follow up on my previous message.

Are you open to seeing one or two trained remote candidates?

Best,
Emerson`;
      emailType = "Follow-up 1";
    } else if (client.followUpStage === 2 && daysSinceLastEmail >= 5) {
      subject = "Last follow-up";
      text = `Hi ${client.name},

Just checking one last time.

If you're not looking for remote support right now, no worries at all.

Best,
Emerson`;
      emailType = "Follow-up 2";
    } else {
      continue;
    }

    const ok = await sendMail(client.email, subject, text);

    if (ok) {
      client.status = client.followUpStage === 0 ? "Contacted" : `Follow-up ${client.followUpStage} Sent`;
      client.followUpStage = client.followUpStage + 1;
      client.lastEmailAt = new Date().toISOString();

      emails.push({
        id: Date.now() + Math.random(),
        type: emailType,
        clientName: client.name,
        to: client.email,
        subject,
        text,
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