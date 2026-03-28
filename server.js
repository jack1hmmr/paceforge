const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

app.use(express.json());
app.use(express.static("public"));

// ============================================================
// ⚠️ PASTE YOUR OPENAI API KEY HERE
// ============================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY";

// ============================================================
// SECRET KEY — change this to any random string
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || "paceforge_secret_key_change_this";

// ============================================================
// DATABASE SETUP — uses Replit's built in PostgreSQL
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id),
      quiz_data TEXT,
      plan TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Database ready");
}

setupDatabase().catch(console.error);

// ============================================================
// MIDDLEWARE — checks if user is logged in
// ============================================================
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

// ============================================================
// SIGN UP
// ============================================================
app.post("/api/signup", async (req, res) => {
  try {
    const { name, age, email, password } = req.body;

    if (!name || !age || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (name, age, email, password) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, age, email.toLowerCase(), hashedPassword]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    console.log(`✅ New user signed up: ${name} (${email})`);
    res.json({ token, name: user.name, id: user.id });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ error: "An account with that email already exists" });
    }
    console.error("Signup error:", error.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ============================================================
// SIGN IN
// ============================================================
app.post("/api/signin", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "No account found with that email" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: "Incorrect password" });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    const profile = await pool.query(
      "SELECT * FROM profiles WHERE user_id = $1",
      [user.id]
    );

    const hasCompletedOnboarding = !!(profile.rows[0]?.quiz_data);

    console.log(`✅ User signed in: ${user.name}`);
    res.json({
      token,
      name: user.name,
      id: user.id,
      hasCompletedOnboarding
    });

  } catch (error) {
    console.error("Signin error:", error.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ============================================================
// SAVE QUIZ + GENERATE PLAN
// ============================================================
app.post("/api/onboarding", requireAuth, async (req, res) => {
  try {
    const quizData = req.body;
    const userId = req.user.id;

    console.log(`📋 Onboarding data received for user ${userId}`);

    const prompt = `You are an elite running coach with deep knowledge of exercise science and periodization. Based on the following athlete profile, create a detailed personalized weekly training plan.

ATHLETE PROFILE:
${JSON.stringify(quizData, null, 2)}

Create a 7-day training plan that includes appropriate periodization, progressive overload, and recovery. Consider the athlete's fitness level, goals, available days, and any injury history.

Respond ONLY with valid JSON in this exact format, no explanation, no markdown:
{"days":[{"name":"Monday","workout":"..."},{"name":"Tuesday","workout":"..."},{"name":"Wednesday","workout":"..."},{"name":"Thursday","workout":"..."},{"name":"Friday","workout":"..."},{"name":"Saturday","workout":"..."},{"name":"Sunday","workout":"..."}]}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "OpenAI API error");
    }

    const data = await response.json();
    const rawText = data.choices[0].message.content.trim();
    const plan = JSON.parse(rawText);

    const existing = await pool.query(
      "SELECT * FROM profiles WHERE user_id = $1",
      [userId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        "UPDATE profiles SET quiz_data = $1, plan = $2 WHERE user_id = $3",
        [JSON.stringify(quizData), JSON.stringify(plan), userId]
      );
    } else {
      await pool.query(
        "INSERT INTO profiles (user_id, quiz_data, plan) VALUES ($1, $2, $3)",
        [userId, JSON.stringify(quizData), JSON.stringify(plan)]
      );
    }

    console.log(`✅ Plan generated and saved for user ${userId}`);
    res.json({ plan });

  } catch (error) {
    console.error("Onboarding error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET USER'S PLAN
// ============================================================
app.get("/api/plan", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM profiles WHERE user_id = $1",
      [req.user.id]
    );

    const profile = result.rows[0];

    if (!profile || !profile.plan) {
      return res.status(404).json({ error: "No plan found" });
    }

    res.json(JSON.parse(profile.plan));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏃 PaceForge server running on port ${PORT}`);
});