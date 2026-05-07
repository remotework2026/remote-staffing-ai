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

// =====================
// SENDGRID
// =====================
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = "digitaltrading76@gmail.com"; // CHANGE THIS

console.log("SENDGRID_API_KEY loaded:", process.env.SENDGRID_API_KEY ? "YES" : "NO");
console.log("FROM_EMAIL:", FROM_EMAIL);

// =====================
// DATA FILES
// =====================
const DATA_DIR = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const CLIENT_FORM_CSV = path.join(DATA_DIR, 'client_form_submissions.csv');
const APPLICANT_FORM_CSV = path.join(DATA_DIR, 'applicant_form_submissions.csv');

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

function appendCSV(file, headers, row) {
  const exists = fs.existsSync(file);

  if (!exists) {
    fs.writeFileSync(file, headers.join(",") + "\n");
  }

  const cleanRow = row.map(value =>
    `"${String(value || "").replace(/"/g, '""')}"`
  );

  fs.appendFileSync(file, cleanRow.join(",") + "\n");
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
    console.log("EMAIL SENT TO:", to);
    return true;
  } catch (err) {
    console.log("SENDGRID ERROR:", err.response?.body || err.message);
    return false;
  }
}

// =====================
// BASIC PAGES
// =====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// =====================
// CRM CLIENTS
// =====================
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
    lastEmailAt: null,
    repliedAt: null
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

  if (!csv) return res.json({ message: "No CSV", imported: 0 });

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
          lastEmailAt: null,
          repliedAt: null
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

app.post('/mark-replied', (req, res) => {
  const { email } = req.body;
  const clients = readJSON(CLIENTS_FILE);

  let updated = false;

  const updatedClients = clients.map(client => {
    if (client.email && email && client.email.toLowerCase() === email.toLowerCase()) {
      updated = true;
      return {
        ...client,
        status: "Replied",
        repliedAt: new Date().toISOString()
      };
    }

    return client;
  });

  saveJSON(CLIENTS_FILE, updatedClients);

  res.json({
    message: updated ? "Client marked as replied" : "Client not found",
    updated
  });
});

// =====================
// LANDING PAGE FORMS
// =====================
app.post('/submit-client-form', (req, res) => {
  const { name, company, email, phone, role, message } = req.body;

  appendCSV(
    CLIENT_FORM_CSV,
    ["date", "name", "company", "email", "phone", "needed_role", "message"],
    [new Date().toISOString(), name, company, email, phone, role, message]
  );

  const clients = readJSON(CLIENTS_FILE);

  clients.push({
    id: Date.now() + Math.random(),
    name: company || name,
    contactName: name,
    role,
    email,
    phone,
    message,
    status: "New",
    followUpStage: 0,
    createdAt: new Date().toISOString(),
    lastEmailAt: null,
    repliedAt: null,
    source: "Landing Client Form"
  });

  saveJSON(CLIENTS_FILE, clients);

  res.json({ message: "Client form saved" });
});

app.post('/submit-applicant-form', (req, res) => {
  const { name, email, phone, role, experience, internet, english } = req.body;

  appendCSV(
    APPLICANT_FORM_CSV,
    ["date", "name", "email", "phone", "role", "experience", "internet", "english"],
    [new Date().toISOString(), name, email, phone, role, experience, internet, english]
  );

  res.json({ message: "Applicant form saved" });
});

// =====================
// AUTO EMAILS + FOLLOW UPS
// =====================
async function sendAutoEmails() {
  const clients = readJSON(CLIENTS_FILE);
  const emails = readJSON(EMAILS_FILE);

  let sent = 0;

  for (const client of clients) {
    if (!client.email) continue;
    if (client.status === "Replied" || client.status === "Closed") continue;

    const last = client.lastEmailAt || client.createdAt;
    const days = (Date.now() - new Date(last)) / (1000 * 60 * 60 * 24);

    let subject = "";
    let text = "";
    let type = "";

    if (client.followUpStage === 0) {
      subject = "Quick question";
      text = `Hi ${client.name},

Are you currently hiring remote staff?

We help businesses find trained Virtual Assistants, customer support agents, appointment setters, and remote admin staff.

Best,
Remote Staff Agency`;
      type = "Initial Email";
    } else if (client.followUpStage === 1 && days >= 2) {
      subject = "Just following up";
      text = `Hi ${client.name},

Just following up on my previous email.

Would you be open to seeing one or two qualified remote candidates?

Best,
Remote Staff Agency`;
      type = "Follow-up 1";
    } else if (client.followUpStage === 2 && days >= 5) {
      subject = "Last follow-up";
      text = `Hi ${client.name},

Just checking one last time.

If you're not looking for remote support right now, no worries at all.

Best,
Remote Staff Agency`;
      type = "Follow-up 2";
    } else {
      continue;
    }

    const ok = await sendMail(client.email, subject, text);

    if (ok) {
      client.followUpStage += 1;
      client.lastEmailAt = new Date().toISOString();

      if (client.followUpStage === 1) {
        client.status = "Contacted";
      } else {
        client.status = `${type} Sent`;
      }

      emails.push({
        id: Date.now() + Math.random(),
        type,
        clientName: client.name,
        to: client.email,
        subject,
        text,
        sentAt: new Date().toISOString()
      });

      sent++;
    }
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  return { message: "Auto email run completed", sent };
}

app.post('/run-auto-emails', async (req, res) => {
  const result = await sendAutoEmails();
  res.json(result);
});

app.post('/test-followups', async (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const emails = readJSON(EMAILS_FILE);

  let sent = 0;

  for (const client of clients) {
    if (!client.email) continue;
    if (client.status === "Replied" || client.status === "Closed") continue;

    let subject = "";
    let text = "";
    let type = "";

    if (client.followUpStage === 1) {
      subject = "Just following up";
      text = `Hi ${client.name},

Just following up on my previous email.

Best,
Remote Staff Agency`;
      type = "Follow-up 1";
    } else if (client.followUpStage === 2) {
      subject = "Last follow-up";
      text = `Hi ${client.name},

Final follow-up.

Best,
Remote Staff Agency`;
      type = "Follow-up 2";
    } else {
      continue;
    }

    const ok = await sendMail(client.email, subject, text);

    if (ok) {
      client.followUpStage += 1;
      client.lastEmailAt = new Date().toISOString();
      client.status = `${type} Sent`;

      emails.push({
        id: Date.now() + Math.random(),
        type,
        clientName: client.name,
        to: client.email,
        subject,
        text,
        sentAt: new Date().toISOString()
      });

      sent++;
    }
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  res.json({ message: "Test follow-ups sent", sent });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});