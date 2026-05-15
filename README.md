# Quran Academy Manager

A lightweight dashboard to manage teachers, students, class schedules, and attendance (with reports + export).

## Prerequisites
- Node.js (LTS recommended)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   - Set your Gemini key (optional): `GEMINI_API_KEY` in `.env.local`
   - API base URL (already defaulted): `VITE_API_BASE_URL=http://localhost:5000`

## Run (Frontend + SQLite API)
Open two terminals:

**Terminal 1 (SQLite API):**
```bash
npm run server
```

**Terminal 2 (Frontend):**
```bash
npm run dev
```

Or run both together:
```bash
npm run dev:full
```

## Updates included

- Teacher attendance can be marked from the Attendance tab in the same style as students.
- Class Days supports **1 to 7 days/week**.
- Bulk import teachers + students via CSV.
- Login code can be changed from **Settings**.

## CSV Bulk Import

Open **Enrollment → Import CSV**.

### Required columns

- `teacher_name`
- `teacher_zoom_link`
- `student_name`
- `time_slot` (HH:mm, example: 16:00)
- `class_days` (1..7)

### Optional columns

- `teacher_id`
- `student_id`

### Example

```csv
teacher_name,teacher_zoom_link,student_name,time_slot,class_days
Ustadh Ali,https://zoom.us/j/123,Ahmad,16:00,5
Ustadh Ali,https://zoom.us/j/123,Fatima,16:00,5
Ustadha Maryam,https://zoom.us/j/456,Zainab,17:30,2
```

Notes:

- Each row represents one student. Repeat the teacher on multiple rows to add many students.
- You can add a teacher without students by leaving `student_name` empty on a row.

## SQLite database location
By default the database file is created here:
- `server/quran-academy.db`

You can override the path:
```bash
DB_PATH=./my-db.sqlite npm run server
```
