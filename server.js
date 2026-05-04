require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, 'data');
const APPLICANTS_FILE = path.join(DATA_DIR, 'applicants.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

let applicants = readJSON(APPLICANTS_FILE);
let clients = readJSON(CLIENTS_FILE);
let emails = readJSON(EMAILS_FILE);

function scoreApplicant(a) {
  let score = 0;
  if (a.internet === "good") score += 20;
  if (a.english === "good") score += 20;
  if (a.experience === "yes") score += 25;
  if (a.tools === "yes") score += 20;
  if (a.available === "yes") score += 15;
  return score;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/add-applicant', (req, res) => {
  applicants = readJSON(APPLICANTS_FILE);

  const data = req.body;
  data.id = Date.now();
  data.score = scoreApplicant(data);
  data.createdAt = new Date().toISOString();

  applicants.push(data);
  saveJSON(APPLICANTS_FILE, applicants);

  res.json({ message: "Applicant added", score: data.score });
});

app.get('/applicants', (req, res) => {
  applicants = readJSON(APPLICANTS_FILE);
  res.json(applicants);
});

app.post('/add-client', (req, res) => {
  clients = readJSON(CLIENTS_FILE);

  const data = req.body;
  data.id = Date.now();
  data.createdAt = new Date().toISOString();
  data.status = "New";
  data.followUpStage = 0;

  clients.push(data);
  saveJSON(CLIENTS_FILE, clients);

  res.json({ message: "Client added" });
});

app.get('/clients', (req, res) => {
  clients = readJSON(CLIENTS_FILE);
  res.json(clients);
});

app.get('/emails', (req, res) => {
  emails = readJSON(EMAILS_FILE);
  res.json(emails);
});

app.get('/match', (req, res) => {
  applicants = readJSON(APPLICANTS_FILE);
  clients = readJSON(CLIENTS_FILE);

  const matches = clients.map(client => {
    const best = applicants
      .filter(a =>
        a.role &&
        client.role &&
        a.role.toLowerCase().trim() === client.role.toLowerCase().trim()
      )
      .sort((a, b) => b.score - a.score)[0];

    return { client, best: best || null };
  });

  res.json(matches);
});


// ✅ FIXED SMTP CONFIG (IMPORTANT)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendMail(to, subject, text) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text
  });
}

app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, text, clientName } = req.body;

    await sendMail(to, subject, text);

    emails = readJSON(EMAILS_FILE);
    clients = readJSON(CLIENTS_FILE);

    emails.push({
      id: Date.now(),
      type: "Initial Email",
      clientName,
      to,
      subject,
      text,
      sentAt: new Date().toISOString()
    });

    clients = clients.map(c => {
      if (c.name && clientName && c.name.toLowerCase() === clientName.toLowerCase()) {
        return {
          ...c,
          email: to,
          status: "Contacted",
          followUpStage: 1
        };
      }
      return c;
    });

    saveJSON(EMAILS_FILE, emails);
    saveJSON(CLIENTS_FILE, clients);

    res.json({ message: "Email sent" });

  } catch (error) {
    console.log("EMAIL ERROR:", error);
    res.status(500).json({ message: "Email failed", error: error.message });
  }
});

app.post('/send-followup', async (req, res) => {
  try {
    const { to, clientName, role } = req.body;

    const subject = `Follow-up about remote ${role}`;
    const text = `Hi ${clientName},

Just following up on my previous message.

We provide trained remote ${role}s ready to support your business.

Let me know if you're interested.

Best regards`;

    await sendMail(to, subject, text);

    emails = readJSON(EMAILS_FILE);

    emails.push({
      id: Date.now(),
      type: "Follow-up",
      clientName,
      to,
      subject,
      text,
      sentAt: new Date().toISOString()
    });

    saveJSON(EMAILS_FILE, emails);

    res.json({ message: "Follow-up sent" });

  } catch (error) {
    console.log("FOLLOW-UP ERROR:", error);
    res.status(500).json({ message: "Follow-up failed", error: error.message });
  }
});

app.post('/generate-message', (req, res) => {
  const { clientName, role } = req.body;

  const message = `Hi ${clientName},

I noticed your business and wanted to offer a reliable remote ${role}.

We provide pre-trained remote workers ready to help with customer support and operations.

Let me know if you're interested.

Best regards`;

  res.json({ message });
});

app.get('/auto-clients', (req, res) => {
  clients = readJSON(CLIENTS_FILE);

  const sampleLeads = [
    { name: "Shopify Store Alpha", role: "VA", email: "store1@gmail.com" },
    { name: "Ecom Brand Beta", role: "Customer Support", email: "store2@gmail.com" }
  ];

  sampleLeads.forEach(lead => {
    const exists = clients.some(c => c.email === lead.email);
    if (!exists) {
      clients.push({
        ...lead,
        id: Date.now(),
        status: "New",
        followUpStage: 0
      });
    }
  });

  saveJSON(CLIENTS_FILE, clients);

  res.json({ message: "Auto clients added" });
});

app.post('/import-clients-csv', (req, res) => {
  const { csv } = req.body;
  clients = readJSON(CLIENTS_FILE);

  const lines = csv.trim().split("\n");

  lines.slice(1).forEach(line => {
    const [name, role, email] = line.split(",");

    clients.push({
      id: Date.now() + Math.random(),
      name,
      role,
      email,
      status: "New",
      followUpStage: 0
    });
  });

  saveJSON(CLIENTS_FILE, clients);

  res.json({ message: "CSV imported" });
});

async function sendAutoEmails() {
  clients = readJSON(CLIENTS_FILE);
  emails = readJSON(EMAILS_FILE);

  const targets = clients.filter(c => c.status === "New");

  let sent = 0;

  for (const client of targets) {
    await sendMail(
      client.email,
      "Remote staffing support",
      `Hi ${client.name}, we offer skilled remote staff.`
    );

    client.status = "Contacted";

    emails.push({
      type: "Auto Initial Email",
      clientName: client.name,
      to: client.email,
      sentAt: new Date().toISOString()
    });

    sent++;
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  return { message: "Auto email run completed", sent };
}

app.post('/run-auto-emails', async (req, res) => {
  try {
    const result = await sendAutoEmails();
    res.json(result);
  } catch (error) {
    console.log("AUTO EMAIL ERROR:", error);
    res.status(500).json({ message: "Auto email failed", sent: 0 });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));