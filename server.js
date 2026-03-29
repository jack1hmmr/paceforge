const express = require("express");
const app = express();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

app.use(express.json());
app.get('/server.js', (req, res) => res.status(404).end());
app.get('/.env', (req, res) => res.status(404).end());
app.use(express.static(__dirname, { index: "index.html" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY";
const JWT_SECRET = process.env.JWT_SECRET || "paceforge_secret_key_change_this";

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      week_number INTEGER,
      day_name TEXT,
      completed BOOLEAN DEFAULT FALSE,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Database ready");
}

setupDatabase().catch(console.error);

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

app.post("/api/signup", async (req, res) => {
  try {
    const { name, age, email, password } = req.body;
    if (!name || !age || !email || !password)
      return res.status(400).json({ error: "All fields are required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

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
    console.log(`✅ New user signed up: ${name}`);
    res.json({ token, name: user.name, id: user.id });
  } catch (error) {
    if (error.code === "23505")
      return res.status(400).json({ error: "An account with that email already exists" });
    console.error("Signup error:", error.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post("/api/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required" });

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user)
      return res.status(400).json({ error: "No account found with that email" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ error: "Incorrect password" });

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
    res.json({ token, name: user.name, id: user.id, hasCompletedOnboarding });
  } catch (error) {
    console.error("Signin error:", error.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post("/api/onboarding", requireAuth, async (req, res) => {
  try {
    const quizData = req.body;
    const userId = req.user.id;

    console.log(`📋 Onboarding data received for user ${userId}`);

    // Calculate weeks until race
    let weeksUntilRace = 12;
    let raceDateStr = "No specific race date";
    if (quizData.raceDate && quizData.raceDate.toLowerCase() !== "skip") {
      const raceDate = new Date(quizData.raceDate);
      const today = new Date();
      const diffTime = raceDate - today;
      const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
      weeksUntilRace = Math.max(4, Math.min(diffWeeks, 52));
      raceDateStr = quizData.raceDate;
    }

    const prompt = `You are an elite running coach with deep expertise in exercise science, periodization, and athlete development. You understand and implement Daniels Running Formula, Maffetone Method, Rosner Running Limiter methodology, and Lydiard periodization. You have been given a detailed athlete profile from an onboarding quiz. Your job is to build a COMPLETE, FULLY PERSONALIZED training plan, backed up by the latest science, from today until their race date.

ATHLETE PROFILE:
${JSON.stringify(quizData, null, 2)}

RACE DATE: ${raceDateStr}
WEEKS UNTIL RACE: ${weeksUntilRace}
TODAY'S DATE: ${new Date().toDateString()}

REQUIREMENTS:
- Build a complete ${weeksUntilRace}-week training plan
- Use proper periodization: (example) Base → Build → Peak → Taper
- Include progressive overload week over week, if age is under 18 do not increase training load more than 10% per week
- Include transition/recovery weeks every 3-4 weeks
- Taper should be the final 1-2 weeks before race
- Consider the athlete's current fitness, mileage, injuries, fatigue, sleep, stress, and running limiter
- Integrate cross training, lifting, and plyometrics where appropriate based on the athlete profile
- If athlete has injuries or high fatigue, adjust intensity accordingly
- If athlete is a beginner, start conservatively
- Every workout must be specific and detailed — no generic descriptions
- Rest days should still have a purpose (mobility, foam rolling, etc.)

PLAN FORMAT — respond ONLY with this exact JSON, no explanation, no markdown:
{
  "totalWeeks": ${weeksUntilRace},
  "raceDate": "${raceDateStr}",
  "goal": "brief description of the athlete's goal",
  "phases": [
    { "name": "Base", "weekStart": 1, "weekEnd": 3 },
    { "name": "Build", "weekStart": 4, "weekEnd": 8 },
    { "name": "Peak", "weekStart": 9, "weekEnd": 11 },
    { "name": "Taper", "weekStart": 12, "weekEnd": ${weeksUntilRace} }
  ],
  "weeks": [
    {
      "week": 1,
      "phase": "Base",
      "focus": "brief focus for this week",
      "totalMiles": 20,
      "days": [
        { "name": "Monday", "type": "Easy Run", "workout": "detailed workout description" },
        { "name": "Tuesday", "type": "Rest", "workout": "detailed recovery description" },
        { "name": "Wednesday", "type": "Workout", "workout": "detailed workout description" },
        { "name": "Thursday", "type": "Easy Run", "workout": "detailed workout description" },
        { "name": "Friday", "type": "Cross Training", "workout": "detailed workout description" },
        { "name": "Saturday", "type": "Long Run", "workout": "detailed workout description" },
        { "name": "Sunday", "type": "Rest", "workout": "detailed recovery description" }
      ]
    }
  ]
}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "OpenAI API error");
    }

    const data = await response.json();
    let rawText = data.choices[0].message.content.trim();
    rawText = rawText.replace(/```json|```/g, "").trim();
    const plan = JSON.parse(rawText);

    const existing = await pool.query(
      "SELECT * FROM profiles WHERE user_id = $1", [userId]
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

    console.log(`✅ Full ${weeksUntilRace}-week plan generated for user ${userId}`);
    res.json({ plan });

  } catch (error) {
    console.error("Onboarding error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/plan", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM profiles WHERE user_id = $1", [req.user.id]
    );
    const profile = result.rows[0];
    if (!profile || !profile.plan)
      return res.status(404).json({ error: "No plan found" });
    res.json(JSON.parse(profile.plan));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/log-workout", requireAuth, async (req, res) => {
  try {
    const { weekNumber, dayName } = req.body;
    const userId = req.user.id;

    await pool.query(
      `INSERT INTO workout_logs (user_id, week_number, day_name, completed, completed_at)
       VALUES ($1, $2, $3, true, NOW())
       ON CONFLICT DO NOTHING`,
      [userId, weekNumber, dayName]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/workout-logs", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT week_number, day_name FROM workout_logs WHERE user_id = $1 AND completed = true",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏃 PaceForge server running on port ${PORT}`);
});
