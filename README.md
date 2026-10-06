# StudyMate AI

StudyMate AI is a local-first academic decision assistant built with plain HTML, CSS, and vanilla JavaScript. It uses a rule-based coach to recommend study actions from the student's subjects, exam dates, confidence, tasks, quiz results, revision queue, and focus history. No login, server, AI service, build step, or third-party package is required.

## Run locally

From this folder, start a static server:

```powershell
py -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Any static web server (including VS Code Live Server) also works.

## Pages

- `index.html` — introduction and profile setup entry point
- `dashboard.html` — today's study brief, recommendations, readiness, alerts, coach, and achievements
- `planner.html` — adaptive task creation, rescheduling, workload balance, and spaced revisions
- `progress.html` — session, task, quiz, subject, and weekly analytics
- `focus.html` — Pomodoro, deep-work, and custom focus sessions
- `resources.html` — topic-based personal learning library with progress statuses
- `settings.html` — student profile, subjects, theme, and JSON backup/restore

## Browser data

All study data stays in browser `localStorage` under these keys:

`studyMate_profile`, `studyMate_subjects`, `studyMate_tasks`, `studyMate_sessions`, `studyMate_quizzes`, `studyMate_revisions`, `studyMate_resources`, `studyMate_settings`, `studyMate_notifications`, `studyMate_achievements`, and `studyMate_activity`.

Use Settings to export or import a JSON backup. Existing entries saved under the older `plans` key are migrated to study tasks on first load. Clearing browser site data removes the app's local data, so export a backup first if you need a copy.
