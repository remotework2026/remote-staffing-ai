require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = "digitaltrading76@gmail.com"; // CHANGE THIS

const DATA_DIR = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const APPLICANTS_FILE = path.join(DATA_DIR, 'applicants.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const CLIENT_LEADS_FILE = path.join(DATA_DIR, 'client_leads.json');
const APPLICANT_LEADS_FILE = path.join(DATA_DIR, 'applicant_leads.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let sheets = null;

try {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && SHEET_ID) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    console.log("Google Sheets connected: YES");
  } else {
    console.log("Google Sheets connected: NO");
  }
} catch (err) {
  console.log("Google Sheets setup error:", err.message);
}

async function ensureSheetTab(tabName) {
  if (!sheets || !SHEET_ID) return;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingTabs = spreadsheet.data.sheets.map(s => s.properties.title);

  if (!existingTabs.includes(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }]
      }
    });

    console.log(`Created Google Sheet tab: ${tabName}`);
  }
}

async function appendToGoogleSheet(tabName, values) {
  if (!sheets || !SHEET_ID) {
    console.log("Google Sheets skipped");
    return;
  }

  try {
    await ensureSheetTab(tabName);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });

    console.log(`Saved to Google Sheet: ${tabName}`);
  } catch (err) {
    console.log(`Google Sheets save error for ${tabName}:`, err.response?.data || err.message);
  }
}

function readJSON(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function scoreApplicant(a) {
  let score = 0;
  if ((a.internet || "").toLowerCase() === "good") score += 25;
  if ((a.english || "").toLowerCase() === "good") score += 25;
  if (a.experience) score += 30;
  if (a.role) score += 20;
  return score;
}

function normalizeRole(role) {
  return String(role || "")
    .toLowerCase()
    .replace(/virtual assistant/g, "va")
    .replace(/customer service/g, "customer support")
    .replace(/csr/g, "customer support")
    .replace(/admin assistant/g, "admin")
    .replace(/social media manager/g, "social media")
    .replace(/appointment setter/g, "appointment")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function rolesMatch(clientRoleRaw, applicantRoleRaw) {
  const clientRole = normalizeRole(clientRoleRaw);
  const applicantRole = normalizeRole(applicantRoleRaw);

  if (!clientRole || !applicantRole) return false;
  if (clientRole.includes(applicantRole)) return true;
  if (applicantRole.includes(clientRole)) return true;

  const clientWords = clientRole.split(" ").filter(w => w.length > 2);
  const applicantWords = applicantRole.split(" ").filter(w => w.length > 2);
  const commonWords = clientWords.filter(word => applicantWords.includes(word));

  return commonWords.length > 0;
}

function makeToken() {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "default_secret")
    .update("dashboard-access")
    .digest("hex");
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const found = cookie.split(";").find(c => c.trim().startsWith(name + "="));
  return found ? found.split("=")[1] : null;
}

function isAuthed(req) {
  return getCookie(req, "dashboard_token") === makeToken();
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.redirect("/login");
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

app.get("/landing.html", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

app.get("/login", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Dashboard Login</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}
        body{background:#020617;height:100vh;display:flex;align-items:center;justify-content:center;color:white}
        .login-box{width:400px;background:#111827;border:1px solid #38bdf8;border-radius:22px;padding:40px}
        h1{color:#38bdf8;text-align:center;margin-bottom:10px}
        p{color:#94a3b8;text-align:center;margin-bottom:25px}
        input{width:100%;padding:14px;border-radius:10px;border:1px solid #334155;background:#020617;color:white;margin-bottom:15px}
        button{width:100%;padding:14px;border:none;border-radius:10px;background:#38bdf8;color:#020617;font-weight:bold;cursor:pointer}
        a{display:block;text-align:center;margin-top:18px;color:#38bdf8;text-decoration:none}
      </style>
    </head>
    <body>
      <form class="login-box" method="POST" action="/login">
        <h1>Secure Dashboard</h1>
        <p>Authorized access only</p>
        <input type="email" name="email" placeholder="Admin Email" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
        <a href="/landing.html">Back to Home</a>
      </form>
    </body>
    </html>
  `);
});

app.post("/login", (req, res) => {
  if (req.body.email === process.env.DASHBOARD_EMAIL && req.body.password === process.env.DASHBOARD_PASSWORD) {
    res.setHeader("Set-Cookie", `dashboard_token=${makeToken()}; HttpOnly; Path=/; SameSite=Lax`);
    return res.redirect("/index.html");
  }

  res.send("Wrong email or password. <a href='/login'>Try again</a>");
});

app.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "dashboard_token=; Max-Age=0; Path=/");
  res.json({ message: "Logged out" });
});

app.get("/index.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post('/submit-client-form', async (req, res) => {
  const { name, company, email, phone, role, message } = req.body;
  const clients = readJSON(CLIENTS_FILE);

  const client = {
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
  };

  clients.push(client);
  saveJSON(CLIENTS_FILE, clients);

  await appendToGoogleSheet("Clients", [
    new Date().toLocaleString(),
    client.name,
    client.contactName,
    client.email,
    client.phone,
    client.role,
    client.message,
    client.status,
    client.source
  ]);

  res.json({ message: "Client form saved" });
});

app.post('/submit-applicant-form', async (req, res) => {
  const { name, email, phone, role, experience, internet, english } = req.body;
  const applicants = readJSON(APPLICANTS_FILE);

  const applicant = {
    id: Date.now() + Math.random(),
    name,
    email,
    phone,
    role,
    experience,
    internet,
    english,
    score: scoreApplicant({ role, experience, internet, english }),
    createdAt: new Date().toISOString(),
    source: "Landing Applicant Form"
  };

  applicants.push(applicant);
  saveJSON(APPLICANTS_FILE, applicants);

  await appendToGoogleSheet("Applicants", [
    new Date().toLocaleString(),
    applicant.name,
    applicant.email,
    applicant.phone,
    applicant.role,
    applicant.experience,
    applicant.internet,
    applicant.english,
    applicant.score,
    applicant.source
  ]);

  res.json({ message: "Applicant form saved" });
});

app.get('/clients', requireAuth, (req, res) => res.json(readJSON(CLIENTS_FILE)));
app.get('/applicants', requireAuth, (req, res) => res.json(readJSON(APPLICANTS_FILE)));
app.get('/emails', requireAuth, (req, res) => res.json(readJSON(EMAILS_FILE)));
app.get('/matches-history', requireAuth, (req, res) => res.json(readJSON(MATCHES_FILE)));
app.get('/client-leads', requireAuth, (req, res) => res.json(readJSON(CLIENT_LEADS_FILE)));
app.get('/applicant-leads', requireAuth, (req, res) => res.json(readJSON(APPLICANT_LEADS_FILE)));

app.post('/find-client-leads', requireAuth, async (req, res) => {
  const { niche, location } = req.body;
  const leads = readJSON(CLIENT_LEADS_FILE);

  const sampleLeads = [
    {
      id: Date.now() + Math.random(),
      businessName: `${location || "Target"} ${niche || "Business"} Lead 1`,
      niche,
      location,
      email: "",
      website: "",
      status: "New Lead",
      source: "Dashboard Lead Finder",
      createdAt: new Date().toISOString()
    },
    {
      id: Date.now() + Math.random(),
      businessName: `${location || "Target"} ${niche || "Business"} Lead 2`,
      niche,
      location,
      email: "",
      website: "",
      status: "New Lead",
      source: "Dashboard Lead Finder",
      createdAt: new Date().toISOString()
    }
  ];

  for (const lead of sampleLeads) {
    leads.push(lead);

    await appendToGoogleSheet("Client Leads", [
      new Date().toLocaleString(),
      lead.businessName,
      lead.niche,
      lead.location,
      lead.email,
      lead.website,
      lead.status,
      lead.source
    ]);
  }

  saveJSON(CLIENT_LEADS_FILE, leads);

  res.json({
    message: "Client leads generated",
    added: sampleLeads.length
  });
});

app.post('/import-applicant-leads', requireAuth, async (req, res) => {
  const { csv } = req.body;
  const leads = readJSON(APPLICANT_LEADS_FILE);

  if (!csv) return res.json({ message: "No CSV provided", imported: 0 });

  const lines = csv.trim().split("\n");
  let imported = 0;

  for (const line of lines.slice(1)) {
    const [name, role, email, phone, experience] = line.split(",").map(x => x.trim());

    if (name && role && email) {
      const lead = {
        id: Date.now() + Math.random(),
        name,
        role,
        email,
        phone,
        experience,
        status: "New Applicant Lead",
        source: "Dashboard Import",
        createdAt: new Date().toISOString()
      };

      leads.push(lead);

      await appendToGoogleSheet("Applicant Leads", [
        new Date().toLocaleString(),
        lead.name,
        lead.role,
        lead.email,
        lead.phone,
        lead.experience,
        lead.status,
        lead.source
      ]);

      imported++;
    }
  }

  saveJSON(APPLICANT_LEADS_FILE, leads);

  res.json({
    message: "Applicant leads imported",
    imported
  });
});

app.get('/match', requireAuth, (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const applicants = readJSON(APPLICANTS_FILE);

  const matches = clients.map(client => {
    const best = applicants
      .filter(a => rolesMatch(client.role, a.role))
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    return { client, best: best || null };
  });

  res.json(matches);
});

async function sendMail(to, subject, text) {
  try {
    await sgMail.send({ to, from: FROM_EMAIL, subject, text });
    console.log("EMAIL SENT TO:", to);
    return true;
  } catch (err) {
    console.log("SENDGRID ERROR:", err.response?.body || err.message);
    return false;
  }
}

app.post('/run-match-notifications', requireAuth, async (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const applicants = readJSON(APPLICANTS_FILE);
  const matchesHistory = readJSON(MATCHES_FILE);

  let notificationsSent = 0;
  let skipped = 0;

  for (const client of clients) {
    const bestApplicant = applicants
      .filter(a => rolesMatch(client.role, a.role))
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    if (!client.email || !bestApplicant?.email) {
      skipped++;
      continue;
    }

    const alreadySent = matchesHistory.some(m =>
      m.clientEmail === client.email &&
      m.applicantEmail === bestApplicant.email
    );

    if (alreadySent) {
      skipped++;
      continue;
    }

    await sendMail(client.email, "Possible Remote Staff Match Found",
`Hi ${client.name},

We found a possible applicant match for your requested role: ${client.role}

Applicant Name: ${bestApplicant.name}
Experience: ${bestApplicant.experience || "N/A"}

Best,
Remote Staff Agency`);

    await sendMail(bestApplicant.email, "Possible VA Job Opportunity Match",
`Hi ${bestApplicant.name},

A business may be interested in your qualifications for this role: ${bestApplicant.role}

Best,
Remote Staff Agency`);

    if (process.env.NOTIFICATION_EMAIL) {
      await sendMail(process.env.NOTIFICATION_EMAIL, "New Client + Applicant Match",
`New staffing match detected.

CLIENT: ${client.name}
CLIENT EMAIL: ${client.email}
ROLE NEEDED: ${client.role}

APPLICANT: ${bestApplicant.name}
APPLICANT EMAIL: ${bestApplicant.email}
APPLICANT ROLE: ${bestApplicant.role}
SCORE: ${bestApplicant.score || 0}`);
    }

    const matchRecord = {
      id: Date.now() + Math.random(),
      clientEmail: client.email,
      applicantEmail: bestApplicant.email,
      clientName: client.name,
      applicantName: bestApplicant.name,
      role: client.role,
      applicantRole: bestApplicant.role,
      applicantScore: bestApplicant.score || 0,
      matchedAt: new Date().toISOString()
    };

    matchesHistory.push(matchRecord);

    await appendToGoogleSheet("Matches", [
      new Date().toLocaleString(),
      matchRecord.clientName,
      matchRecord.clientEmail,
      matchRecord.role,
      matchRecord.applicantName,
      matchRecord.applicantEmail,
      matchRecord.applicantRole,
      matchRecord.applicantScore
    ]);

    notificationsSent++;
  }

  saveJSON(MATCHES_FILE, matchesHistory);

  res.json({
    message: "Match notification scan completed",
    notificationsSent,
    skipped
  });
});

app.post('/run-auto-emails', requireAuth, async (req, res) => {
  res.json({ message: "Auto email run completed", sent: 0 });
});

app.post('/test-followups', requireAuth, async (req, res) => {
  res.json({ message: "Test follow-ups sent", sent: 0 });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});