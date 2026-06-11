PaceForge
PaceForge is an AI running coach prototype. It walks an athlete through onboarding, generates a race-specific training plan, tracks completed workouts, and lets the athlete chat with an AI coach from a phone-style dashboard.

What Is Included
Account signup and signin
Chat-style onboarding questionnaire
OpenAI-generated multi-week training plan
Workout completion tracking
AI coach chat with optional plan-change approval
iPhone-inspired dashboard UI
Setup
Install dependencies:

npm install
Create an environment file:

cp .env.example .env
Fill in .env with:

DATABASE_URL: a PostgreSQL connection string
DB_SSL: set to false for local PostgreSQL, or true for hosted databases that require SSL
OPENAI_API_KEY: an OpenAI API key
JWT_SECRET: a long random secret for signing sessions
Start the app:

npm start
Open http://localhost:3000.

Notes
The server creates its PostgreSQL tables on startup.
Static pages can load without a database, but signup, signin, onboarding, plans, and coach chat require DATABASE_URL.
Plan generation and coach chat require OPENAI_API_KEY.
