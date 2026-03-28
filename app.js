// ============================================================
// app.js — PaceForge Frontend Logic
// ============================================================

const userData = {
  mileage: "—",
  goal: "Not set yet",
  fatigue: "—",
};

const completedWorkouts = new Set();
let totalWorkouts = 0;

const loadingState    = document.getElementById("loadingState");
const errorState      = document.getElementById("errorState");
const planGrid        = document.getElementById("planGrid");
const errorMessage    = document.getElementById("errorMessage");
const progressSection = document.getElementById("progressSection");
const progressFill    = document.getElementById("progressFill");
const progressCount   = document.getElementById("progressCount");
const completedBadge  = document.getElementById("completedBadge");
const toast           = document.getElementById("toast");
const toastTitle      = document.getElementById("toastTitle");
const toastSub        = document.getElementById("toastSub");

const displayGoal    = document.getElementById("displayGoal");
const displayMileage = document.getElementById("displayMileage");
const displayFatigue = document.getElementById("displayFatigue");

if (displayGoal)    displayGoal.textContent    = userData.goal;
if (displayMileage) displayMileage.textContent = userData.mileage;
if (displayFatigue) displayFatigue.textContent = userData.fatigue;

async function loadPlan() {
  show(loadingState);
  hide(errorState);
  hide(planGrid);
  hide(progressSection);
  planGrid.innerHTML = "";

  try {
    const token = localStorage.getItem("token");

    const response = await fetch("/api/plan", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.status}`);
    }

    const plan = await response.json();

    if (!plan.days || !Array.isArray(plan.days) || plan.days.length === 0) {
      throw new Error("No plan found. Please complete the onboarding quiz first.");
    }

    totalWorkouts = plan.days.length;
    buildWorkoutCards(plan.days);

    hide(loadingState);
    show(planGrid);
    show(progressSection);
    updateProgress();

  } catch (error) {
    console.error("Error loading plan:", error);
    hide(loadingState);
    show(errorState);
    errorMessage.textContent = error.message;
  }
}

function buildWorkoutCards(days) {
  planGrid.innerHTML = "";

  days.forEach((day, index) => {
    const dayName     = day.name    || `Day ${index + 1}`;
    const workoutText = day.workout || "Rest day";
    const dayShort    = dayName.substring(0, 3).toUpperCase();

    const card = document.createElement("div");
    card.className = "workout-card";
    card.dataset.day = dayName;

    card.innerHTML = `
      <div class="day-label">
        <span class="day-name">${dayShort}</span>
        <span class="day-num">Day ${index + 1}</span>
      </div>
      <div class="workout-info">
        <p class="workout-text">${escapeHtml(workoutText)}</p>
      </div>
      <button class="complete-btn" onclick="markComplete(this, '${escapeHtml(dayName)}')">
        Mark Done
      </button>
      <div class="completed-check">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7l4 4 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Done!
      </div>
    `;

    planGrid.appendChild(card);
  });
}

function markComplete(button, dayName) {
  const card = button.closest(".workout-card");
  if (card.classList.contains("completed")) return;

  card.classList.add("completed");
  completedWorkouts.add(dayName);

  showToast(
    `${dayName} complete! 🏃`,
    completedWorkouts.size === totalWorkouts
      ? "You've finished the whole week. Incredible!"
      : "Keep going — you're building momentum."
  );

  updateProgress();
}

function updateProgress() {
  const done    = completedWorkouts.size;
  const total   = totalWorkouts;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  progressFill.style.width    = percent + "%";
  progressCount.textContent   = `${done} of ${total} workouts done`;
  if (completedBadge) completedBadge.textContent = `${done} / ${total} done`;
}

let toastTimer = null;

function showToast(title, subtitle) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toast.classList.remove("fade-out");
    toast.classList.add("hidden");
    setTimeout(() => _displayToast(title, subtitle), 80);
  } else {
    _displayToast(title, subtitle);
  }
}

function _displayToast(title, subtitle) {
  toastTitle.textContent = title;
  toastSub.textContent   = subtitle;
  toast.classList.remove("hidden", "fade-out");

  toastTimer = setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => {
      toast.classList.add("hidden");
      toastTimer = null;
    }, 350);
  }, 3500);
}

function show(el) { if (el) el.classList.remove("hidden"); }
function hide(el) { if (el) el.classList.add("hidden"); }

function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(String(text)));
  return div.innerHTML;
}

// Check if user is logged in, if not redirect to signin
const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "signin.html";
} else {
  loadPlan();
}