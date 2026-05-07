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

        <h1>
          Secure Dashboard
        </h1>

        <p>
          Authorized access only
        </p>

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

  if (
    email === validEmail &&
    password === validPassword
  ) {

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
    message:"Logged out"
  });
});

app.get("/index.html", requireAuth, (req, res) => {

  res.sendFile(path.join(__dirname, "index.html"));
});