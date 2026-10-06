"use strict";

const STORAGE_KEYS = {
    profile: "studyMate_profile",
    subjects: "studyMate_subjects",
    tasks: "studyMate_tasks",
    sessions: "studyMate_sessions",
    quizzes: "studyMate_quizzes",
    revisions: "studyMate_revisions",
    resources: "studyMate_resources",
    settings: "studyMate_settings",
    notifications: "studyMate_notifications",
    achievements: "studyMate_achievements",
    activity: "studyMate_activity",
};

const ARRAY_KEYS = ["subjects", "tasks", "sessions", "quizzes", "revisions", "resources", "notifications", "achievements", "activity"];
const DEFAULTS = {
    profile: { name: "", course: "", year: "", availableHours: "", preferredTime: "", weeklyGoal: "" },
    subjects: [],
    tasks: [],
    sessions: [],
    quizzes: [],
    revisions: [],
    resources: [],
    settings: { theme: "light" },
    notifications: [],
    achievements: [],
    activity: [],
};

let noticeTimeout;
let timerInterval;
let timerTotalSeconds = 25 * 60;
let timerRemainingSeconds = 25 * 60;
let timerElapsedSeconds = 0;
let timerStartedAt = 0;
let timerIsRunning = false;
let focusBreakMinutes = 5;
let focusMode = "pomodoro";
let previousFocusMinutes = 25;
let previousFocusBreakMinutes = 5;
let previousFocusMode = "pomodoro";

function createId() {
    return globalThis.crypto?.randomUUID?.() || `study-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayISO() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function addDays(dateString, days) {
    const date = new Date(`${dateString}T12:00:00`);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(from, to) {
    return Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000);
}

function formatDate(dateString) {
    if (!dateString) return "No date set";
    return new Date(`${dateString}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatHours(minutes) {
    if (minutes > 0 && minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr${hours === 1 ? "" : "s"}`;
}

function formatDuration(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(totalMinutes / 60);
    const remainder = totalMinutes % 60;
    if (!hours) return `${remainder} min`;
    if (!remainder) return `${hours} hr${hours === 1 ? "" : "s"}`;
    return `${hours} hr ${remainder} min`;
}

function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

function showMessage(message, isError = false) {
    let notice = document.getElementById("app-notice");
    if (!notice) {
        notice = document.createElement("div");
        notice.id = "app-notice";
        notice.className = "app-notice";
        notice.setAttribute("role", "status");
        document.body.append(notice);
    }
    notice.textContent = message;
    notice.classList.toggle("is-error", isError);
    notice.classList.add("is-visible");
    clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(() => notice.classList.remove("is-visible"), 5000);
}

function loadData(key) {
    const storageKey = STORAGE_KEYS[key];
    if (!storageKey) throw new Error(`Unknown StudyMate data key: ${key}`);
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return structuredClone(DEFAULTS[key]);
    try {
        const parsed = JSON.parse(raw);
        if (ARRAY_KEYS.includes(key) && !Array.isArray(parsed)) throw new TypeError(`${key} must be an array.`);
        if (!ARRAY_KEYS.includes(key) && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) {
            throw new TypeError(`${key} must be an object.`);
        }
        return parsed;
    } catch (error) {
        showMessage(`Could not read saved ${key} data. ${error.message}`, true);
        return structuredClone(DEFAULTS[key]);
    }
}

function saveData(key, value) {
    const storageKey = STORAGE_KEYS[key];
    if (!storageKey) throw new Error(`Unknown StudyMate data key: ${key}`);
    try {
        localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (error) {
        showMessage(`Could not save ${key}. Check browser storage availability and try exporting or clearing old data. ${error.message}`, true);
        throw error;
    }
    document.dispatchEvent(new CustomEvent("studymate:data-changed", { detail: { key } }));
    return value;
}

function updateData(key, updater) {
    if (typeof updater !== "function") throw new TypeError("updateData expects an updater function.");
    return saveData(key, updater(loadData(key)));
}

function deleteData(key, id) {
    if (!ARRAY_KEYS.includes(key)) throw new Error(`Cannot delete an item from ${key}.`);
    return updateData(key, (items) => items.filter((item) => item.id !== id));
}

function initializeStorage() {
    for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
        if (localStorage.getItem(storageKey) === null) {
            saveData(key, structuredClone(DEFAULTS[key]));
        }
    }

    const legacyPlans = localStorage.getItem("plans");
    if (legacyPlans) {
        try {
            const parsed = JSON.parse(legacyPlans);
            if (Array.isArray(parsed) && parsed.length) {
                const tasks = loadData("tasks");
                const migrated = parsed.map((plan) => ({
                    id: createId(),
                    subject: String(plan.subject || "Untitled subject"),
                    topic: "Study session",
                    type: "Learn",
                    date: todayISO(),
                    examDate: plan.exam || "",
                    duration: Math.max(10, Number(plan.hours || 1) * 60),
                    difficulty: 2,
                    confidence: 2,
                    priority: plan.priority || "Medium",
                    status: "pending",
                    createdAt: new Date().toISOString(),
                    migrated: true,
                }));
                saveData("tasks", [...tasks, ...migrated]);
            }
            localStorage.removeItem("plans");
        } catch (error) {
            showMessage(`Your earlier plan data could not be migrated: ${error.message}`, true);
        }
    }

    const previousTheme = localStorage.getItem("studymate-theme");
    if (previousTheme === "light" || previousTheme === "dark") {
        const settings = loadData("settings");
        settings.theme = previousTheme;
        saveData("settings", settings);
        localStorage.removeItem("studymate-theme");
    }
    applyTheme();
}

function applyTheme() {
    const theme = loadData("settings").theme === "dark" ? "dark" : "light";
    document.body.dataset.theme = theme;
}

function setTheme(theme) {
    updateData("settings", (settings) => ({ ...settings, theme }));
    applyTheme();
}

function activity(message, type = "study") {
    const entry = { id: createId(), message, type, date: new Date().toISOString() };
    updateData("activity", (items) => [entry, ...items].slice(0, 30));
}

function getWeakTopics() {
    const quizzes = loadData("quizzes");
    const grouped = new Map();
    quizzes.forEach((quiz) => {
        const key = `${quiz.subject.toLocaleLowerCase()}|${quiz.topic.toLocaleLowerCase()}`;
        const current = grouped.get(key) || { subject: quiz.subject, topic: quiz.topic, totalPercent: 0, count: 0, latest: quiz.date };
        current.totalPercent += Number(quiz.percent);
        current.count += 1;
        if (quiz.date > current.latest) current.latest = quiz.date;
        grouped.set(key, current);
    });
    return [...grouped.values()]
        .map((item) => ({ ...item, percent: Math.round(item.totalPercent / item.count) }))
        .filter((item) => item.percent < 75)
        .sort((a, b) => a.percent - b.percent);
}

function getTopicPerformance(subject, topic) {
    const matching = loadData("quizzes").filter((quiz) =>
        quiz.subject.toLowerCase() === subject.toLowerCase() && quiz.topic.toLowerCase() === topic.toLowerCase());
    if (!matching.length) return null;
    return Math.round(matching.reduce((sum, quiz) => sum + quiz.percent, 0) / matching.length);
}

function calculatePriority(task, studentData = collectStudentData()) {
    const subject = studentData.subjects.find((item) => item.name.toLowerCase() === task.subject.toLowerCase());
    const daysToExam = task.examDate ? daysBetween(todayISO(), task.examDate) : subject?.examDate ? daysBetween(todayISO(), subject.examDate) : null;
    const weak = studentData.weakTopics.find((item) =>
        item.subject.toLowerCase() === task.subject.toLowerCase() && item.topic.toLowerCase() === task.topic.toLowerCase());
    const priority = { High: 24, Medium: 12, Low: 4 }[task.priority] || 8;
    const difficulty = Number(task.difficulty || 2) * 8;
    const confidence = (4 - Number(task.confidence || subject?.confidence || 2)) * 9;
    const examUrgency = daysToExam === null ? 0 : Math.max(0, 35 - Math.max(0, daysToExam) * 3);
    const performance = weak ? (75 - weak.percent) * 0.7 : 0;
    const overdue = task.date < todayISO() && task.status === "pending" ? 20 : 0;
    const subjectSessions = studentData.sessions.filter((session) => session.subject.toLowerCase() === task.subject.toLowerCase());
    const lastSessionDate = subjectSessions.map((session) => session.date).sort().at(-1);
    const consistencyGap = !lastSessionDate ? 5 : daysBetween(lastSessionDate, todayISO()) >= 4 ? 4 : 0;
    return Math.round(priority + difficulty + confidence + examUrgency + performance + overdue + consistencyGap);
}

function calculateReadiness(subject, studentData = collectStudentData()) {
    const factors = [];
    const subjectTasks = studentData.tasks.filter((task) => task.subject.toLowerCase() === subject.name.toLowerCase());
    if (subjectTasks.length) {
        const completed = subjectTasks.filter((task) => task.status === "completed").length;
        factors.push({ weight: 20, value: (completed / subjectTasks.length) * 100, label: "planned tasks" });
    }
    const quizzes = studentData.quizzes.filter((quiz) => quiz.subject.toLowerCase() === subject.name.toLowerCase());
    if (quizzes.length) {
        const average = quizzes.reduce((sum, quiz) => sum + quiz.percent, 0) / quizzes.length;
        factors.push({ weight: 15, value: average, label: "quiz performance" });
    }
    const subjectRevisions = studentData.revisions.filter((item) => item.subject.toLowerCase() === subject.name.toLowerCase());
    if (subjectRevisions.length) {
        const completed = subjectRevisions.filter((item) => item.status === "completed").length;
        factors.push({ weight: 10, value: completed / subjectRevisions.length * 100, label: "revisions" });
    }
    const subjectSessions = studentData.sessions.filter((session) => session.subject.toLowerCase() === subject.name.toLowerCase());
    if (subjectSessions.length) {
        const practiced = new Set(subjectSessions.map((session) => session.date)).size;
        factors.push({ weight: 10, value: Math.min(100, practiced / 5 * 100), label: "study consistency" });
    }
    if (subject.confidence) {
        factors.push({ weight: 20, value: Math.min(100, Number(subject.confidence) / 3 * 100), label: "self-reported confidence" });
    }
    if (subject.examDate) {
        const remaining = daysBetween(todayISO(), subject.examDate);
        factors.push({ weight: 5, value: remaining < 0 ? 20 : Math.max(15, Math.min(100, remaining * 10 + 10)), label: "time before exam" });
    }
    const weakTopics = studentData.weakTopics.filter((topic) => topic.subject.toLowerCase() === subject.name.toLowerCase());
    if (weakTopics.length) {
        const weakAverage = weakTopics.reduce((sum, topic) => sum + topic.percent, 0) / weakTopics.length;
        factors.push({ weight: 20, value: weakAverage, label: "weak-topic performance" });
    }
    const hasStudyEvidence = subjectTasks.length > 0 || quizzes.length > 0 || subjectRevisions.length > 0 || subjectSessions.length > 0;
    if (factors.length < 2 || !subject.examDate || !hasStudyEvidence) return { score: null, factors };
    const totalWeight = factors.reduce((sum, item) => sum + item.weight, 0);
    const score = Math.round(factors.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight);
    return { score, factors };
}

function calculateStudyStreak(sessions = loadData("sessions")) {
    const dates = new Set(sessions.filter((item) => Number(item.durationMinutes) > 0).map((item) => item.date));
    let cursor = todayISO();
    if (!dates.has(cursor)) cursor = addDays(cursor, -1);
    let streak = 0;
    while (dates.has(cursor)) {
        streak += 1;
        cursor = addDays(cursor, -1);
    }
    return streak;
}

function getStudyAnalytics() {
    const sessions = loadData("sessions");
    const tasks = loadData("tasks");
    const quizzes = loadData("quizzes");
    const weekStart = addDays(todayISO(), -6);
    const weeklySessions = sessions.filter((item) => item.date >= weekStart && item.date <= todayISO());
    const weeklyTasks = tasks.filter((item) => item.date >= todayISO() && item.date <= addDays(todayISO(), 6));
    const subjectMinutes = {};
    const periodMinutes = {};
    sessions.forEach((item) => { subjectMinutes[item.subject || "Unassigned"] = (subjectMinutes[item.subject || "Unassigned"] || 0) + Number(item.durationMinutes || 0); });
    sessions.forEach((item) => {
        if (!item.studyPeriod) return;
        periodMinutes[item.studyPeriod] = (periodMinutes[item.studyPeriod] || 0) + Number(item.durationMinutes || 0);
    });
    const quizBySubject = {};
    quizzes.forEach((quiz) => {
        const current = quizBySubject[quiz.subject] || { total: 0, count: 0 };
        current.total += quiz.percent;
        current.count += 1;
        quizBySubject[quiz.subject] = current;
    });
    return {
        totalMinutes: sessions.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0),
        weeklyMinutes: weeklySessions.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0),
        weeklyPlannedMinutes: weeklyTasks.reduce((sum, item) => sum + Number(item.duration || 0), 0),
        plannedMinutes: tasks.reduce((sum, item) => sum + Number(item.duration || 0), 0),
        completedMinutes: tasks.filter((item) => item.status === "completed").reduce((sum, item) => sum + Number(item.duration || 0), 0),
        completedTasks: tasks.filter((item) => item.status === "completed").length,
        pendingTasks: tasks.filter((item) => item.status === "pending").length,
        subjectMinutes,
        periodMinutes,
        quizBySubject,
        weeklySessions,
    };
}

function getRemainingStudyMinutes(date = todayISO(), tasks = loadData("tasks"), sessions = loadData("sessions")) {
    const profile = loadData("profile");
    const available = getAvailableStudyMinutes(profile);
    const planned = tasks.filter((item) => item.date === date && item.status === "pending")
        .reduce((sum, item) => sum + Number(item.duration || 0), 0);
    const studied = date === todayISO() ? sessions.filter((item) => item.date === date)
        .reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0) : 0;
    return Math.max(0, available - planned - studied);
}

function getAvailableStudyMinutes(profile = loadData("profile")) {
    const hours = Number(profile.availableHours);
    return Number.isFinite(hours) && hours > 0 ? hours * 60 : 0;
}

function getWorkload(date = todayISO(), allTasks = loadData("tasks"), allSessions = loadData("sessions")) {
    const profile = loadData("profile");
    const available = getAvailableStudyMinutes(profile);
    const tasks = allTasks.filter((item) => item.date === date && item.status === "pending");
    const planned = tasks.reduce((sum, item) => sum + Number(item.duration || 0), 0);
    const studied = date === todayISO() ? allSessions.filter((item) => item.date === date)
        .reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0) : 0;
    return { available, planned, studied, count: tasks.length, total: planned + studied, date };
}

function generateRevisionSchedule(task, performance = null) {
    const score = performance ?? getTopicPerformance(task.subject, task.topic);
    const intervals = score !== null && score < 50 ? [1, 2, 4, 7] : score !== null && score >= 90 ? [3, 7, 14, 30] : [1, 3, 7, 14];
    const existing = loadData("revisions").filter((item) => item.sourceTaskId === task.id);
    if (existing.length) return existing;
    const revisions = intervals.map((days, index) => ({
        id: createId(),
        sourceTaskId: task.id,
        subject: task.subject,
        topic: task.topic,
        date: addDays(todayISO(), days),
        intervalDays: days,
        sequence: index + 1,
        status: "pending",
    }));
    updateData("revisions", (items) => [...items, ...revisions]);
    return revisions;
}

function collectStudentData() {
    return {
        profile: loadData("profile"),
        subjects: loadData("subjects"),
        tasks: loadData("tasks"),
        sessions: loadData("sessions"),
        quizzes: loadData("quizzes"),
        revisions: loadData("revisions"),
        weakTopics: getWeakTopics(),
    };
}

function generateRecommendation(studentData = collectStudentData()) {
    const pending = studentData.tasks.filter((task) => task.status === "pending");
    const studiedToday = studentData.sessions.filter((item) => item.date === todayISO())
        .reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
    const availableHours = Number(studentData.profile.availableHours);
    if (!Number.isFinite(availableHours) || availableHours <= 0) {
        return {
            title: "Set your daily study availability",
            minutes: 0,
            reason: "Add your realistic study hours per day in Settings so I can recommend a session that fits your schedule without overloading you.",
        };
    }
    const available = Math.max(0, availableHours * 60 - studiedToday);
    if (available === 0) {
        return {
            title: "You've used today's available study time",
            minutes: 0,
            reason: "Your planned study time is at its daily limit. Take a break or adjust your availability in Settings before adding another session.",
        };
    }

    const weakCandidates = studentData.weakTopics.map((topic) => {
        const subject = studentData.subjects.find((item) => item.name.toLowerCase() === topic.subject.toLowerCase());
        return {
            task: {
                subject: topic.subject, topic: topic.topic, type: "Practice", date: todayISO(),
                examDate: subject?.examDate || "", duration: Math.min(45, available),
                difficulty: 3, confidence: Number(subject?.confidence || 1), priority: "High", status: "pending",
            },
            topic,
        };
    });
    const revisionCandidates = studentData.revisions
        .filter((revision) => revision.status === "pending" && revision.date <= todayISO())
        .map((revision) => {
            const subject = studentData.subjects.find((item) => item.name.toLowerCase() === revision.subject.toLowerCase());
            return {
                task: {
                    subject: revision.subject, topic: revision.topic, type: "Revision", date: revision.date,
                    examDate: subject?.examDate || "", duration: 30, difficulty: 2,
                    confidence: Number(subject?.confidence || 2), priority: "High", status: "pending",
                },
                topic: null,
            };
        });
    const taskCandidates = pending.map((task) => ({ task, topic: null }));
    const best = [...taskCandidates, ...weakCandidates, ...revisionCandidates]
        .sort((a, b) => calculatePriority(b.task, studentData) - calculatePriority(a.task, studentData))[0];
    if (best?.topic) {
        return {
            title: `${best.topic.subject} → ${best.topic.topic} → Practice`,
            minutes: Math.min(45, available),
            reason: `Your latest quiz average on this topic is ${best.topic.percent}%.${best.task.examDate ? ` The exam is in ${Math.max(0, daysBetween(todayISO(), best.task.examDate))} day(s).` : ""} A focused practice session should help close the gap.`,
        };
    }
    if (best?.task) {
        const task = best.task;
        const subject = studentData.subjects.find((item) => item.name.toLowerCase() === task.subject.toLowerCase());
        const minutes = Math.min(Number(task.duration || 45), available);
        const examDate = task.examDate || subject?.examDate;
        const daysToExam = examDate ? daysBetween(todayISO(), examDate) : null;
        const reasons = [];
        if (daysToExam !== null && daysToExam <= 5) reasons.push(`your exam is in ${Math.max(0, daysToExam)} day(s)`);
        if (task.date < todayISO()) reasons.push("this task is overdue");
        if (Number(task.confidence) <= 1) reasons.push("you marked your confidence as low");
        const reason = reasons.length ? reasons.join(" and ") : "it is your highest-priority pending task";
        return {
            title: `${task.subject} → ${task.topic} → ${task.type}`,
            minutes,
            reason: `Spend ${minutes} minutes on this because ${reason}.`,
            taskId: task.id,
        };
    }

    const subject = [...studentData.subjects].sort((a, b) => Number(a.confidence || 2) - Number(b.confidence || 2))[0];
    if (subject) {
        const examInfo = subject.examDate ? `, with an exam ${Math.max(0, daysBetween(todayISO(), subject.examDate))} days away` : "";
        return {
            title: `${subject.name} → Core concepts → Learn`,
            minutes: Math.min(45, available),
            reason: `Start with one core concept in ${subject.name}${examInfo}. Record a quiz result after studying to make future recommendations more specific.`,
        };
    }
    return null;
}

// Future integration: this function can send studentData to an AI backend/API.
// Keep credentials on a trusted server; never place API keys in browser code.
function generateAIRecommendation(studentData = collectStudentData(), question = "next") {
    if (question === "attention") {
        const topic = studentData.weakTopics[0];
        if (topic) return `${topic.subject} needs the most attention: ${topic.topic} is averaging ${topic.percent}%. Add a short practice task, then check your understanding with a quiz.`;
        const subject = [...studentData.subjects].sort((a, b) => Number(a.confidence || 2) - Number(b.confidence || 2))[0];
        return subject ? `${subject.name} has your lowest self-reported confidence. Add a topic quiz so I can identify a specific weak area.` : "Add your subjects and quiz results first; then I can compare your real performance.";
    }
    if (question === "readiness") {
        const ready = studentData.subjects.map((subject) => ({ subject, readiness: calculateReadiness(subject, studentData) }))
            .filter((item) => item.readiness.score !== null)
            .sort((a, b) => a.readiness.score - b.readiness.score)[0];
        if (ready) return `${ready.subject.name} is currently ${ready.readiness.score}% ready by your recorded tasks, confidence, quiz results, revision, and consistency. ${studentData.weakTopics.find((topic) => topic.subject === ready.subject.name) ? `Prioritize ${studentData.weakTopics.find((topic) => topic.subject === ready.subject.name).topic}.` : "Add more quiz results and study tasks to make this estimate stronger."}`;
        return "I need an exam date plus study evidence (such as completed tasks or quiz results) before I can estimate readiness.";
    }
    if (question === "revision") {
        const due = studentData.revisions.filter((item) => item.status === "pending" && item.date <= todayISO()).sort((a, b) => a.date.localeCompare(b.date))[0];
        if (due) return `Revise ${due.subject} → ${due.topic} today. This spaced-repetition review is due ${formatDate(due.date)}.`;
        const weak = studentData.weakTopics[0];
        return weak ? `No scheduled revision is due today. Use 25 minutes to revisit ${weak.subject} → ${weak.topic}; your latest average is ${weak.percent}%.` : "No revision is due and there are no quiz-identified weak topics. Complete a study task to create a spaced-repetition schedule.";
    }
    if (question === "behind") {
        const overdue = studentData.tasks.filter((task) => task.status === "pending" && task.date < todayISO());
        const workload = getWorkload();
        if (overdue.length) return `You have ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}. Reschedule the most important one from the planner; I’ll avoid placing it beyond your daily time budget.`;
        if (workload.total > workload.available) return `Today's plan is ${formatDuration(workload.total)} against ${formatDuration(workload.available)} available. Move a task to another day or reduce its duration.`;
        return "I don’t see overdue tasks or an overloaded day. If you feel behind, add your missed topics and exam dates so the plan reflects what changed.";
    }
    if (question === "tomorrow") {
        return createTomorrowPlan(studentData);
    }
    const recommendation = generateRecommendation(studentData);
    return recommendation
        ? `${recommendation.title}. ${recommendation.reason}`
        : "Add your name and subjects in Settings, then record a task or quiz result. I’ll use that information to recommend your next study step.";
}

function createTomorrowPlan(studentData = collectStudentData()) {
    const tomorrow = addDays(todayISO(), 1);
    const tasks = loadData("tasks");
    const existing = tasks.filter((task) => task.status === "pending" && task.date === tomorrow);
    const budget = getAvailableStudyMinutes(studentData.profile);
    if (!budget) return "Set your daily available study hours in Settings before I schedule tomorrow.";
    let remaining = Math.max(0, budget - existing.reduce((sum, task) => sum + Number(task.duration || 0), 0));
    const candidates = tasks.filter((task) => task.status === "pending" && task.date !== tomorrow)
        .sort((a, b) => calculatePriority(b, studentData) - calculatePriority(a, studentData));
    const planned = [];
    candidates.forEach((task) => {
        if (planned.length >= 3 || remaining <= 0) return;
        const duration = Number(task.duration || 45);
        if (duration > remaining) return;
        planned.push({ ...task, date: tomorrow });
        remaining -= duration;
    });
    if (planned.length) {
        const replacements = new Map(planned.map((task) => [task.id, task]));
        saveData("tasks", tasks.map((task) => replacements.get(task.id) || task));
        activity(`Planned ${planned.length} study task${planned.length === 1 ? "" : "s"} for ${formatDate(tomorrow)}.`, "schedule");
        const newlyScheduledMinutes = planned.reduce((sum, task) => sum + Number(task.duration || 0), 0);
        const alreadyScheduledMinutes = existing.reduce((sum, task) => sum + Number(task.duration || 0), 0);
        return `I scheduled ${planned.map((task) => `${task.subject} — ${task.topic} (${task.duration} min)`).join("; ")} for tomorrow. That's ${formatHours(newlyScheduledMinutes + alreadyScheduledMinutes)} total, within your ${formatHours(budget)} daily limit.`;
    }
    if (existing.length) return `Tomorrow already has ${existing.map((task) => `${task.subject} — ${task.topic}`).join("; ")} scheduled, using ${formatHours(existing.reduce((sum, task) => sum + Number(task.duration || 0), 0))} of your ${formatHours(budget)} daily availability.`;
    if (!candidates.length) return "There are no pending tasks to schedule. Add a study task first; I won’t invent a workload for you.";
    return `Tomorrow has ${formatHours(remaining)} free, but your highest-priority pending task needs more time than that. Reduce its duration or increase your availability before moving it.`;
}

function addNotification(id, message, type) {
    updateData("notifications", (items) => {
        if (items.some((item) => item.id === id)) return items;
        return [{ id, message, type, createdAt: new Date().toISOString(), read: false }, ...items].slice(0, 30);
    });
}

function refreshNotifications() {
    const tasks = loadData("tasks");
    const subjects = loadData("subjects");
    const revisions = loadData("revisions");
    const weakTopics = getWeakTopics();
    tasks.filter((task) => task.status === "pending" && task.date < todayISO()).forEach((task) =>
        addNotification(`missed-${task.id}`, `Missed task: ${task.subject} — ${task.topic}. Reschedule it when you're ready.`, "missed"));
    subjects.filter((subject) => subject.examDate && daysBetween(todayISO(), subject.examDate) >= 0 && daysBetween(todayISO(), subject.examDate) <= 7)
        .forEach((subject) => addNotification(`exam-${subject.id}-${subject.examDate}`, `${subject.name} exam is in ${daysBetween(todayISO(), subject.examDate)} day(s).`, "exam"));
    revisions.filter((revision) => revision.status === "pending" && revision.date <= todayISO())
        .forEach((revision) => addNotification(`revision-${revision.id}`, `Revision due: ${revision.subject} — ${revision.topic}.`, "revision"));
    weakTopics.forEach((topic) => addNotification(`weak-${topic.subject}-${topic.topic}`, `${topic.subject} — ${topic.topic} needs practice (${topic.percent}% average).`, "weak"));
    Array.from({ length: 8 }, (_, index) => addDays(todayISO(), index)).forEach((date) => {
        const workload = getWorkload(date);
        if (workload.available > 0 && workload.total > workload.available) {
            addNotification(`overload-${date}`, `${date === todayISO() ? "Today's" : `${formatDate(date)} schedule`} is overloaded: ${formatDuration(workload.total)} planned, ${formatDuration(workload.available)} available.`, "overload");
        }
    });
}

function renderEmpty(container, message) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = message;
    container.replaceChildren(empty);
}

function renderBrief(data) {
    const greeting = document.getElementById("greeting");
    const subtitle = document.getElementById("dashboard-subtitle");
    const brief = document.getElementById("daily-brief");
    if (!brief) return;
    const firstName = data.profile.name.trim().split(/\s+/)[0];
    const localHour = new Date().getHours();
    const greetingText = localHour < 12 ? "Good morning" : localHour < 17 ? "Good afternoon" : "Good evening";
    if (greeting) greeting.textContent = firstName ? `${greetingText}, ${firstName}` : "Your study day";
    if (subtitle) subtitle.textContent = data.profile.course
        ? `${data.profile.course}${data.profile.year ? ` · ${data.profile.year}` : ""} — let's choose a thoughtful next step.`
        : "A clearer next step starts with your study profile.";

    const todayTasks = data.tasks.filter((task) => task.date === todayISO() && task.status === "pending");
    const totalMinutes = todayTasks.reduce((sum, task) => sum + Number(task.duration || 0), 0);
    const hoursBadge = document.getElementById("brief-hours");
    if (hoursBadge) hoursBadge.textContent = `${formatHours(totalMinutes)} planned`;
    const bestTask = [...todayTasks].sort((a, b) => calculatePriority(b, data) - calculatePriority(a, data))[0];
    const weak = data.weakTopics[0];
    const nextExam = data.subjects.filter((subject) => subject.examDate && subject.examDate >= todayISO())
        .sort((a, b) => a.examDate.localeCompare(b.examDate))[0];
    const recommendation = generateRecommendation(data);
    const entries = [
        ["Top priority", bestTask ? `${bestTask.subject} · ${bestTask.topic} · ${bestTask.duration} min` : "No tasks scheduled for today."],
        ["Focus topic", weak ? `${weak.subject} · ${weak.topic} (${weak.percent}% on quizzes)` : "Record quiz results to identify weak topics."],
        ["Upcoming exam", nextExam ? `${nextExam.name} · ${daysBetween(todayISO(), nextExam.examDate)} day(s) away` : "Add an exam date to a subject."],
        ["Recommended session", recommendation
            ? recommendation.minutes > 0 ? `${recommendation.title} · ${recommendation.minutes} min` : recommendation.title
            : "Add subjects to get your first recommendation."],
        ["Pending tasks", `${data.tasks.filter((task) => task.status === "pending").length} tasks across your schedule`],
        ["Study time", `${Number(data.profile.availableHours) > 0 ? `${Number(data.profile.availableHours)} available hours/day` : "Set daily availability in Settings"} · ${data.profile.preferredTime || "No preferred time set"}`],
    ];
    brief.replaceChildren(...entries.map(([title, value]) => {
        const item = document.createElement("div");
        item.className = "brief-item";
        const heading = document.createElement("strong");
        heading.textContent = title;
        const content = document.createElement("span");
        content.textContent = value;
        item.append(heading, content);
        return item;
    }));
}

function readinessExplanation(subject, data) {
    const weak = data.weakTopics.find((item) => item.subject.toLowerCase() === subject.name.toLowerCase());
    return weak ? `Focus next on ${weak.topic} (${weak.percent}%).` : "Add quiz results to identify topic-level gaps.";
}

function renderDashboard(data) {
    const readiness = document.getElementById("readiness-list");
    if (readiness) {
        if (!data.subjects.length) renderEmpty(readiness, "No subjects yet. Add your first subject in Settings to build exam readiness.");
        else {
            readiness.replaceChildren(...data.subjects.map((subject) => {
                const result = calculateReadiness(subject, data);
                const row = document.createElement("div");
                row.className = "list-item";
                const text = document.createElement("div");
                text.className = "list-item-main";
                const name = document.createElement("strong");
                name.textContent = subject.name;
                const detail = document.createElement("span");
                detail.textContent = subject.examDate ? `Exam ${formatDate(subject.examDate)} · ${Math.max(0, daysBetween(todayISO(), subject.examDate))} day(s) left` : "No exam date set";
                text.append(name, detail);
                if (result.score !== null) {
                    const progress = document.createElement("div");
                    progress.className = "progress-track";
                    const fill = document.createElement("span");
                    fill.style.width = `${result.score}%`;
                    progress.append(fill);
                    detail.append(progress);
                    const explanation = document.createElement("span");
                    explanation.className = "readiness-explanation";
                    explanation.textContent = `Based on ${result.factors.map((factor) => factor.label).join(", ")}. ${readinessExplanation(subject, data)}`;
                    detail.append(explanation);
                    const badge = document.createElement("span");
                    badge.className = "badge";
                    badge.textContent = `${result.score}% ready`;
                    row.append(text, badge);
                    name.title = result.factors.map((factor) => factor.label).join(", ");
                } else {
                    const badge = document.createElement("span");
                    badge.className = "badge";
                    badge.textContent = "More data needed";
                    row.append(text, badge);
                }
                return row;
            }));
        }
    }

    const notificationList = document.getElementById("notification-list");
    if (notificationList) {
        const notifications = loadData("notifications");
        const count = document.getElementById("alert-count");
        if (count) count.textContent = `${notifications.filter((item) => !item.read).length} new`;
        if (!notifications.length) renderEmpty(notificationList, "No alerts right now. We'll flag upcoming exams, revisions, weak topics, and schedule conflicts.");
        else {
            notificationList.replaceChildren(...notifications.slice(0, 5).map((item) => {
                const row = document.createElement("div");
                row.className = "list-item";
                const text = document.createElement("div");
                text.className = "list-item-main";
                const message = document.createElement("strong");
                message.textContent = item.message;
                const category = document.createElement("span");
                category.textContent = item.type;
                text.append(message, category);
                row.append(text);
                return row;
            }));
        }
    }

    const tasksList = document.getElementById("today-task-list");
    if (tasksList) {
        const tasks = data.tasks.filter((task) => task.date === todayISO() && task.status === "pending")
            .sort((a, b) => calculatePriority(b, data) - calculatePriority(a, data));
        renderTaskRows(tasksList, tasks.slice(0, 5), "No tasks planned for today. Add a task in the planner or build an adaptive schedule.", { delete: true });
    }

    const weakList = document.getElementById("weak-topic-list");
    if (weakList) {
        const weakTopics = data.weakTopics.slice(0, 5);
        if (!weakTopics.length) renderEmpty(weakList, "No weak topics identified yet. Record a quiz result to let the coach find topics that need practice.");
        else weakList.replaceChildren(...weakTopics.map((item) => {
            const row = document.createElement("div");
            row.className = "list-item";
            const text = document.createElement("div");
            text.className = "list-item-main";
            const title = document.createElement("strong");
            title.textContent = `${item.subject} · ${item.topic}`;
            const detail = document.createElement("span");
            detail.textContent = item.percent < 50 ? `Weak · ${item.percent}% average` : `Needs practice · ${item.percent}% average`;
            text.append(title, detail);
            row.append(text);
            return row;
        }));
    }

    const analyticsList = document.getElementById("weekly-analytics");
    if (analyticsList) {
        const analytics = getStudyAnalytics();
        const mostStudied = Object.entries(analytics.subjectMinutes).sort((a, b) => b[1] - a[1])[0];
        const items = [
            ["Study time", formatHours(analytics.weeklyMinutes)],
            ["Tasks complete", `${analytics.completedTasks} completed · ${analytics.pendingTasks} pending`],
            ["Most studied", mostStudied ? `${mostStudied[0]} · ${formatHours(mostStudied[1])}` : "No focus sessions recorded yet"],
            ["Most productive time", Object.entries(analytics.periodMinutes).sort((a, b) => b[1] - a[1])[0]?.[0] || "Record focus sessions to find your pattern"],
            ["Current streak", `${calculateStudyStreak()} day(s) · ${calculateXP()} XP`],
        ];
        analyticsList.replaceChildren(...items.map(([title, value]) => {
            const row = document.createElement("div");
            row.className = "list-item";
            const text = document.createElement("div");
            text.className = "list-item-main";
            const label = document.createElement("strong");
            label.textContent = title;
            const detail = document.createElement("span");
            detail.textContent = value;
            text.append(label, detail);
            row.append(text);
            return row;
        }));
    }

    const achievementList = document.getElementById("achievement-list");
    if (achievementList) {
        updateAchievements();
        const earned = new Set(loadData("achievements").map((item) => item.id));
        const all = [
            ["streak-3", "3-Day Consistency"], ["hours-10", "10 Hours Studied"],
            ["topics-5", "5 Topics Practiced"], ["exam-ready", "Exam Ready"],
        ];
        achievementList.replaceChildren(...all.map(([id, label]) => {
            const badge = document.createElement("span");
            badge.className = `achievement${earned.has(id) ? "" : " locked"}`;
            badge.textContent = `${earned.has(id) ? "✓" : "○"} ${label}`;
            return badge;
        }));
    }
}

function renderTaskRows(container, tasks, emptyMessage, options = {}) {
    if (!tasks.length) {
        renderEmpty(container, emptyMessage);
        return;
    }
    container.replaceChildren(...tasks.map((task) => {
        const row = document.createElement("div");
        row.className = `list-item${task.status === "completed" ? " status-completed" : ""}`;
        const content = document.createElement("div");
        content.className = "list-item-main";
        const title = document.createElement("strong");
        title.textContent = `${task.subject} · ${task.topic}`;
        const detail = document.createElement("span");
        detail.textContent = `${task.type} · ${task.duration} min · ${formatDate(task.date)} · ${task.priority} priority`;
        content.append(title, detail);
        const actions = document.createElement("div");
        actions.className = "list-item-actions";
        if (task.status === "pending") {
            actions.append(actionButton("Complete", "complete-task", task.id), actionButton("Reschedule", "reschedule-task", task.id));
            if (options.edit) actions.append(actionButton("Edit", "edit-task", task.id));
            if (options.delete) actions.append(actionButton("Delete", "delete-task", task.id, true));
        } else {
            const completed = document.createElement("span");
            completed.className = "badge";
            completed.textContent = "Completed";
            actions.append(completed, actionButton("Mark incomplete", "incomplete-task", task.id));
            if (options.delete) actions.append(actionButton("Delete", "delete-task", task.id, true));
        }
        row.append(content, actions);
        return row;
    }));
}

function actionButton(label, action, id, danger = false) {
    const button = document.createElement("button");
    button.className = `small-button${danger ? " danger" : ""}`;
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = id;
    button.textContent = label;
    return button;
}

function renderPlanner() {
    const tasksContainer = document.getElementById("planner-task-list");
    if (!tasksContainer) return;
    const filter = document.getElementById("task-filter")?.value || "all";
    const tasks = loadData("tasks").filter((task) => filter === "all" || task.status === filter)
        .sort((a, b) => a.date.localeCompare(b.date) || calculatePriority(b) - calculatePriority(a));
    renderTaskRows(tasksContainer, tasks, "No tasks yet. Add a study task or build an adaptive schedule.", { edit: true, delete: true });
    renderRevisions();
    renderWorkload();
}

function renderRevisions() {
    const container = document.getElementById("revision-list");
    if (!container) return;
    const revisions = loadData("revisions").filter((item) => item.status === "pending")
        .sort((a, b) => a.date.localeCompare(b.date));
    if (!revisions.length) {
        renderEmpty(container, "Your revision queue is clear. Completing a study task will schedule spaced reviews.");
        return;
    }
    container.replaceChildren(...revisions.map((revision) => {
        const row = document.createElement("div");
        row.className = "list-item";
        const main = document.createElement("div");
        main.className = "list-item-main";
        const title = document.createElement("strong");
        title.textContent = `${revision.subject} · ${revision.topic}`;
        const detail = document.createElement("span");
        detail.textContent = `Revision ${revision.sequence} · ${formatDate(revision.date)}${revision.date <= todayISO() ? " · Due" : ""}`;
        main.append(title, detail);
        const actions = document.createElement("div");
        actions.className = "list-item-actions";
        actions.append(actionButton("Mark revised", "complete-revision", revision.id));
        row.append(main, actions);
        return row;
    }));
}

function renderWorkload() {
    const container = document.getElementById("workload-status");
    if (!container) return;
    const workload = getWorkload();
    if (!workload.available) {
        container.className = "card overload-card";
        container.textContent = "Set your daily available study hours in Settings to analyze workload balance.";
        return;
    }
    const futureOverload = Array.from({ length: 7 }, (_, index) => getWorkload(addDays(todayISO(), index + 1)))
        .find((day) => day.total > day.available);
    const isOverloaded = workload.total > workload.available;
    const isHeavy = workload.total > workload.available * .8;
    const level = isOverloaded || futureOverload ? "is-overloaded" : isHeavy ? "is-heavy" : "";
    container.className = `card overload-card ${level}`.trim();
    const title = isOverloaded ? "Your schedule is overloaded."
        : futureOverload ? "Your schedule is becoming overloaded."
            : isHeavy ? "Your schedule is getting heavy." : "Your schedule is balanced.";
    const extra = isOverloaded
        ? " Consider moving a task to another day."
        : futureOverload ? ` ${formatDate(futureOverload.date)} has ${formatDuration(futureOverload.total)} planned against ${formatDuration(futureOverload.available)} available. Move one or more tasks to create space.`
            : isHeavy ? " Keep some room for breaks and unexpected work." : " There is room for focused work and breaks.";
    container.replaceChildren();
    const heading = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = title;
    heading.append(strong, document.createTextNode(` Today: ${formatDuration(workload.total)} planned/studied of ${formatDuration(workload.available)} available.${extra}`));
    container.append(heading);
}

function populateSubjectOptions() {
    const names = loadData("subjects").map((subject) => subject.name);
    ["subject-options", "quiz-subject-options", "resource-subject-options"].forEach((id) => {
        const list = document.getElementById(id);
        if (list) list.replaceChildren(...names.map((name) => {
            const option = document.createElement("option");
            option.value = name;
            return option;
        }));
    });
}

function renderSubjectList() {
    const container = document.getElementById("subject-list");
    if (!container) return;
    const subjects = loadData("subjects");
    if (!subjects.length) {
        renderEmpty(container, "No subjects yet. Add one with its exam date and your current confidence.");
        return;
    }
    container.replaceChildren(...subjects.map((subject) => {
        const row = document.createElement("div");
        row.className = "list-item";
        const info = document.createElement("div");
        info.className = "list-item-main";
        const name = document.createElement("strong");
        name.textContent = subject.name;
        const detail = document.createElement("span");
        detail.textContent = `${subject.examDate ? `Exam ${formatDate(subject.examDate)}` : "No exam date"} · Confidence: ${["", "Low", "Some", "High"][subject.confidence] || "Some"}`;
        info.append(name, detail);
        const actions = document.createElement("div");
        actions.className = "list-item-actions";
        actions.append(actionButton("Edit", "edit-subject", subject.id), actionButton("Remove", "delete-subject", subject.id, true));
        row.append(info, actions);
        return row;
    }));
}

function renderSettings() {
    const profile = loadData("profile");
    const form = document.getElementById("profile-form");
    if (form) {
        form.elements.name.value = profile.name || "";
        form.elements.course.value = profile.course || "";
        form.elements.year.value = profile.year || "";
        form.elements.availableHours.value = profile.availableHours || "";
        form.elements.preferredTime.value = profile.preferredTime || "";
        form.elements.weeklyGoal.value = profile.weeklyGoal || "";
    }
    renderSubjectList();
}

function renderResources() {
    const container = document.getElementById("resource-list");
    if (!container) return;
    const status = document.getElementById("resource-filter")?.value || "all";
    const resources = loadData("resources").filter((item) => status === "all" || item.status === status);
    if (!resources.length) {
        renderEmpty(container, "No saved resources yet. Add a video, documentation link, notes, practice set, or quiz.");
        return;
    }
    container.replaceChildren(...resources.map((resource) => {
        const card = document.createElement("article");
        card.className = "card resource-item";
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = `${resource.type} · ${resource.difficulty}`;
        const title = document.createElement("h3");
        title.textContent = resource.title;
        const details = document.createElement("p");
        details.textContent = `${resource.subject} · ${resource.topic}`;
        const actions = document.createElement("div");
        actions.className = "resource-actions";
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Status for ${resource.title}`);
        select.dataset.action = "resource-status";
        select.dataset.id = resource.id;
        ["Not Started", "In Progress", "Completed"].forEach((value) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            option.selected = resource.status === value;
            select.append(option);
        });
        actions.append(select);
        if (resource.url) {
            const link = document.createElement("a");
            link.className = "small-button";
            link.href = resource.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Open resource ↗";
            actions.append(link);
        } else {
            const search = document.createElement("a");
            const query = encodeURIComponent(`${resource.subject} ${resource.topic} ${resource.type} ${resource.difficulty}`);
            search.className = "small-button";
            search.href = `https://www.youtube.com/results?search_query=${query}`;
            search.target = "_blank";
            search.rel = "noopener noreferrer";
            search.textContent = "Find a video ↗";
            actions.append(search);
        }
        card.append(badge, title, details, actions);
        return card;
    }));
}

function classifyQuiz(percent) {
    if (percent >= 90) return "Excellent";
    if (percent >= 75) return "Good";
    if (percent >= 50) return "Needs Practice";
    return "Weak";
}

function renderProgress() {
    const summary = document.getElementById("progress-summary");
    if (!summary) return;
    const analytics = getStudyAnalytics();
    const dataExists = analytics.totalMinutes || analytics.completedTasks || loadData("quizzes").length;
    if (!dataExists) {
        renderEmpty(summary, "No study data yet. Add a subject, complete a task, or record a focus session to build your personal analytics.");
    } else {
        const mostStudied = Object.entries(analytics.subjectMinutes).sort((a, b) => b[1] - a[1])[0];
        const weakestQuizSubject = Object.entries(analytics.quizBySubject)
            .map(([name, result]) => [name, result.total / result.count])
            .sort((a, b) => a[1] - b[1])[0];
        const values = [
            ["Total study time", formatHours(analytics.totalMinutes)],
            ["This week", formatHours(analytics.weeklyMinutes)],
            ["Tasks completed", analytics.completedTasks],
            ["Tasks pending", analytics.pendingTasks],
            ["Planned vs actual", `${formatHours(analytics.plannedMinutes)} / ${formatHours(analytics.totalMinutes)}`],
            ["Most studied subject", mostStudied ? `${mostStudied[0]} · ${formatHours(mostStudied[1])}` : "No sessions yet"],
            ["Weakest quiz subject", weakestQuizSubject ? `${weakestQuizSubject[0]} · ${Math.round(weakestQuizSubject[1])}% average` : "Record quizzes to compare subjects"],
            ["Most productive time", Object.entries(analytics.periodMinutes).sort((a, b) => b[1] - a[1])[0]?.[0] || "Not enough session data"],
            ["Study streak", `${calculateStudyStreak()} day(s)`],
            ["XP earned", `${calculateXP()} XP`],
        ];
        summary.replaceChildren(...values.map(([label, value]) => {
            const card = document.createElement("article");
            card.className = "card";
            const heading = document.createElement("p");
            heading.className = "stat-label";
            heading.textContent = label;
            const metric = document.createElement("p");
            metric.className = "stat-value";
            metric.textContent = value;
            card.append(heading, metric);
            return card;
        }));
    }

    renderBarChart("subject-analytics", Object.entries(analytics.subjectMinutes).map(([name, minutes]) => [name, minutes, formatHours(minutes)]), "Complete a focus session to see study time by subject.");
    renderBarChart("quiz-analytics", Object.entries(analytics.quizBySubject).map(([name, result]) => [name, result.total / result.count, `${Math.round(result.total / result.count)}% average`]), "Record quiz results to compare your subject performance.");
    renderWeeklyChart(analytics.weeklySessions);
    const weakContainer = document.getElementById("progress-weak-topics");
    if (weakContainer) {
        const weak = getWeakTopics();
        if (!weak.length) renderEmpty(weakContainer, "No weak topics recorded. Topics below 75% average will appear here.");
        else weakContainer.replaceChildren(...weak.map((topic) => {
            const row = document.createElement("div");
            row.className = "list-item";
            const text = document.createElement("div");
            text.className = "list-item-main";
            const name = document.createElement("strong");
            name.textContent = `${topic.subject} · ${topic.topic}`;
            const state = document.createElement("span");
            state.textContent = `${classifyQuiz(topic.percent)} · ${topic.percent}%`;
            text.append(name, state);
            row.append(text);
            return row;
        }));
    }
    const recent = document.getElementById("recent-activity");
    if (recent) {
        const items = loadData("activity").slice(0, 8);
        if (!items.length) renderEmpty(recent, "Your completed study tasks, quizzes, and focus sessions will appear here.");
        else recent.replaceChildren(...items.map((item) => {
            const row = document.createElement("div");
            row.className = "list-item";
            const text = document.createElement("div");
            text.className = "list-item-main";
            const message = document.createElement("strong");
            message.textContent = item.message;
            const date = document.createElement("span");
            date.textContent = new Date(item.date).toLocaleString();
            text.append(message, date);
            row.append(text);
            return row;
        }));
    }
}

function renderBarChart(containerId, rows, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!rows.length) {
        renderEmpty(container, emptyMessage);
        return;
    }
    const max = Math.max(...rows.map((item) => Number(item[1])), 1);
    container.replaceChildren(...rows.map(([name, value, label]) => {
        const row = document.createElement("div");
        const legend = document.createElement("div");
        legend.className = "chart-row-label";
        const title = document.createElement("span");
        title.textContent = name;
        const amount = document.createElement("span");
        amount.textContent = label;
        legend.append(title, amount);
        const track = document.createElement("div");
        track.className = "progress-track";
        const fill = document.createElement("span");
        fill.style.width = `${Math.max(3, Number(value) / max * 100)}%`;
        track.append(fill);
        row.append(legend, track);
        return row;
    }));
}

function renderWeeklyChart(sessions) {
    const container = document.getElementById("weekly-chart");
    if (!container) return;
    const days = Array.from({ length: 7 }, (_, index) => addDays(todayISO(), index - 6));
    const values = days.map((day) => sessions.filter((item) => item.date === day)
        .reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0));
    const max = Math.max(...values, 60);
    container.replaceChildren(...days.map((day, index) => {
        const column = document.createElement("div");
        column.className = "week-column";
        const minutes = document.createElement("strong");
        minutes.textContent = values[index] ? `${Math.round(values[index])}m` : "";
        const bar = document.createElement("div");
        bar.className = "week-bar";
        bar.style.height = `${Math.max(3, values[index] / max * 125)}px`;
        bar.setAttribute("aria-label", `${formatDate(day)}: ${values[index]} study minutes`);
        const label = document.createElement("span");
        label.textContent = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
        column.append(minutes, bar, label);
        return column;
    }));
    const profile = loadData("profile");
    const weeklyGoal = Number(profile.weeklyGoal) > 0 ? Number(profile.weeklyGoal) * 60 : 0;
    const analytics = getStudyAnalytics();
    const goalProgress = weeklyGoal ? Math.min(100, Math.round(analytics.weeklyMinutes / weeklyGoal * 100)) : null;
    const badge = document.getElementById("weekly-goal-badge");
    const caption = document.getElementById("weekly-goal-caption");
    if (badge) badge.textContent = goalProgress === null ? "No goal set" : `${goalProgress}% of goal`;
    if (caption) caption.textContent = weeklyGoal
        ? `${formatHours(analytics.weeklyMinutes)} studied in the last 7 days of your ${formatHours(weeklyGoal)} goal · ${formatHours(analytics.weeklyPlannedMinutes)} planned for the next 7 days.`
        : `${formatHours(analytics.weeklyMinutes)} studied in the last 7 days · ${formatHours(analytics.weeklyPlannedMinutes)} planned for the next 7 days. Set a weekly goal in Settings to track it here.`;
}

function calculateXP() {
    const sessionXP = loadData("sessions").reduce((sum, session) => sum + Math.floor(Number(session.durationMinutes || 0) / 10) * 5, 0);
    const taskXP = loadData("tasks").filter((task) => task.status === "completed").length * 15;
    const quizXP = loadData("quizzes").length * 10;
    return sessionXP + taskXP + quizXP;
}

function updateAchievements() {
    const analytics = getStudyAnalytics();
    const subjectsMastered = new Set(loadData("quizzes").filter((quiz) => quiz.percent >= 90).map((quiz) => `${quiz.subject}|${quiz.topic}`)).size;
    const ready = loadData("subjects").some((subject) => calculateReadiness(subject).score >= 85);
    const current = loadData("achievements");
    const achieved = [
        ["streak-3", calculateStudyStreak() >= 3],
        ["hours-10", analytics.totalMinutes >= 600],
        ["topics-5", subjectsMastered >= 5],
        ["exam-ready", ready],
    ];
    const earned = new Set(current.map((item) => item.id));
    const updated = [...current];
    achieved.forEach(([id, unlocked]) => {
        if (unlocked && !earned.has(id)) updated.push({ id, unlockedAt: new Date().toISOString() });
    });
    if (updated.length !== current.length) saveData("achievements", updated);
}

function renderFocusTasks() {
    const select = document.getElementById("focus-task");
    if (!select) return;
    const pending = loadData("tasks").filter((task) => task.status === "pending");
    select.replaceChildren(new Option("Choose or enter a topic below", ""));
    pending.forEach((task) => select.add(new Option(`${task.subject} — ${task.topic} (${task.duration} min)`, task.id)));
}

function resetTimer(minutes, breakMinutes, mode) {
    if (timerIsRunning) return;
    timerTotalSeconds = minutes * 60;
    timerRemainingSeconds = timerTotalSeconds;
    timerElapsedSeconds = 0;
    focusBreakMinutes = breakMinutes;
    focusMode = mode;
    if (mode !== "break") {
        previousFocusMinutes = minutes;
        previousFocusBreakMinutes = breakMinutes;
        previousFocusMode = mode;
    }
    updateTimerDisplay();
    const status = document.getElementById("timer-status");
    if (status) status.textContent = "Ready when you are.";
}

function updateTimerDisplay() {
    const display = document.getElementById("timer-display");
    if (!display) return;
    const minutes = Math.floor(timerRemainingSeconds / 60);
    const seconds = timerRemainingSeconds % 60;
    display.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startTimer() {
    if (timerIsRunning) return;
    timerIsRunning = true;
    timerStartedAt = Date.now();
    const status = document.getElementById("timer-status");
    if (status) status.textContent = focusMode === "break" ? "Break in progress." : "Focus session in progress.";
    document.getElementById("timer-start").textContent = focusMode === "break" ? "Resume break" : "Resume focus";
    document.getElementById("timer-pause").disabled = false;
    timerInterval = setInterval(() => {
        const currentElapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        const totalElapsed = timerElapsedSeconds + currentElapsed;
        timerRemainingSeconds = Math.max(0, timerTotalSeconds - totalElapsed);
        updateTimerDisplay();
        if (timerRemainingSeconds <= 0) {
            pauseTimer();
            if (focusMode === "break") {
                resetTimer(previousFocusMinutes, previousFocusBreakMinutes, previousFocusMode);
                document.getElementById("timer-start").textContent = "Start focus";
                if (status) status.textContent = "Break complete. Take a breath, then start your next focus session.";
                return;
            }
            const timerStatus = document.getElementById("timer-status");
            if (timerStatus) timerStatus.textContent = `Focus interval complete. Take a ${focusBreakMinutes}-minute break, then reflect on your session.`;
            const breakButton = document.getElementById("start-break");
            if (breakButton) breakButton.hidden = false;
            openReflection();
        }
    }, 250);
}

function pauseTimer() {
    if (!timerIsRunning) return;
    timerElapsedSeconds += Math.floor((Date.now() - timerStartedAt) / 1000);
    timerIsRunning = false;
    clearInterval(timerInterval);
    const status = document.getElementById("timer-status");
    if (status) status.textContent = "Paused. Resume when you're ready.";
    document.getElementById("timer-pause").disabled = true;
}

function focusContext() {
    const selected = loadData("tasks").find((task) => task.id === document.getElementById("focus-task")?.value);
    return {
        task: selected,
        subject: document.getElementById("focus-subject")?.value.trim() || selected?.subject || "Independent study",
        topic: document.getElementById("focus-topic")?.value.trim() || selected?.topic || "Focused study",
    };
}

function openReflection() {
    const panel = document.getElementById("understanding-panel");
    if (panel) panel.hidden = false;
    const start = document.getElementById("timer-start");
    if (start) start.disabled = timerElapsedSeconds > 0;
    showMessage("Session finished. Choose how well you understood the material to save your study record.");
}

function saveFocusSession(rating) {
    const context = focusContext();
    const completedMode = focusMode;
    const completedMinutes = timerTotalSeconds / 60;
    const completedBreakMinutes = focusBreakMinutes;
    const completedSeconds = Math.min(timerTotalSeconds, Math.max(0, timerElapsedSeconds));
    const durationMinutes = Math.max(1, Math.round(completedSeconds / 60));
    if (!completedSeconds) {
        showMessage("Run the timer for at least one minute before saving a focus session.", true);
        return;
    }
    const session = {
        id: createId(),
        taskId: context.task?.id || "",
        subject: context.subject,
        topic: context.topic,
        date: todayISO(),
        startedAt: new Date(Date.now() - completedSeconds * 1000).toISOString(),
        durationMinutes,
        rating: Number(rating),
        mode: focusMode,
    };
    const sessionHour = new Date(session.startedAt).getHours();
    session.studyPeriod = sessionHour < 12 ? "Morning" : sessionHour < 17 ? "Afternoon" : sessionHour < 21 ? "Evening" : "Night";
    updateData("sessions", (items) => [...items, session]);
    const subject = loadData("subjects").find((item) => item.name.toLowerCase() === context.subject.toLowerCase());
    if (subject) {
        const confidence = Number(rating) <= 2 ? 1 : Number(rating) === 3 ? 2 : 3;
        saveData("subjects", loadData("subjects").map((item) => item.id === subject.id ? { ...item, confidence } : item));
    }
    if (context.task) {
        generateRevisionSchedule(context.task, Number(rating) <= 2 ? 40 : Number(rating) >= 5 ? 92 : 70);
    }
    activity(`Focused for ${durationMinutes} min on ${context.subject} — ${context.topic}.`, "session");
    updateAchievements();
    const streak = calculateStudyStreak();
    if ([3, 7, 14, 30].includes(streak)) addNotification(`streak-${streak}`, `You've reached a ${streak}-day study streak. Nice consistency!`, "streak");
    const panel = document.getElementById("understanding-panel");
    if (panel) panel.hidden = true;
    const breakButton = document.getElementById("start-break");
    if (breakButton) breakButton.hidden = false;
    const start = document.getElementById("timer-start");
    if (start) {
        start.disabled = false;
        start.textContent = "Start focus";
    }
    showMessage(`Saved ${durationMinutes} minute${durationMinutes === 1 ? "" : "s"} of study. Your progress and revision plan were updated.`);
    resetTimer(completedMinutes, completedBreakMinutes, completedMode);
}

function renderPage() {
    refreshNotifications();
    const data = collectStudentData();
    renderBrief(data);
    renderDashboard(data);
    renderPlanner();
    renderSettings();
    renderResources();
    renderProgress();
    populateSubjectOptions();
    renderFocusTasks();
}

function handleTaskAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    const tasks = loadData("tasks");
    const task = tasks.find((item) => item.id === id);
    if (action === "delete-subject") {
        const subject = loadData("subjects").find((item) => item.id === id);
        if (subject && window.confirm(`Remove ${subject.name} from your subject list? Related tasks and results will stay saved.`)) {
            deleteData("subjects", id);
            renderPage();
        }
        return;
    }
    if (action === "edit-subject") {
        const subject = loadData("subjects").find((item) => item.id === id);
        if (!subject) return;
        const form = document.getElementById("subject-form");
        form.elements.subjectId.value = subject.id;
        form.elements.name.value = subject.name;
        form.elements.examDate.value = subject.examDate || "";
        form.elements.confidence.value = String(subject.confidence || 2);
        document.getElementById("save-subject").textContent = "Save subject";
        document.getElementById("cancel-subject-edit").hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
    if (action === "complete-revision") {
        const revisions = loadData("revisions");
        const revision = revisions.find((item) => item.id === id);
        saveData("revisions", revisions.map((item) => item.id === id ? { ...item, status: "completed", completedAt: todayISO() } : item));
        if (revision) activity(`Revised ${revision.subject} — ${revision.topic}.`, "revision");
        renderPage();
        return;
    }
    if (!task) return;
    if (action === "complete-task") {
        saveData("tasks", tasks.map((item) => item.id === id ? { ...item, status: "completed", completedAt: new Date().toISOString() } : item));
        generateRevisionSchedule(task);
        activity(`Completed ${task.subject} — ${task.topic}.`, "task");
        updateAchievements();
        renderPage();
    } else if (action === "incomplete-task") {
        proposeReschedule({ ...task, status: "pending", completedAt: "" });
    } else if (action === "reschedule-task") {
        proposeReschedule(task);
    } else if (action === "edit-task") {
        fillTaskForm(task);
        window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (action === "delete-task" && window.confirm(`Delete ${task.subject} — ${task.topic}?`)) {
        deleteData("tasks", id);
        renderPage();
    }
}

function proposeReschedule(task) {
    const available = getAvailableStudyMinutes();
    if (!available) {
        showMessage("Set your daily available study hours in Settings before rescheduling tasks.", true);
        return false;
    }
    const adjustedDuration = Math.min(Math.round(Number(task.duration || 45) * 1.5), available);
    const tasks = loadData("tasks");
    let date = "";
    for (let attempt = 1; attempt <= 7; attempt += 1) {
        const candidate = addDays(todayISO(), attempt);
        const workload = getWorkload(candidate, tasks, loadData("sessions"));
        if (workload.total + adjustedDuration <= workload.available) {
            date = candidate;
            break;
        }
    }
    if (!date) {
        showMessage("The next seven days are full. Make room in your planner before rescheduling this task.", true);
        return false;
    }
    saveData("tasks", tasks.map((item) => item.id === task.id
        ? { ...item, status: "pending", completedAt: "", date, duration: adjustedDuration, rescheduled: true }
        : item));
    addNotification(`rescheduled-${task.id}-${date}`, `${task.subject} — ${task.topic} moved to ${formatDate(date)} after it was marked incomplete.`, "missed");
    activity(`${task.status === "completed" ? "Marked incomplete and rescheduled" : "Rescheduled"} ${task.subject} — ${task.topic} to ${formatDate(date)}.`, "reschedule");
    renderPage();
    showMessage(`Task rescheduled to ${formatDate(date)} for ${adjustedDuration} minutes.`);
    return true;
}

function fillTaskForm(task) {
    const form = document.getElementById("task-form");
    form.elements.taskId.value = task.id;
    form.elements.subject.value = task.subject;
    form.elements.topic.value = task.topic;
    form.elements.date.value = task.date;
    form.elements.examDate.value = task.examDate || "";
    form.elements.type.value = task.type;
    form.elements.difficulty.value = task.difficulty;
    form.elements.confidence.value = task.confidence;
    form.elements.priority.value = task.priority;
    form.elements.duration.value = task.duration;
    document.getElementById("save-task").textContent = "Save changes";
    document.getElementById("cancel-edit").hidden = false;
    document.getElementById("task-form-heading").textContent = "Edit study task";
}

function clearTaskForm() {
    const form = document.getElementById("task-form");
    if (!form) return;
    form.reset();
    form.elements.taskId.value = "";
    form.elements.date.value = todayISO();
    form.elements.duration.value = 45;
    form.elements.difficulty.value = "2";
    form.elements.confidence.value = "2";
    form.elements.priority.value = "Medium";
    form.elements.type.value = "Learn";
    document.getElementById("save-task").textContent = "Add task";
    document.getElementById("cancel-edit").hidden = true;
    document.getElementById("task-form-heading").textContent = "Create a study task";
}

function scheduleAdaptiveTasks() {
    const subjects = loadData("subjects");
    if (!subjects.length) {
        showMessage("Add subjects and exam dates in Settings before building an adaptive schedule.", true);
        return;
    }
    if (!getAvailableStudyMinutes()) {
        showMessage("Set your daily available study hours in Settings before building a schedule.", true);
        return;
    }
    const pending = loadData("tasks").filter((item) => item.status === "pending");
    const alreadyPlanned = new Set(pending.map((item) => item.subject.toLowerCase()));
    const studentData = collectStudentData();
    const candidates = subjects.filter((item) => !alreadyPlanned.has(item.name.toLowerCase()))
        .sort((a, b) => {
            const aTask = { subject: a.name, topic: "Core concepts", examDate: a.examDate, confidence: a.confidence, difficulty: 2, priority: "Medium", status: "pending", date: todayISO() };
            const bTask = { subject: b.name, topic: "Core concepts", examDate: b.examDate, confidence: b.confidence, difficulty: 2, priority: "Medium", status: "pending", date: todayISO() };
            return calculatePriority(bTask, studentData) - calculatePriority(aTask, studentData);
        }).slice(0, 7);
    if (!candidates.length) {
        showMessage("Every subject already has a pending task. Complete or reschedule those tasks before generating more.");
        return;
    }
    const tasks = [...loadData("tasks")];
    let added = 0;
    candidates.forEach((subject) => {
        let scheduledDate = todayISO();
        const duration = Math.min(60, Math.max(30, getAvailableStudyMinutes()));
        for (let day = 0; day < 7; day += 1) {
            scheduledDate = addDays(todayISO(), day);
            const workload = getWorkload(scheduledDate, tasks, loadData("sessions"));
            if (workload.total + duration <= workload.available) break;
            scheduledDate = "";
        }
        if (!scheduledDate) return;
        const weak = studentData.weakTopics.find((item) => item.subject.toLowerCase() === subject.name.toLowerCase());
        const topic = weak?.topic || "Core concepts";
        const performance = weak ? weak.percent : null;
        tasks.push({
            id: createId(), subject: subject.name, topic,
            type: weak ? "Practice" : "Learn", date: scheduledDate,
            examDate: subject.examDate || "", duration,
            difficulty: weak ? 3 : 2, confidence: Number(subject.confidence || 2),
            priority: subject.examDate && daysBetween(todayISO(), subject.examDate) <= 7 ? "High" : "Medium",
            status: "pending", createdAt: new Date().toISOString(), generated: true,
            performance,
        });
        added += 1;
    });
    if (!added) {
        showMessage("Your next seven days are full. Reschedule a task or increase your available hours before generating more work.", true);
        return;
    }
    saveData("tasks", tasks);
    activity(`Generated ${added} adaptive study task${added === 1 ? "" : "s"}.`, "schedule");
    renderPage();
    showMessage(`Added ${added} prioritized task${added === 1 ? "" : "s"} within your available study time.`);
}

function saveProfile(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const profile = {
        name: String(data.get("name")).trim(),
        course: String(data.get("course")).trim(),
        year: String(data.get("year")).trim(),
        availableHours: Number(data.get("availableHours")),
        preferredTime: data.get("preferredTime"),
        weeklyGoal: Number(data.get("weeklyGoal")),
    };
    if (!profile.availableHours || profile.availableHours > 16 || profile.weeklyGoal < 0 || profile.weeklyGoal > 100) {
        showMessage("Enter available hours (0.5–16 per day) and, optionally, a weekly goal up to 100 hours.", true);
        return;
    }
    saveData("profile", profile);
    document.getElementById("profile-message").textContent = "Profile saved. Your recommendations now use these preferences.";
    renderPage();
}

function saveSubject(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    if (!name) return;
    const subjects = loadData("subjects");
    const requestedId = String(data.get("subjectId") || "");
    const existing = subjects.find((item) => item.id === requestedId || item.name.toLowerCase() === name.toLowerCase());
    const subject = {
        id: existing?.id || createId(),
        name,
        examDate: data.get("examDate"),
        confidence: Number(data.get("confidence")),
        createdAt: existing?.createdAt || new Date().toISOString(),
    };
    if (existing) saveData("subjects", subjects.map((item) => item.id === existing.id ? subject : item));
    else saveData("subjects", [...subjects, subject]);
    event.currentTarget.reset();
    document.getElementById("subject-confidence").value = "2";
    document.getElementById("save-subject").textContent = "Add subject";
    document.getElementById("cancel-subject-edit").hidden = true;
    renderPage();
    showMessage(`${name} ${existing ? "updated" : "added"} to your subjects.`);
}

function saveQuiz(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const score = Number(data.get("score"));
    const total = Number(data.get("total"));
    if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0 || score < 0 || score > total) {
        document.getElementById("quiz-message").textContent = "Marks obtained must be between zero and the total marks.";
        return;
    }
    const subject = String(data.get("subject")).trim();
    const topic = String(data.get("topic")).trim();
    const percent = Math.round(score / total * 100);
    const quiz = { id: createId(), subject, topic, score, total, percent, category: classifyQuiz(percent), date: todayISO() };
    updateData("quizzes", (items) => [...items, quiz]);
    const matchingRevisions = loadData("revisions").filter((item) => item.subject.toLowerCase() === subject.toLowerCase() &&
        item.topic.toLowerCase() === topic.toLowerCase() && item.status === "pending");
    if (matchingRevisions.length && percent < 75) {
        const nextIntervals = percent < 50 ? [1, 2, 4, 7] : [2, 4, 7, 14];
        let nextIndex = 0;
        saveData("revisions", loadData("revisions").map((item) => {
            if (item.status !== "pending" || item.subject.toLowerCase() !== subject.toLowerCase() || item.topic.toLowerCase() !== topic.toLowerCase()) return item;
            const interval = nextIntervals[Math.min(nextIndex, nextIntervals.length - 1)];
            nextIndex += 1;
            return { ...item, date: addDays(todayISO(), interval), intervalDays: interval };
        }));
    } else if (matchingRevisions.length && percent >= 90) {
        let nextIndex = 0;
        saveData("revisions", loadData("revisions").map((item) => {
            if (item.status !== "pending" || item.subject.toLowerCase() !== subject.toLowerCase() || item.topic.toLowerCase() !== topic.toLowerCase()) return item;
            const interval = [3, 7, 14, 30][Math.min(nextIndex, 3)];
            nextIndex += 1;
            return { ...item, date: addDays(todayISO(), interval), intervalDays: interval };
        }));
    }
    activity(`Recorded ${percent}% in ${subject} — ${topic} (${quiz.category}).`, "quiz");
    updateAchievements();
    form.reset();
    document.getElementById("quiz-message").textContent = `${percent}% · ${quiz.category}. Your topic performance and revision schedule were updated.`;
    renderPage();
}

function saveResource(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const resource = {
        id: createId(),
        subject: String(data.get("subject")).trim(),
        topic: String(data.get("topic")).trim(),
        difficulty: data.get("difficulty"),
        type: data.get("type"),
        title: String(data.get("title")).trim(),
        url: String(data.get("url")).trim(),
        status: "Not Started",
        createdAt: new Date().toISOString(),
    };
    if (resource.url) {
        try {
            const parsed = new URL(resource.url);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http and https links are supported.");
        } catch (error) {
            document.getElementById("resource-message").textContent = error.message === "Only http and https links are supported."
                ? error.message : "Enter a valid web link beginning with https://.";
            return;
        }
    }
    updateData("resources", (items) => [resource, ...items]);
    form.reset();
    document.getElementById("resource-message").textContent = "Resource saved in your learning library.";
    renderResources();
}

function renderCoachAnswer(question) {
    const answer = document.getElementById("coach-answer");
    if (!answer) return;
    answer.textContent = generateAIRecommendation(collectStudentData(), question);
    if (question === "tomorrow") renderPage();
}

function exportData() {
    const data = {};
    Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => { data[key] = loadData(key); data[storageKey] = data[key]; });
    const file = new Blob([JSON.stringify({ app: "StudyMate AI", version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = `studymate-backup-${todayISO()}.json`;
    document.body.append(link);
    link.click();
    const downloadUrl = link.href;
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    document.getElementById("data-message").textContent = "Study data exported as a JSON backup.";
}

async function importData(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const message = document.getElementById("data-message");
    try {
        const parsed = JSON.parse(await file.text());
        const source = parsed?.data;
        if (!source || typeof source !== "object") throw new Error("This file is not a StudyMate backup.");
        const imported = {};
        Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
            const value = source[key] ?? source[storageKey];
            if (value === undefined) {
                imported[key] = structuredClone(DEFAULTS[key]);
                return;
            }
            if (ARRAY_KEYS.includes(key) && !Array.isArray(value)) throw new Error(`Invalid ${key} data in the backup.`);
            if (!ARRAY_KEYS.includes(key) && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error(`Invalid ${key} data in the backup.`);
            imported[key] = value;
        });
        const previous = Object.fromEntries(Object.values(STORAGE_KEYS).map((key) => [key, localStorage.getItem(key)]));
        try {
            Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => localStorage.setItem(storageKey, JSON.stringify(imported[key])));
        } catch (error) {
            Object.entries(previous).forEach(([key, value]) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
            throw error;
        }
        applyTheme();
        renderPage();
        message.textContent = "Backup imported. Your saved profile and study data are ready.";
    } catch (error) {
        message.textContent = `Import failed: ${error.message}`;
    } finally {
        input.value = "";
    }
}

function clearAllData() {
    if (!window.confirm("Permanently remove all StudyMate profile, subjects, plans, quizzes, focus history, resources, and settings from this browser? Export a backup first if you may need it.")) return;
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem("plans");
    localStorage.removeItem("studymate-theme");
    initializeStorage();
    renderPage();
    showMessage("All StudyMate data was cleared from this browser.");
}

function bindPageEvents() {
    document.getElementById("task-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const subject = form.elements.subject.value.trim();
        const topic = form.elements.topic.value.trim();
        const date = form.elements.date.value;
        const duration = Number(form.elements.duration.value);
        if (!subject || !topic || !date || duration < 10 || duration > 240) {
            showMessage("Enter a subject, topic, date, and a duration between 10 and 240 minutes.", true);
            return;
        }
        const data = new FormData(form);
        const task = {
            id: data.get("taskId") || createId(),
            subject, topic, type: data.get("type"), date, examDate: data.get("examDate"),
            duration, difficulty: Number(data.get("difficulty")), confidence: Number(data.get("confidence")),
            priority: data.get("priority"), status: "pending", createdAt: new Date().toISOString(),
        };
        const tasks = loadData("tasks");
        const index = tasks.findIndex((item) => item.id === task.id);
        if (index >= 0) {
            task.status = tasks[index].status;
            task.createdAt = tasks[index].createdAt;
            tasks[index] = task;
        } else tasks.push(task);
        saveData("tasks", tasks);
        activity(`${index >= 0 ? "Updated" : "Added"} ${subject} — ${topic}.`, "task");
        clearTaskForm();
        document.getElementById("planner-message").textContent = "Task saved to your study plan.";
        renderPage();
    });
    document.getElementById("cancel-edit")?.addEventListener("click", clearTaskForm);
    document.getElementById("generate-schedule")?.addEventListener("click", scheduleAdaptiveTasks);
    document.getElementById("task-filter")?.addEventListener("change", renderPlanner);
    document.getElementById("planner-task-list")?.addEventListener("click", handleTaskAction);
    document.getElementById("today-task-list")?.addEventListener("click", handleTaskAction);
    document.getElementById("revision-list")?.addEventListener("click", handleTaskAction);
    document.getElementById("subject-list")?.addEventListener("click", handleTaskAction);
    document.getElementById("profile-form")?.addEventListener("submit", saveProfile);
    document.getElementById("subject-form")?.addEventListener("submit", saveSubject);
    document.getElementById("cancel-subject-edit")?.addEventListener("click", () => {
        document.getElementById("subject-form").reset();
        document.getElementById("subject-confidence").value = "2";
        document.getElementById("save-subject").textContent = "Add subject";
        document.getElementById("cancel-subject-edit").hidden = true;
    });
    document.getElementById("quiz-form")?.addEventListener("submit", saveQuiz);
    document.getElementById("resource-form")?.addEventListener("submit", saveResource);
    document.getElementById("resource-filter")?.addEventListener("change", renderResources);
    document.getElementById("resource-list")?.addEventListener("change", (event) => {
        const select = event.target.closest('[data-action="resource-status"]');
        if (!select) return;
        updateData("resources", (items) => items.map((item) => item.id === select.dataset.id ? { ...item, status: select.value } : item));
        showMessage("Resource progress updated.");
    });

    document.getElementById("recommend-now")?.addEventListener("click", () => {
        const result = generateRecommendation();
        const output = document.getElementById("recommendation-result");
        output.hidden = false;
        output.replaceChildren();
        if (!result) {
            output.textContent = "Add your profile and at least one subject, quiz, or pending task to receive a tailored study recommendation.";
            return;
        }
        const heading = document.createElement("h3");
        heading.textContent = `${result.title} · ${result.minutes} minutes`;
        const reason = document.createElement("p");
        reason.textContent = result.reason;
        output.append(heading, reason);
        if (result.taskId) {
            const focusLink = document.createElement("a");
            focusLink.className = "small-button";
            focusLink.href = `focus.html?task=${encodeURIComponent(result.taskId)}`;
            focusLink.textContent = "Start a focus session →";
            output.append(focusLink);
        }
    });
    document.querySelectorAll("[data-coach-question]").forEach((button) =>
        button.addEventListener("click", () => renderCoachAnswer(button.dataset.coachQuestion)));
    document.getElementById("mark-alerts-read")?.addEventListener("click", () => {
        saveData("notifications", loadData("notifications").map((item) => ({ ...item, read: true })));
        renderDashboard(collectStudentData());
    });
    document.getElementById("light-mode")?.addEventListener("click", () => { setTheme("light"); showMessage("Light theme enabled."); });
    document.getElementById("dark-mode")?.addEventListener("click", () => { setTheme("dark"); showMessage("Dark theme enabled."); });
    document.getElementById("reset-data")?.addEventListener("click", clearAllData);
    document.getElementById("export-data")?.addEventListener("click", exportData);
    document.getElementById("import-data")?.addEventListener("change", importData);

    document.querySelectorAll("[data-minutes]").forEach((button) => {
        button.addEventListener("click", () => {
            document.querySelectorAll("[data-minutes]").forEach((item) => item.classList.toggle("is-active", item === button));
            document.getElementById("custom-minutes").value = "";
            resetTimer(Number(button.dataset.minutes), Number(button.dataset.break), button.dataset.minutes === "50" ? "deep" : "pomodoro");
        });
    });
    document.getElementById("custom-minutes")?.addEventListener("change", (event) => {
        const minutes = Math.max(1, Math.min(180, Number(event.currentTarget.value) || 25));
        event.currentTarget.value = minutes;
        document.querySelectorAll("[data-minutes]").forEach((item) => item.classList.remove("is-active"));
        resetTimer(minutes, 5, "custom");
    });
    document.getElementById("timer-start")?.addEventListener("click", startTimer);
    document.getElementById("timer-pause")?.addEventListener("click", pauseTimer);
    document.getElementById("timer-complete")?.addEventListener("click", () => {
        if (timerIsRunning) pauseTimer();
        openReflection();
    });
    document.getElementById("start-break")?.addEventListener("click", () => {
        const button = document.getElementById("start-break");
        button.hidden = true;
        resetTimer(focusBreakMinutes, 0, "break");
        document.getElementById("timer-start").textContent = "Start break";
        startTimer();
    });
    document.querySelectorAll("[data-understanding]").forEach((button) =>
        button.addEventListener("click", () => saveFocusSession(button.dataset.understanding)));
    document.getElementById("focus-task")?.addEventListener("change", (event) => {
        const task = loadData("tasks").find((item) => item.id === event.currentTarget.value);
        if (task) {
            document.getElementById("focus-subject").value = task.subject;
            document.getElementById("focus-topic").value = task.topic;
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initializeStorage();
    refreshNotifications();
    bindPageEvents();
    renderPage();
    const pageTaskId = new URLSearchParams(window.location.search).get("task");
    if (pageTaskId && document.getElementById("focus-task")) {
        const select = document.getElementById("focus-task");
        if ([...select.options].some((option) => option.value === pageTaskId)) {
            select.value = pageTaskId;
            select.dispatchEvent(new Event("change"));
        }
    }
});
