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
const CLIENT_FORM_CSV = path.join(DATA_DIR, 'client_form_submissions.csv');
const APPLICANT_FORM_CSV = path.join(DATA_DIR, 'applicant_form_submissions.csv');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(MATCHES_FILE)) fs.writeFileSync(MATCHES_FILE, '[]');

/* =====================
   GOOGLE SHEETS SETUP
===================== */

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let sheets = null;

try {
  if (
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SHEET_ID
  ) {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({
      version: 'v4',
      auth,
    });

    console.log("Google Sheets connected: YES");
  } else {
    console.log("Google Sheets connected: NO - missing environment variables");
  }
} catch (err) {
  console.log("Google Sheets setup error:", err.message);
}

async function ensureSheetTab(tabName) {
  if (!sheets || !SHEET_ID) return;

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });

  const existingTabs = spreadsheet.data.sheets.map(
    s => s.properties.title
  );

  if (!existingTabs.includes(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tabName,
              },
            },
          },
        ],
      },
    });

    console.log(`Created Google Sheet tab: ${tabName}`);
  }
}

async function appendToGoogleSheet(tabName, values) {
  if (!sheets || !SHEET_ID) {
    console.log("Google Sheets skipped: not configured");
    return;
  }

  try {
    await ensureSheetTab(tabName);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [values],
      },
    });

    console.log(`Saved to Google Sheet: ${tabName}`);
  } catch (err) {
    console.log(
      `Google Sheets save error for ${tabName}:`,
      err.response?.data || err.message
    );
  }
}

/* =====================
   FILE HELPERS
===================== */

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
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, headers.join(",") + "\n");
  }

  const cleanRow = row.map(v => `"${String(v || "").replace(/"/g, '""')}"`);
  fs.appendFileSync(file, cleanRow.join(",") + "\n");
}

function scoreApplicant(a) {
  let score = 0;

  if ((a.internet || "").toLowerCase() === "good") score += 25;
  if ((a.english || "").toLowerCase() === "good") score += 25;
  if (a.experience) score += 30;
  if (a.role) score += 20;

  return score;
}

function rolesMatch(clientRoleRaw, applicantRoleRaw) {
  const clientRole = String(clientRoleRaw || "").toLowerCase().trim();
  const applicantRole = String(applicantRoleRaw || "").toLowerCase().trim();

  if (!clientRole || !applicantRole) return false;

  return (
    clientRole.includes(applicantRole) ||
    applicantRole.includes(clientRole) ||
    (clientRole.includes("va") && applicantRole.includes("virtual assistant")) ||
    (clientRole.includes("virtual assistant") && applicantRole.includes("va")) ||
    (clientRole.includes("customer support") && applicantRole.includes("support")) ||
    (clientRole.includes("support") && applicantRole.includes("customer support"))
  );
}

/* =====================
   SECURE DASHBOARD LOGIN
===================== */

function makeToken() {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "default_secret")
    .update("dashboard-access")
    .digest("hex");
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";

  const found = cookie
    .split(";")
    .find(c => c.trim().startsWith(name + "="));

  return found ? found.split("=")[1] : null;
}

function isAuthed(req) {
  return getCookie(req, "dashboard_token") === makeToken();
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) {
    return res.redirect("/login");
  }

  next();
}

/* =====================
   BASIC PAGES
===================== */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

app.get("/landing.html", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

app.get("/login", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dashboard Login</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif}
        body{background:#020617;height:100vh;display:flex;align-items:center;justify-content:center;color:white}
        .login-box{width:400px;background:#111827;border:1px solid #38bdf8;border-radius:22px;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
        h1{color:#38bdf8;margin-bottom:10px;text-align:center}
        p{color:#94a3b8;text-align:center;margin-bottom:25px}
        input{width:100%;padding:14px;border-radius:10px;border:1px solid #334155;background:#020617;color:white;margin-bottom:15px}
        button{width:100%;padding:14px;border:none;border-radius:10px;background:#38bdf8;color:#020617;font-weight:bold;cursor:pointer;font-size:16px}
        .back{display:block;text-align:center;margin-top:18px;color:#38bdf8;text-decoration:none}
      </style>
    </head>
    <body>
      <form class="login-box" method="POST" action="/login">
        <h1>Secure Dashboard</h1>
        <p>Authorized access only</p>
        <input type="email" name="email" placeholder="Admin Email" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login to Dashboard</button>
        <a class="back" href="/landing.html">← Back to Home</a>
      </form>
    </body>
    </html>
  `);
});

app.post("/login", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  if (
    email === process.env.DASHBOARD_EMAIL &&
    password === process.env.DASHBOARD_PASSWORD
  ) {
    res.setHeader(
      "Set-Cookie",
      `dashboard_token=${makeToken()}; HttpOnly; Path=/; SameSite=Lax`
    );

    return res.redirect("/index.html");
  }

  res.send(`
    <html>
    <body style="background:#020617;color:white;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;">
      <div style="background:#111827;padding:35px;border-radius:18px;border:1px solid #ef4444;text-align:center;">
        <h2 style="color:#ef4444">Invalid Login</h2>
        <p>Wrong email or password.</p>
        <a href="/login" style="color:#38bdf8;text-decoration:none;">Try Again</a>
      </div>
    </body>
    </html>
  `);
});

app.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "dashboard_token=; Max-Age=0; Path=/");
  res.json({ message: "Logged out" });
});

app.get("/index.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =====================
   LANDING PAGE FORMS
===================== */

app.post('/submit-client-form', async (req, res) => {
  const { name, company, email, phone, role, message } = req.body;

  appendCSV(
    CLIENT_FORM_CSV,
    ["date", "name", "company", "email", "phone", "needed_role", "message"],
    [new Date().toISOString(), name, company, email, phone, role, message]
  );

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

  appendCSV(
    APPLICANT_FORM_CSV,
    ["date", "name", "email", "phone", "role", "experience", "internet", "english"],
    [new Date().toISOString(), name, email, phone, role, experience, internet, english]
  );

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

/* =====================
   PROTECTED DASHBOARD API
===================== */

app.get('/clients', requireAuth, (req, res) => {
  res.json(readJSON(CLIENTS_FILE));
});

app.get('/applicants', requireAuth, (req, res) => {
  res.json(readJSON(APPLICANTS_FILE));
});

app.get('/emails', requireAuth, (req, res) => {
  res.json(readJSON(EMAILS_FILE));
});

app.get('/matches-history', requireAuth, (req, res) => {
  res.json(readJSON(MATCHES_FILE));
});

app.post('/import-clients-csv', requireAuth, async (req, res) => {
  const { csv } = req.body;
  const clients = readJSON(CLIENTS_FILE);

  if (!csv) return res.json({ message: "No CSV", imported: 0 });

  const lines = csv.trim().split("\n");
  let imported = 0;

  for (const line of lines.slice(1)) {
    const [name, role, email] = line.split(",").map(x => x.trim());

    if (name && role && email) {
      const exists = clients.some(c => c.email && c.email.toLowerCase() === email.toLowerCase());

      if (!exists) {
        const client = {
          id: Date.now() + Math.random(),
          name,
          role,
          email,
          status: "New",
          followUpStage: 0,
          createdAt: new Date().toISOString(),
          lastEmailAt: null,
          repliedAt: null,
          source: "Dashboard CSV"
        };

        clients.push(client);

        await appendToGoogleSheet("Clients", [
          new Date().toLocaleString(),
          client.name,
          "",
          client.email,
          "",
          client.role,
          "",
          client.status,
          client.source
        ]);

        imported++;
      }
    }
  }

  saveJSON(CLIENTS_FILE, clients);

  res.json({
    message: "CSV imported",
    imported
  });
});

app.post('/mark-replied', requireAuth, (req, res) => {
  const { email } = req.body;
  const clients = readJSON(CLIENTS_FILE);

  let updated = false;

  const updatedClients = clients.map(client => {
    if (client.email && email && client.email.toLowerCase() === email.toLowerCase()) {
      updated = true;
      return { ...client, status: "Replied", repliedAt: new Date().toISOString() };
    }

    return client;
  });

  saveJSON(CLIENTS_FILE, updatedClients);

  res.json({
    message: updated ? "Client marked as replied" : "Client not found",
    updated
  });
});

app.get('/match', requireAuth, (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const applicants = readJSON(APPLICANTS_FILE);

  const matches = clients.map(client => {
    const best = applicants
      .filter(a => rolesMatch(client.role, a.role))
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    return {
      client,
      best: best || null
    };
  });

  res.json(matches);
});

/* =====================
   EMAIL SYSTEM
===================== */

async function sendMail(to, subject, text) {
  try {
    await sgMail.send({
      to,
      from: FROM_EMAIL,
      subject,
      text
    });

    console.log("EMAIL SENT TO:", to);
    return true;
  } catch (err) {
    console.log("SENDGRID ERROR:", err.response?.body || err.message);
    return false;
  }
}

/* =====================
   MATCH NOTIFICATIONS
===================== */

app.post('/run-match-notifications', requireAuth, async (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const applicants = readJSON(APPLICANTS_FILE);
  const matchesHistory = readJSON(MATCHES_FILE);

  let notificationsSent = 0;
  let skipped = 0;

  for (const client of clients) {
    if (!client.email) continue;

    const bestApplicant = applicants
      .filter(a => rolesMatch(client.role, a.role))
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

    if (!bestApplicant || !bestApplicant.email) {
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

    await sendMail(
      client.email,
      "Possible Remote Staff Match Found",
`Hi ${client.name},

We found a possible applicant match for your requested role: ${client.role}

Applicant Name:
${bestApplicant.name}

Experience:
${bestApplicant.experience || "N/A"}

Our recruitment team will review this match and contact you shortly.

Best,
Remote Staff Agency`
    );

    await sendMail(
      bestApplicant.email,
      "Possible VA Job Opportunity Match",
`Hi ${bestApplicant.name},

A business may be interested in your qualifications for this role:

${bestApplicant.role}

Our recruitment team may contact you soon for additional screening.

Best,
Remote Staff Agency`
    );

    if (process.env.NOTIFICATION_EMAIL) {
      await sendMail(
        process.env.NOTIFICATION_EMAIL,
        "New Client + Applicant Match",
`New staffing match detected.

CLIENT:
${client.name}
${client.email}

ROLE NEEDED:
${client.role}

APPLICANT:
${bestApplicant.name}
${bestApplicant.email}

APPLICANT ROLE:
${bestApplicant.role}

SCORE:
${bestApplicant.score || 0}

Experience:
${bestApplicant.experience || "N/A"}`
      );
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

/* =====================
   AUTO EMAILS + FOLLOW UPS
===================== */

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
      client.status = client.followUpStage === 1 ? "Contacted" : `${type} Sent`;

      const emailRecord = {
        id: Date.now() + Math.random(),
        type,
        clientName: client.name,
        to: client.email,
        subject,
        text,
        sentAt: new Date().toISOString()
      };

      emails.push(emailRecord);

      await appendToGoogleSheet("Emails", [
        new Date().toLocaleString(),
        emailRecord.type,
        emailRecord.clientName,
        emailRecord.to,
        emailRecord.subject,
        emailRecord.text
      ]);

      sent++;
    }
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  return {
    message: "Auto email run completed",
    sent
  };
}

app.post('/run-auto-emails', requireAuth, async (req, res) => {
  const result = await sendAutoEmails();
  res.json(result);
});

app.post('/test-followups', requireAuth, async (req, res) => {
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

      const emailRecord = {
        id: Date.now() + Math.random(),
        type,
        clientName: client.name,
        to: client.email,
        subject,
        text,
        sentAt: new Date().toISOString()
      };

      emails.push(emailRecord);

      await appendToGoogleSheet("Emails", [
        new Date().toLocaleString(),
        emailRecord.type,
        emailRecord.clientName,
        emailRecord.to,
        emailRecord.subject,
        emailRecord.text
      ]);

      sent++;
    }
  }

  saveJSON(CLIENTS_FILE, clients);
  saveJSON(EMAILS_FILE, emails);

  res.json({
    message: "Test follow-ups sent",
    sent
  });
});

/* =====================
   START SERVER
===================== */

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});