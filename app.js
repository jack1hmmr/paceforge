// ============================================================
// app.js — PaceForge Training Plan (Multi-Week)
// ============================================================

let fullPlan = null;
let currentWeek = 1;
let completedWorkouts = {};

// DOM elements
const loadingState    = document.getElementById("loadingState");
const errorState      = document.getElementById("errorState");
const planGrid        = document.getElementById("planGrid");
const errorMessage    = document.getElementById("errorMessage");
const progressSection = document.getElementById("progressSection");
const progressFill    = document.getElementById("progressFill");
const progressCount   = document.getElementById("progressCount");
const completedBadge  = document.getElementById("completedBadge");
const weekNav         = document.getElementById("weekNav");
const weekLabel       = document.getElementById("weekLabel");
const weekPhase       = document.getElementById("weekPhase");
const weekFocus       = document.getElementById("weekFocus");
const phaseBar        = document.getElementById("phaseBar");
const weekSummary     = document.getElementById("weekSummary");
const toast           = document.getElementById("toast");
const toastTitle      = document.getElementById("toastTitle");
const toastSub        = document.getElementById("toastSub");

// ============================================================
// LOAD PLAN
// ============================================================
async function loadPlan() {
  show(loadingState);
  hide(errorState);
  hide(planGrid);
  hide(progressSection);
  hide(weekNav);
  hide(phaseBar);
  hide(weekSummary);

  try {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "signin.html";
      return;
    }

    const response = await fetch("/api/plan", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Could not load plan");
    }

    fullPlan = await response.json();

    // Load completed workouts
    await loadCompletedWorkouts();

    // Set plan meta
    document.getElementById("metaGoal").textContent = fullPlan.goal || "—";
    document.getElementById("metaRaceDate").textContent = fullPlan.raceDate || "—";
    document.getElementById("metaTotalWeeks").textContent = fullPlan.totalWeeks + " weeks";

    // Find current week based on today
    currentWeek = findCurrentWeek();

    // Build phase bar
    buildPhaseBar();

    hide(loadingState);
    show(weekNav);
    show(phaseBar);
    show(progressSection);
    show(weekSummary);

    renderWeek(currentWeek);

  } catch (error) {
    console.error("Error loading plan:", error);
    hide(loadingState);
    show(errorState);
    errorMessage.textContent = error.message;
  }
}

// ============================================================
// FIND CURRENT WEEK
// ============================================================
function findCurrentWeek() {
  // Start at week 1, could be smarter with actual dates later
  return 1;
}

// ============================================================
// BUILD PHASE BAR
// ============================================================
function buildPhaseBar() {
  if (!fullPlan.phases) return;
  phaseBar.innerHTML = "";

  const phaseColors = {
    "Base": "#3ecf8e",
    "Build": "#ffb347",
    "Peak": "#f4530c",
    "Taper": "#888888"
  };

  fullPlan.phases.forEach(phase => {
    const width = ((phase.weekEnd - phase.weekStart + 1) / fullPlan.totalWeeks) * 100;
    const div = document.createElement("div");
    div.className = "phase-segment";
    div.style.width = width + "%";
    div.style.background = phaseColors[phase.name] || "#444";
    div.innerHTML = `<span>${phase.name}</span>`;
    div.onclick = () => {
      currentWeek = phase.weekStart;
      renderWeek(currentWeek);
    };
    phaseBar.appendChild(div);
  });
}

// ============================================================
// RENDER WEEK
// ============================================================
function renderWeek(weekNum) {
  currentWeek = weekNum;
  const weekData = fullPlan.weeks.find(w => w.week === weekNum);
  if (!weekData) return;

  // Update nav
  weekLabel.textContent = `Week ${weekNum} of ${fullPlan.totalWeeks}`;
  weekPhase.textContent = weekData.phase || "";
  weekFocus.textContent = weekData.focus || "";

  // Update summary
  document.getElementById("summaryMiles").textContent = weekData.totalMiles ? weekData.totalMiles + " mi" : "—";
  document.getElementById("summaryPhase").textContent = weekData.phase || "—";

  // Disable prev/next buttons
  document.getElementById("prevWeek").disabled = weekNum <= 1;
  document.getElementById("nextWeek").disabled = weekNum >= fullPlan.totalWeeks;

  // Build workout cards
  planGrid.innerHTML = "";
  show(planGrid);

  weekData.days.forEach((day, index) => {
    const dayName  = day.name || `Day ${index + 1}`;
    const dayShort = dayName.substring(0, 3).toUpperCase();
    const workout  = day.workout || "Rest";
    const type     = day.type || "";
    const key      = `${weekNum}-${dayName}`;
    const isDone   = completedWorkouts[key] === true;

    const card = document.createElement("div");
    card.className = "workout-card" + (isDone ? " completed" : "");
    card.dataset.key = key;

    const typeColor = getTypeColor(type);

    card.innerHTML = `
      <div class="day-label">
        <span class="day-name">${dayShort}</span>
        <span class="day-num" style="color: ${typeColor}">${type}</span>
      </div>
      <div class="workout-info">
        <p class="workout-text">${escapeHtml(workout)}</p>
      </div>
      <button class="complete-btn" onclick="markComplete(this, '${escapeHtml(dayName)}', ${weekNum})">
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

  updateWeekProgress(weekNum, weekData.days.length);
  updateOverallProgress();
}

// ============================================================
// GET TYPE COLOR
// ============================================================
function getTypeColor(type) {
  const colors = {
    "Easy Run": "#3ecf8e",
    "Long Run": "#ffb347",
    "Workout": "#f4530c",
    "Tempo": "#f4530c",
    "Intervals": "#f4530c",
    "Cross Training": "#4a9eff",
    "Rest": "#444",
    "Recovery": "#3ecf8e"
  };
  return colors[type] || "#888";
}

// ============================================================
// CHANGE WEEK
// ============================================================
function changeWeek(direction) {
  const newWeek = currentWeek + direction;
  if (newWeek < 1 || newWeek > fullPlan.totalWeeks) return;
  renderWeek(newWeek);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
// MARK COMPLETE
// ============================================================
async function markComplete(button, dayName, weekNum) {
  const card = button.closest(".workout-card");
  if (card.classList.contains("completed")) return;

  card.classList.add("completed");

  const key = `${weekNum}-${dayName}`;
  completedWorkouts[key] = true;

  // Save to server
  try {
    const token = localStorage.getItem("token");
    await fetch("/api/log-workout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ weekNumber: weekNum, dayName })
    });
  } catch (e) {
    console.error("Could not save workout log:", e);
  }

  const weekData = fullPlan.weeks.find(w => w.week === weekNum);
  updateWeekProgress(weekNum, weekData?.days.length || 7);
  updateOverallProgress();

  showToast(`${dayName} complete! 🏃`, "Keep building momentum.");
}

// ============================================================
// LOAD COMPLETED WORKOUTS
// ============================================================
async function loadCompletedWorkouts() {
  try {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/workout-logs", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const logs = await res.json();
    logs.forEach(log => {
      completedWorkouts[`${log.week_number}-${log.day_name}`] = true;
    });
  } catch (e) {
    console.error("Could not load workout logs:", e);
  }
}

// ============================================================
// UPDATE PROGRESS
// ============================================================
function updateWeekProgress(weekNum, totalDays) {
  const weekDone = Object.keys(completedWorkouts).filter(k => k.startsWith(`${weekNum}-`)).length;
  document.getElementById("summaryDone").textContent = `${weekDone} / ${totalDays}`;
}

function updateOverallProgress() {
  const totalWorkouts = fullPlan.totalWeeks * 7;
  const totalDone = Object.keys(completedWorkouts).length;
  const percent = Math.round((totalDone / totalWorkouts) * 100);

  progressFill.style.width = percent + "%";
  progressCount.textContent = `Week ${currentWeek} of ${fullPlan.totalWeeks}`;
  if (completedBadge) completedBadge.textContent = percent + "% done";
}

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;

function showToast(title, subtitle) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toast.classList.add("hidden");
    setTimeout(() => _displayToast(title, subtitle), 80);
  } else {
    _displayToast(title, subtitle);
  }
}

function _displayToast(title, subtitle) {
  toastTitle.textContent = title;
  toastSub.textContent = subtitle;
  toast.classList.remove("hidden", "fade-out");
  toastTimer = setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => {
      toast.classList.add("hidden");
      toastTimer = null;
    }, 350);
  }, 3500);
}

// ============================================================
// HELPERS
// ============================================================
function show(el) { if (el) el.classList.remove("hidden"); }
function hide(el) { if (el) el.classList.add("hidden"); }

function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(String(text)));
  return div.innerHTML;
}

// ============================================================
// START
// ============================================================
const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "signin.html";
} else {
  loadPlan();
}
