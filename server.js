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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, week_number, day_name)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      distance TEXT,
      time TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coach_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
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

// ============================================================
// SIGN UP
// ============================================================
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

// ============================================================
// SIGN IN
// ============================================================
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

// ============================================================
// ONBOARDING
// ============================================================
app.post("/api/onboarding", requireAuth, async (req, res) => {
  try {
    const quizData = req.body;
    const userId = req.user.id;

    console.log(`📋 Onboarding data received for user ${userId}`);

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

    const baseEnd = Math.floor(weeksUntilRace * 0.25);
    const buildEnd = Math.floor(weeksUntilRace * 0.65);
    const peakEnd = Math.floor(weeksUntilRace * 0.85);
    const taperEnd = weeksUntilRace;

    const prompt = `You are an elite running coach. Generate ONLY valid JSON output, no other text.

ATHLETE PROFILE:
${JSON.stringify(quizData, null, 2)}

RACE DATE: ${raceDateStr}
WEEKS UNTIL RACE: ${weeksUntilRace}
TODAY'S DATE: ${new Date().toDateString()}

Build a complete ${weeksUntilRace}-week training plan with:
- Base phase: weeks 1-${baseEnd}
- Build phase: weeks ${baseEnd + 1}-${buildEnd}
- Peak phase: weeks ${buildEnd + 1}-${peakEnd}
- Taper phase: weeks ${peakEnd + 1}-${taperEnd}
- Progressive overload week over week
- Recovery weeks every 3-4 weeks
- Consider fitness, mileage, injuries, fatigue, sleep, stress
- Cross training, lifting, plyometrics where appropriate
- Specific, detailed workouts
- Rest days with purpose (mobility, foam rolling, etc.)

Output ONLY this JSON format, nothing else:

{
  "totalWeeks": ${weeksUntilRace},
  "raceDate": "${raceDateStr}",
  "goal": "brief description of the athlete's goal",
  "phases": [
    { "name": "Base", "weekStart": 1, "weekEnd": ${baseEnd} },
    { "name": "Build", "weekStart": ${baseEnd + 1}, "weekEnd": ${buildEnd} },
    { "name": "Peak", "weekStart": ${buildEnd + 1}, "weekEnd": ${peakEnd} },
    { "name": "Taper", "weekStart": ${peakEnd + 1}, "weekEnd": ${taperEnd} }
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

    let plan;
    try {
      plan = JSON.parse(rawText);
    } catch(e) {
      console.error("Failed to parse plan JSON:", rawText);
      throw new Error("AI returned invalid plan format. Please try again.");
    }

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

// ============================================================
// GET PLAN
// ============================================================
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

// ============================================================
// LOG WORKOUT
// ============================================================
app.post("/api/log-workout", requireAuth, async (req, res) => {
  try {
    const { weekNumber, dayName } = req.body;
    const userId = req.user.id;
    await pool.query(
      `INSERT INTO workout_logs (user_id, week_number, day_name, completed, completed_at)
       VALUES ($1, $2, $3, true, NOW())
       ON CONFLICT (user_id, week_number, day_name) DO NOTHING`,
      [userId, weekNumber, dayName]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET WORKOUT LOGS
// ============================================================
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

// ============================================================
// UPDATE PLAN — coach proposed change
// ============================================================
app.post("/api/update-plan", requireAuth, async (req, res) => {
  try {
    const { weekNumber, dayIndex, newWorkout, newType } = req.body;
    const userId = req.user.id;

    const profileResult = await pool.query(
      "SELECT plan FROM profiles WHERE user_id = $1",
      [userId]
    );

    const profile = profileResult.rows[0];
    if (!profile || !profile.plan)
      return res.status(404).json({ error: "No plan found" });

    const plan = JSON.parse(profile.plan);
    const week = plan.weeks.find(w => w.week === weekNumber);
    if (!week) return res.status(404).json({ error: "Week not found" });

    if (week.days[dayIndex]) {
      week.days[dayIndex].workout = newWorkout;
      if (newType) week.days[dayIndex].type = newType;
    }

    await pool.query(
      "UPDATE profiles SET plan = $1 WHERE user_id = $2",
      [JSON.stringify(plan), userId]
    );

    console.log(`✅ Plan updated for user ${userId} — Week ${weekNumber}, Day ${dayIndex}`);
    res.json({ success: true, plan });

  } catch (error) {
    console.error("Update plan error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AI COACH CHAT
// ============================================================
const coachHistory = {};

app.post("/api/coach", requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.id;

    const profileResult = await pool.query(
      "SELECT quiz_data, plan FROM profiles WHERE user_id = $1",
      [userId]
    );

    const profile = profileResult.rows[0];
    const quizData = profile?.quiz_data ? JSON.parse(profile.quiz_data) : {};
    const plan = profile?.plan ? JSON.parse(profile.plan) : {};

    if (!coachHistory[userId]) coachHistory[userId] = [];
    coachHistory[userId].push({ role: "user", content: message });
    if (coachHistory[userId].length > 10) {
      coachHistory[userId] = coachHistory[userId].slice(-10);
    }

    const injuryKeywords = ["hurt", "pain", "injury", "injured", "sore", "strain", "sprain", "pulled", "torn", "ache"];
    const prKeywords = ["pr", "personal record", "personal best", "pb", "new record", "fastest"];
    const hasInjury = injuryKeywords.some(k => message.toLowerCase().includes(k));
    const hasPR = prKeywords.some(k => message.toLowerCase().includes(k));

    const systemPrompt = `You are an elite AI running coach for PaceForge. You are science-backed, evidence-based, and deeply knowledgeable about exercise science, periodization, injury prevention, nutrition, and athlete development.

ATHLETE PROFILE:
${JSON.stringify(quizData, null, 2)}

CURRENT TRAINING PLAN:
- Goal: ${plan.goal || "Not set"}
- Total Weeks: ${plan.totalWeeks || "Unknown"}
- Race Date: ${plan.raceDate || "Not set"}
- Current weeks: ${JSON.stringify(plan.weeks?.slice(0, 3) || [])}

RULES:
- Only give science-backed advice
- Be conversational but professional — like a real coach texting their athlete
- Keep responses concise — this is a chat not an essay
- If the athlete mentions an injury ask clarifying questions
- If you want to propose a plan change, end your message with this on a new line:
  PLAN_CHANGE:{"week":1,"dayIndex":2,"workout":"New workout description","type":"Rest"}
- Only suggest one change at a time
- IMPORTANT: Only send PLAN_CHANGE if there's a real reason. Do NOT send it by default.
- Format it EXACTLY as shown. Do not add extra text after PLAN_CHANGE.
- If the athlete mentions a PR celebrate it and ask for details
- Never recommend anything that could cause harm
- Always consider the athlete's fatigue, sleep, and stress from their profile
${hasInjury ? "- The athlete may be injured. Consider proposing a plan modification using PLAN_CHANGE." : ""}
${hasPR ? "- The athlete may have set a PR. Ask for details to log it." : ""}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          { role: "system", content: systemPrompt },
          ...coachHistory[userId]
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "OpenAI API error");
    }

    const data = await response.json();
    let reply = data.choices[0].message.content.trim();
    let planChange = null;

    if (reply.includes("PLAN_CHANGE:")) {
      const parts = reply.split("PLAN_CHANGE:");
      reply = parts[0].trim();
      try {
        planChange = JSON.parse(parts[1].trim());
      } catch(e) {
        console.error("Failed to parse PLAN_CHANGE:", parts[1]);
        planChange = null;
      }
    }

    coachHistory[userId].push({ role: "assistant", content: reply });

    if (hasPR) console.log(`🏆 PR detected for user ${userId}`);
    console.log(`💬 Coach reply sent to user ${userId}`);

    res.json({ reply, hasInjury, hasPR, planChange });

  } catch (error) {
    console.error("Coach error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET COACH HISTORY
// ============================================================
app.get("/api/coach-history", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const history = coachHistory[userId] || [];
    res.json(history);
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
