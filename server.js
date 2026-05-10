require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { google } = require("googleapis");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SERVE STATIC FILES
app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;

// GOOGLE SHEETS
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// HOME PAGE
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

// GET ARTICLES
app.get("/api/articles", async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Articles!A2:F",
    });

    const rows = response.data.values || [];

    const articles = rows
      .filter((row) => row[5] === "Active")
      .map((row) => ({
        title: row[0],
        category: row[1],
        content: row[2],
        imageUrl: row[3],
        videoUrl: row[4],
      }));

    res.json(articles);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to load articles" });
  }
});

// GET VA JOBS
app.get("/api/jobs", async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "VA Jobs!A2:F",
    });

    const rows = response.data.values || [];

    const jobs = rows
      .filter((row) => row[5] === "Active")
      .map((row) => ({
        jobTitle: row[0],
        jobType: row[1],
        experience: row[2],
        salaryRange: row[3],
        description: row[4],
      }));

    res.json(jobs);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to load jobs" });
  }
});

// GET MEDIA
app.get("/api/media", async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Media!A2:E",
    });

    const rows = response.data.values || [];

    const media = rows
      .filter((row) => row[4] === "Active")
      .map((row) => ({
        title: row[0],
        type: row[1],
        url: row[2],
        description: row[3],
      }));

    res.json(media);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to load media" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});