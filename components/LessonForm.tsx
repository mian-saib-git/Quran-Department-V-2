import React, { useMemo, useState } from "react";
import { BookOpen, Save } from "lucide-react";
import { createLesson, type ProgressStatus } from "../services/djangoApiService";

const SUBJECTS = [
  "Qaida Nooraniyya",
  "Nazira Quran",
  "Quran Memorization",
  "Tajweed",
  "Duas & Sunnah",
  "Arabic Basics",
  "Other",
];

const QAIDA_LESSONS = [
  "Lesson 1 The Alphabets",
  "Lesson 2 Joint Letters",
  "Lesson 3 The Muqattiat Letters",
  "Lesson 4 The Movements",
  "Lesson 5 The Tanween",
  "Lesson 6 The Tanween and Movement",
  "Lesson 7 The Standing Fatha, Standing Kasra and Standing Dhumma",
  "Lesson 8 The Madd and Leen",
  "Lesson 9 Exercise of Movement",
  "Lesson 10 The Sukoon and Jazam",
  "Lesson 11 The exercise of Sukoon",
  "Lesson 12 The Tashdeed",
  "Lesson 13 Exercise of Tashdeed",
  "Lesson 14 Tashdeed with Sukoon",
  "Lesson 15 Tashdeed with Tashdeed",
  "Lesson 16 Tashdeed with Huroof e Maddah",
  "Lesson 17 Ending of Rules",
];

const TAJWEED_TOPICS = [
  "Definition of Tajweed",
  "Importance of Tajweed",
  "Sources of Tajweed",
  "Objectives of Learning Tajweed",
  "Makharij",
  "Jawf letters",
  "Halq letters",
  "Lisaan letters",
  "Shafatayn letters",
  "Khayshoom",
  "Rules of Qalqalah",
  "Rules of Noon Sakinah and Tanween",
  "Rules of Meem Sakinah",
  "Ghunna",
  "Madd Tabee’i",
  "Madd Munfasil",
  "Madd Muttasil",
  "Rules of Raa",
  "Rules of Waqf",
  "Common Tajweed mistakes",
];

const DUAS_TOPICS = [
  "Dua for waking up",
  "Dua before sleeping",
  "Dua before entering the toilet",
  "Dua after leaving the toilet",
  "Dua before eating",
  "Dua after eating",
  "Dua for entering the home",
  "Dua for leaving the home",
  "Dua for entering the masjid",
  "Dua for leaving the masjid",
  "Dua when it rains",
  "Dua for increasing knowledge",
  "Dua before studying",
  "Dua after studying",
  "Dua after Salah",
  "Morning Azkar",
  "Evening Azkar",
];

const SURAHS = [
  { number: 1, name: "Al-Fatihah", ayahs: 7 },
  { number: 2, name: "Al-Baqarah", ayahs: 286 },
  { number: 3, name: "Ali Imran", ayahs: 200 },
  { number: 4, name: "An-Nisa", ayahs: 176 },
  { number: 5, name: "Al-Ma'idah", ayahs: 120 },
  { number: 6, name: "Al-An'am", ayahs: 165 },
  { number: 7, name: "Al-A'raf", ayahs: 206 },
  { number: 8, name: "Al-Anfal", ayahs: 75 },
  { number: 9, name: "At-Tawbah", ayahs: 129 },
  { number: 10, name: "Yunus", ayahs: 109 },
  { number: 11, name: "Hud", ayahs: 123 },
  { number: 12, name: "Yusuf", ayahs: 111 },
  { number: 13, name: "Ar-Ra'd", ayahs: 43 },
  { number: 14, name: "Ibrahim", ayahs: 52 },
  { number: 15, name: "Al-Hijr", ayahs: 99 },
  { number: 16, name: "An-Nahl", ayahs: 128 },
  { number: 17, name: "Al-Isra", ayahs: 111 },
  { number: 18, name: "Al-Kahf", ayahs: 110 },
  { number: 19, name: "Maryam", ayahs: 98 },
  { number: 20, name: "Taha", ayahs: 135 },
  { number: 21, name: "Al-Anbiya", ayahs: 112 },
  { number: 22, name: "Al-Hajj", ayahs: 78 },
  { number: 23, name: "Al-Mu'minun", ayahs: 118 },
  { number: 24, name: "An-Nur", ayahs: 64 },
  { number: 25, name: "Al-Furqan", ayahs: 77 },
  { number: 26, name: "Ash-Shu'ara", ayahs: 227 },
  { number: 27, name: "An-Naml", ayahs: 93 },
  { number: 28, name: "Al-Qasas", ayahs: 88 },
  { number: 29, name: "Al-Ankabut", ayahs: 69 },
  { number: 30, name: "Ar-Rum", ayahs: 60 },
];

const JUZ_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildRemark(subject: string, status: ProgressStatus, topic: string) {
  if (!status) return "";

  if (status === "excellent") {
    return `Excellent progress in ${subject}. Topics covered: ${topic}. The student is showing strong understanding and regular practice.`;
  }

  if (status === "good") {
    return `Good progress in ${subject}. Topics covered: ${topic}. Continued practice will improve confidence and consistency.`;
  }

  if (status === "satisfactory") {
    return `Satisfactory progress in ${subject}. Topics covered: ${topic}. More revision and regular practice are recommended.`;
  }

  return `Needs improvement in ${subject}. Topics covered: ${topic}. Please focus on daily practice and revision.`;
}

type Props = {
  students: any[];
  onCreated: () => void;
};

export function LessonForm({ students, onCreated }: Props) {
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState(today());
  const [subject, setSubject] = useState("Qaida Nooraniyya");
  const [otherSubject, setOtherSubject] = useState("");

  const [qaidaLesson, setQaidaLesson] = useState(QAIDA_LESSONS[0]);

  const [quranMode, setQuranMode] = useState<"surah" | "juz">("surah");
  const [juz, setJuz] = useState(1);
  const [surahNumber, setSurahNumber] = useState(1);
  const [fromAyah, setFromAyah] = useState(1);
  const [toAyah, setToAyah] = useState(1);

  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState("");

  const [progressStatus, setProgressStatus] = useState<ProgressStatus>("");
  const [remarks, setRemarks] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const finalSubject = subject === "Other" ? otherSubject.trim() : subject;

  const selectedSurah = useMemo(() => {
    return SURAHS.find((s) => s.number === surahNumber) || SURAHS[0];
  }, [surahNumber]);

  const ayahOptions = useMemo(() => {
    return Array.from({ length: selectedSurah.ayahs }, (_, i) => i + 1);
  }, [selectedSurah]);

  const topicSummary = useMemo(() => {
    if (subject === "Qaida Nooraniyya") return qaidaLesson;

    if (subject === "Nazira Quran" || subject === "Quran Memorization") {
      if (quranMode === "juz") {
        return `Juz ${juz} - ${selectedSurah.number}. ${selectedSurah.name} (Verses ${fromAyah}-${toAyah})`;
      }

      return `${selectedSurah.number}. ${selectedSurah.name} (Verses ${fromAyah}-${toAyah})`;
    }

    if (subject === "Tajweed" || subject === "Duas & Sunnah") {
      return selectedTopics.length ? selectedTopics.join(", ") : "";
    }

    return customTopic.trim();
  }, [
    subject,
    qaidaLesson,
    quranMode,
    juz,
    selectedSurah,
    fromAyah,
    toAyah,
    selectedTopics,
    customTopic,
  ]);

  const lessonData = useMemo(() => {
    if (subject === "Qaida Nooraniyya") {
      return {
        type: "qaida",
        lesson: qaidaLesson,
      };
    }

    if (subject === "Nazira Quran" || subject === "Quran Memorization") {
      return {
        type: "quran",
        mode: quranMode,
        juz: quranMode === "juz" ? juz : null,
        surah_number: selectedSurah.number,
        surah_name: selectedSurah.name,
        from_ayah: fromAyah,
        to_ayah: toAyah,
      };
    }

    if (subject === "Tajweed" || subject === "Duas & Sunnah") {
      return {
        type: "multi_topic",
        selected: selectedTopics,
      };
    }

    return {
      type: "custom",
      topic: customTopic,
    };
  }, [
    subject,
    qaidaLesson,
    quranMode,
    juz,
    selectedSurah,
    fromAyah,
    toAyah,
    selectedTopics,
    customTopic,
  ]);

  const topicList =
    subject === "Tajweed"
      ? TAJWEED_TOPICS
      : subject === "Duas & Sunnah"
      ? DUAS_TOPICS
      : [];

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      if (prev.includes(topic)) return prev.filter((item) => item !== topic);
      return [...prev, topic];
    });
  };

  const resetForm = () => {
    setDate(today());
    setSubject("Qaida Nooraniyya");
    setOtherSubject("");
    setQaidaLesson(QAIDA_LESSONS[0]);
    setQuranMode("surah");
    setJuz(1);
    setSurahNumber(1);
    setFromAyah(1);
    setToAyah(1);
    setSelectedTopics([]);
    setCustomTopic("");
    setProgressStatus("");
    setRemarks("");
    setNotes("");
  };

  const handleAutoRemark = () => {
    setRemarks(buildRemark(finalSubject, progressStatus, topicSummary));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");

    if (!studentId) {
      setMessage("Please select a student.");
      return;
    }

    if (!finalSubject) {
      setMessage("Please select or type a subject.");
      return;
    }

    if (!topicSummary) {
      setMessage("Please select the lesson topic.");
      return;
    }

    try {
      setSaving(true);

      await createLesson({
        student_id: Number(studentId),
        date,
        subject: finalSubject,
        topic_summary: topicSummary,
        progress_status: progressStatus,
        remarks,
        notes,
        lesson_data: lessonData,
      });

      setMessage("Lesson saved successfully.");
      resetForm();
      onCreated();
    } catch (error: any) {
      setMessage(error?.message || "Failed to save lesson.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-[28px] bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="sticky top-[82px] z-10 bg-white/95 backdrop-blur-xl border-b border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
            <BookOpen size={20} />
          </div>
          <div>
            <h2 className="font-extrabold text-slate-900">Write Student Lesson</h2>
            <p className="text-sm text-slate-500">
              Select student, subject, lesson and progress.
            </p>
          </div>
        </div>

        <button
          disabled={saving}
          type="submit"
          className="rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 font-extrabold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          <Save size={18} />
          {saving ? "Saving..." : "Save Lesson"}
        </button>
      </div>

      <div className="p-5 space-y-5">
        {message && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600">Student</label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Select student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name || student.username}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-600">Subject</label>
            <select
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setSelectedTopics([]);
                setCustomTopic("");
              }}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {SUBJECTS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>

        {subject === "Other" && (
          <div>
            <label className="text-xs font-bold text-slate-600">Other Subject</label>
            <input
              value={otherSubject}
              onChange={(e) => setOtherSubject(e.target.value)}
              placeholder="Type subject name..."
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        )}

        {subject === "Qaida Nooraniyya" && (
          <div>
            <label className="text-xs font-bold text-slate-600">Qaida Lesson</label>
            <select
              value={qaidaLesson}
              onChange={(e) => setQaidaLesson(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {QAIDA_LESSONS.map((lesson) => (
                <option key={lesson}>{lesson}</option>
              ))}
            </select>
          </div>
        )}

        {(subject === "Nazira Quran" || subject === "Quran Memorization") && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 space-y-4">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setQuranMode("surah")}
                className={`px-4 py-2 rounded-2xl border font-bold text-sm ${
                  quranMode === "surah"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                By Surah
              </button>

              <button
                type="button"
                onClick={() => setQuranMode("juz")}
                className={`px-4 py-2 rounded-2xl border font-bold text-sm ${
                  quranMode === "juz"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                By Juz
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {quranMode === "juz" && (
                <div>
                  <label className="text-xs font-bold text-slate-600">Juz</label>
                  <select
                    value={juz}
                    onChange={(e) => setJuz(Number(e.target.value))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                  >
                    {JUZ_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        Juz {item}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600">Surah</label>
                <select
                  value={surahNumber}
                  onChange={(e) => {
                    setSurahNumber(Number(e.target.value));
                    setFromAyah(1);
                    setToAyah(1);
                  }}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                >
                  {SURAHS.map((surah) => (
                    <option key={surah.number} value={surah.number}>
                      {surah.number}. {surah.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">From Ayah</label>
                <select
                  value={fromAyah}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setFromAyah(next);
                    if (toAyah < next) setToAyah(next);
                  }}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                >
                  {ayahOptions.map((ayah) => (
                    <option key={ayah} value={ayah}>
                      {ayah}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">To Ayah</label>
                <select
                  value={toAyah}
                  onChange={(e) => setToAyah(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                >
                  {ayahOptions
                    .filter((ayah) => ayah >= fromAyah)
                    .map((ayah) => (
                      <option key={ayah} value={ayah}>
                        {ayah}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {(subject === "Tajweed" || subject === "Duas & Sunnah") && (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <label className="text-xs font-bold text-slate-600">Select Topics</label>

            <div className="mt-3 max-h-56 overflow-y-auto rounded-2xl bg-white border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {topicList.map((topic) => (
                <label key={topic} className="flex items-center gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedTopics.includes(topic)}
                    onChange={() => toggleTopic(topic)}
                    className="h-4 w-4"
                  />
                  <span>{topic}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {(subject === "Arabic Basics" || subject === "Other") && (
          <div>
            <label className="text-xs font-bold text-slate-600">Topic Covered</label>
            <input
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="Type topic covered..."
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        )}

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold text-slate-500">Topic Summary</div>
          <div className="mt-1 font-extrabold text-slate-900">
            {topicSummary || "No topic selected"}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600">Progress Status</label>
            <select
              value={progressStatus}
              onChange={(e) => setProgressStatus(e.target.value as ProgressStatus)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Select status</option>
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="satisfactory">Satisfactory</option>
              <option value="needs_improvement">Needs Improvement</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleAutoRemark}
              className="w-full rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-700 px-4 py-3 text-sm font-extrabold hover:bg-indigo-100 transition"
            >
              Auto Generate Remarks
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600">Remarks</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder="Teacher remarks..."
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600">Extra Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optional notes..."
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        <button
          disabled={saving}
          type="submit"
          className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-4 font-extrabold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          <Save size={18} />
          {saving ? "Saving..." : "Save Lesson"}
        </button>
      </div>
    </form>
  );
}