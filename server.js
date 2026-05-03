require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===== FILE PATHS =====
const DATA_DIR = path.join(__dirname, 'data');
const APPLICANTS_FILE = path.join(DATA_DIR, 'applicants.json');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ===== HELPERS =====
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

// ===== SCORING =====
function scoreApplicant(a) {
  let score = 0;
  if (a.internet === "good") score += 20;
  if (a.english === "good") score += 20;
  if (a.experience === "yes") score += 25;
  if (a.tools === "yes") score += 20;
  if (a.available === "yes") score += 15;
  return score;
}

// ===== ROUTES =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== APPLICANTS =====
app.post('/add-applicant', (req, res) => {
  const data = req.body;
  data.id = Date.now();
  data.score = scoreApplicant(data);
  data.createdAt = new Date().toISOString();

  applicants.push(data);
  saveJSON(APPLICANTS_FILE, applicants);

  res.json({ message: "Applicant added", score: data.score });
});

app.get('/applicants', (req, res) => res.json(applicants));

// ===== CLIENTS =====
app.post('/add-client', (req, res) => {
  const data = req.body;
  data.id = Date.now();
  data.createdAt = new Date().toISOString();
  data.status = "New";
  data.followUpStage = 0;

  clients.push(data);
  saveJSON(CLIENTS_FILE, clients);

  res.json({ message: "Client added" });
});

app.get('/clients', (req, res) => res.json(clients));

// ===== EMAIL HISTORY =====
app.get('/emails', (req, res) => res.json(emails));

// ===== MATCHING =====
app.get('/match', (req, res) => {
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

// ===== EMAIL SYSTEM =====
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
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

// ===== SEND FIRST EMAIL =====
app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, text, clientName } = req.body;

    await sendMail(to, subject, text);

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
    console.error("EMAIL ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ===== FOLLOW-UP =====
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
    console.error("FOLLOW-UP ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ===== AI MESSAGE =====
app.post('/generate-message', (req, res) => {
  const { clientName, role } = req.body;

  const message = `Hi ${clientName},

I noticed your business and wanted to offer a reliable remote ${role}.

We provide pre-trained remote workers ready to help with customer support, admin, and operations.

Let me know if you're interested.

Best regards`;

  res.json({ message });
});

// ===== AUTO CLIENT FINDER =====
app.get('/auto-clients', (req, res) => {

  const sampleLeads = [
    { name: "Shopify Store Alpha", role: "VA", email: "store1@gmail.com" },
    { name: "Ecom Brand Beta", role: "Customer Support", email: "store2@gmail.com" },
    { name: "Dropshipping Pro", role: "VA", email: "store3@gmail.com" }
  ];

  sampleLeads.forEach(lead => {
    lead.id = Date.now() + Math.random();
    lead.createdAt = new Date().toISOString();
    lead.status = "New";
    lead.followUpStage = 0;
    clients.push(lead);
  });

  saveJSON(CLIENTS_FILE, clients);

  res.json({ message: "Auto clients added", count: sampleLeads.length });
});

// ===== START SERVER =====
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));