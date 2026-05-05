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

let clients = readJSON(CLIENTS_FILE);
let emails = readJSON(EMAILS_FILE);

console.log("MAILTRAP_USER loaded:", process.env.MAILTRAP_USER ? "YES" : "NO");
console.log("MAILTRAP_PASS loaded:", process.env.MAILTRAP_PASS ? "YES" : "NO");

const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

async function sendMail(to, subject, text) {
  await transporter.sendMail({
    from: "test@mailtrap.io",
    to,
    subject,
    text
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/add-client', (req, res) => {
  clients = readJSON(CLIENTS_FILE);

  const { name, role, email } = req.body;

  if (!name || !role || !email) {
    return res.status(400).json({ message: "Missing fields" });
  }

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
  clients = readJSON(CLIENTS_FILE);
  res.json(clients);
});

app.post('/import-clients-csv', (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv) {
      return res.json({ message: "No CSV provided", imported: 0 });
    }

    clients = readJSON(CLIENTS_FILE);

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

  } catch (error) {
    console.log("CSV ERROR:", error);
    res.status(500).json({
      message: "CSV import failed",
      imported: 0,
      error: error.message
    });
  }
});

app.get('/emails', (req, res) => {
  emails = readJSON(EMAILS_FILE);
  res.json(emails);
});

async function sendAutoEmails() {
  clients = readJSON(CLIENTS_FILE);
  emails = readJSON(EMAILS_FILE);

  if (!process.env.MAILTRAP_USER || !process.env.MAILTRAP_PASS) {
    throw new Error("Mailtrap credentials missing in Render Environment");
  }

  const targets = clients.filter(c => c.status === "New" && c.email);

  let sent = 0;

  for (const client of targets) {
    await sendMail(
      client.email,
      "Remote staffing support",
      `Hi ${client.name},

We provide trained remote staff for your business.

Let me know if you're interested.

Best regards`
    );

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
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  return {
    message: "Auto email run completed",
    sent
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