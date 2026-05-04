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
    console.error("EMAIL ERROR:", error);
    res.status(500).json({ message: error.message });
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
    console.error("FOLLOW-UP ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

app.post('/generate-message', (req, res) => {
  const { clientName, role } = req.body;

  const message = `Hi ${clientName},

I noticed your business and wanted to offer a reliable remote ${role}.

We provide pre-trained remote workers ready to help with customer support, admin, and operations.

Let me know if you're interested.

Best regards`;

  res.json({ message });
});

app.get('/auto-clients', (req, res) => {
  clients = readJSON(CLIENTS_FILE);

  const sampleLeads = [
    { name: "Shopify Store Alpha", role: "VA", email: "store1@gmail.com" },
    { name: "Ecom Brand Beta", role: "Customer Support", email: "store2@gmail.com" },
    { name: "Dropshipping Pro", role: "VA", email: "store3@gmail.com" }
  ];

  let added = 0;

  sampleLeads.forEach(lead => {
    const exists = clients.some(c =>
      c.email && c.email.toLowerCase() === lead.email.toLowerCase()
    );

    if (!exists) {
      clients.push({
        ...lead,
        id: Date.now() + Math.random(),
        createdAt: new Date().toISOString(),
        status: "New",
        followUpStage: 0
      });
      added++;
    }
  });

  saveJSON(CLIENTS_FILE, clients);

  res.json({
    message: "Auto clients added",
    count: added,
    totalClients: clients.length
  });
});

app.post('/import-clients-csv', (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv) {
      return res.status(400).json({ message: "No CSV provided" });
    }

    clients = readJSON(CLIENTS_FILE);

    const lines = csv.trim().split("\n");
    const imported = [];

    lines.slice(1).forEach(line => {
      const [name, role, email] = line.split(",").map(x => x.trim());

      if (name && role && email) {
        const exists = clients.some(c =>
          c.email && c.email.toLowerCase() === email.toLowerCase()
        );

        if (!exists) {
          const client = {
            id: Date.now() + Math.random(),
            name,
            role,
            email,
            status: "New",
            followUpStage: 0,
            createdAt: new Date().toISOString()
          };

          clients.push(client);
          imported.push(client);
        }
      }
    });

    saveJSON(CLIENTS_FILE, clients);

    res.json({
      message: "CSV clients imported",
      imported: imported.length,
      totalClients: clients.length
    });

  } catch (error) {
    res.status(500).json({ message: "CSV import failed", error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));