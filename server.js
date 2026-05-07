require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = "digitaltrading76@gmail.com"; // CHANGE THIS to your verified SendGrid email

const DATA_DIR = path.join(__dirname, 'data');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const APPLICANTS_FILE = path.join(DATA_DIR, 'applicants.json');
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
        *{
          margin:0;
          padding:0;
          box-sizing:border-box;
          font-family:Arial,sans-serif;
        }

        body{
          background:#020617;
          height:100vh;
          display:flex;
          align-items:center;
          justify-content:center;
          color:white;
        }

        .login-box{
          width:400px;
          background:#111827;
          border:1px solid #38bdf8;
          border-radius:22px;
          padding:40px;
          box-shadow:0 20px 60px rgba(0,0,0,.4);
        }

        h1{
          color:#38bdf8;
          margin-bottom:10px;
          text-align:center;
        }

        p{
          color:#94a3b8;
          text-align:center;
          margin-bottom:25px;
        }

        input{
          width:100%;
          padding:14px;
          border-radius:10px;
          border:1px solid #334155;
          background:#020617;
          color:white;
          margin-bottom:15px;
        }

        button{
          width:100%;
          padding:14px;
          border:none;
          border-radius:10px;
          background:#38bdf8;
          color:#020617;
          font-weight:bold;
          cursor:pointer;
          font-size:16px;
        }

        button:hover{
          opacity:.9;
        }

        .back{
          display:block;
          text-align:center;
          margin-top:18px;
          color:#38bdf8;
          text-decoration:none;
        }
      </style>
    </head>

    <body>
      <form class="login-box" method="POST" action="/login">
        <h1>Secure Dashboard</h1>

        <p>Authorized access only</p>

        <input
          type="email"
          name="email"
          placeholder="Admin Email"
          required
        >

        <input
          type="password"
          name="password"
          placeholder="Password"
          required
        >

        <button type="submit">
          Login to Dashboard
        </button>

        <a class="back" href="/landing.html">
          ← Back to Home
        </a>
      </form>
    </body>
    </html>
  `);
});

app.post("/login", (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  const validEmail = process.env.DASHBOARD_EMAIL;
  const validPassword = process.env.DASHBOARD_PASSWORD;

  if (email === validEmail && password === validPassword) {
    res.setHeader(
      "Set-Cookie",
      `dashboard_token=${makeToken()}; HttpOnly; Path=/; SameSite=Lax`
    );

    return res.redirect("/index.html");
  }

  res.send(`
    <html>
    <body style="
      background:#020617;
      color:white;
      font-family:Arial;
      display:flex;
      align-items:center;
      justify-content:center;
      height:100vh;
    ">
      <div style="
        background:#111827;
        padding:35px;
        border-radius:18px;
        border:1px solid #ef4444;
        text-align:center;
      ">
        <h2 style="color:#ef4444">
          Invalid Login
        </h2>

        <p>
          Wrong email or password.
        </p>

        <a
          href="/login"
          style="
            color:#38bdf8;
            text-decoration:none;
          "
        >
          Try Again
        </a>
      </div>
    </body>
    </html>
  `);
});

app.post("/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "dashboard_token=; Max-Age=0; Path=/"
  );

  res.json({
    message: "Logged out"
  });
});

app.get("/index.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =====================
   LANDING PAGE FORMS
===================== */

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

  const applicants = readJSON(APPLICANTS_FILE);

  applicants.push({
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
  });

  saveJSON(APPLICANTS_FILE, applicants);

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

app.post('/import-clients-csv', requireAuth, (req, res) => {
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
          repliedAt: null,
          source: "Dashboard CSV"
        });

        imported++;
      }
    }
  });

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

app.get('/match', requireAuth, (req, res) => {
  const clients = readJSON(CLIENTS_FILE);
  const applicants = readJSON(APPLICANTS_FILE);

  const matches = clients.map(client => {
    const clientRole = (client.role || "").toLowerCase();

    const best = applicants
      .filter(a => {
        const applicantRole = (a.role || "").toLowerCase();

        return (
          clientRole &&
          applicantRole &&
          (
            clientRole.includes(applicantRole) ||
            applicantRole.includes(clientRole)
          )
        );
      })
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