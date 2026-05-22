import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { AppState } from "../types";
import { X, Send, ChevronDown } from "lucide-react";
import { askGeminiAssistant } from "../services/geminiService";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface AssistantChatProps {
  appState: AppState;
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
}

type QuickAction = {
  label: string;
  prompt: string;
  icon: string;
};

const compact = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const words = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const formatTime12 = (time24: string): string => {
  const [h, m] = String(time24 || "").split(":");
  const hh = Number(h);

  if (!Number.isFinite(hh) || !m) return String(time24 || "");

  const ampm = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;

  if (h12 === 0) h12 = 12;

  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
};

const getTodayName = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long" });

const buildGeminiAssistantContext = (userMessage: string, appState: AppState) => {
  const teachers = appState.teachers ?? [];
  const students = appState.students ?? [];
  const attendance = appState.attendance ?? [];

  const todayName = getTodayName();
  const todayDate = new Date().toISOString().split("T")[0];

  const teacherById = new Map(
    teachers.map((teacher: any) => [
      String(teacher.id),
      {
        id: String(teacher.id),
        name: String(teacher.name ?? ""),
        searchKey: compact(teacher.name),
      },
    ])
  );

  const messageKey = compact(userMessage);
  const messageWords = words(userMessage).map(compact).filter(Boolean);

  const isNameMentioned = (name: string) => {
    const key = compact(name);
    if (!key) return false;

    if (messageKey.includes(key)) return true;
    if (key.includes(messageKey) && messageKey.length >= 4) return true;

    const nameWords = words(name).map(compact).filter(Boolean);

    // Match merged names:
    // Haseebullah = Haseeb Ullah
    const mergedName = nameWords.join("");
    if (mergedName && messageKey.includes(mergedName)) return true;
    if (mergedName && mergedName.includes(messageKey) && messageKey.length >= 4) return true;

    // Match individual meaningful words
    let hits = 0;

    for (const nameWord of nameWords) {
      if (nameWord.length < 3) continue;

      for (const messageWord of messageWords) {
        if (messageWord.length < 3) continue;

        if (
          nameWord === messageWord ||
          nameWord.includes(messageWord) ||
          messageWord.includes(nameWord)
        ) {
          hits += 1;
          break;
        }
      }
    }

    return hits > 0;
  };

  const scoreName = (name: string) => {
    const key = compact(name);
    if (!key) return 0;

    const nameWords = words(name).map(compact).filter(Boolean);
    const mergedName = nameWords.join("");

    let score = 0;

    if (messageKey.includes(key)) score += 140;
    if (key.includes(messageKey) && messageKey.length >= 4) score += 100;

    if (mergedName && messageKey.includes(mergedName)) score += 160;
    if (mergedName && mergedName.includes(messageKey) && messageKey.length >= 4) score += 120;

    for (const nameWord of nameWords) {
      if (nameWord.length < 3) continue;

      for (const messageWord of messageWords) {
        if (messageWord.length < 3) continue;

        if (nameWord === messageWord) score += 45;
        else if (nameWord.includes(messageWord) || messageWord.includes(nameWord)) score += 28;
      }
    }

    return score;
  };

  const studentsCompact = students.map((student: any) => {
    const teacher = teacherById.get(String(student.teacherId));
    const teacherName = teacher?.name || "Unknown Teacher";
    const classDays = Array.isArray(student.classDays) ? student.classDays : [];

    return {
      id: String(student.id ?? ""),
      name: String(student.name ?? ""),
      searchKey: compact(student.name),
      teacherId: String(student.teacherId ?? ""),
      teacherName,
      teacherSearchKey: compact(teacherName),
      timeSlot: String(student.timeSlot ?? ""),
      time: formatTime12(String(student.timeSlot ?? "")),
      classDays,
      hasClassToday: classDays.includes(todayName),
      classType: String(student.classType ?? ""),
      loginId: String(student.loginId ?? ""),
    };
  });

  const teachersCompact = teachers.map((teacher: any) => ({
    id: String(teacher.id),
    name: String(teacher.name ?? ""),
    searchKey: compact(teacher.name),
  }));

  const relevantStudents = studentsCompact
    .map((student) => {
      const studentScore = scoreName(student.name);
      const teacherScore = scoreName(student.teacherName);

      return {
        ...student,
        relevanceScore:
          studentScore +
          teacherScore +
          (student.hasClassToday ? 20 : 0),
        matchedStudentName: studentScore > 0,
        matchedTeacherName: teacherScore > 0,
      };
    })
    .filter((student) => student.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 40);

  const relevantTeachers = teachersCompact
    .map((teacher) => ({
      ...teacher,
      relevanceScore: scoreName(teacher.name),
    }))
    .filter((teacher) => teacher.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 20);

  const directMatches = studentsCompact
    .filter((student) => {
      const studentMentioned = isNameMentioned(student.name);
      const teacherMentioned = isNameMentioned(student.teacherName);

      // Best case: user mentioned both student and teacher
      if (studentMentioned && teacherMentioned) return true;

      // Also include if the student name alone is strongly mentioned
      if (studentMentioned) return true;

      return false;
    })
    .sort((a, b) => {
      const aToday = a.hasClassToday ? 1 : 0;
      const bToday = b.hasClassToday ? 1 : 0;

      return (
        bToday - aToday ||
        String(a.timeSlot).localeCompare(String(b.timeSlot)) ||
        String(a.name).localeCompare(String(b.name))
      );
    })
    .slice(0, 20);

  const todayClasses = studentsCompact
    .filter((student) => student.hasClassToday)
    .sort(
      (a, b) =>
        String(a.timeSlot).localeCompare(String(b.timeSlot)) ||
        String(a.teacherName).localeCompare(String(b.teacherName)) ||
        String(a.name).localeCompare(String(b.name))
    );

  const todayAttendance = attendance.filter((record: any) => record.date === todayDate);

  const forcedMatchedRecordsText =
    directMatches.length > 0
      ? directMatches
          .map((student) => {
            return [
              `Student: ${student.name}`,
              `Teacher: ${student.teacherName}`,
              `Time: ${student.time}`,
              `Time slot: ${student.timeSlot}`,
              `Class days: ${student.classDays.join(", ") || "Not set"}`,
              `Has class today (${todayName}): ${student.hasClassToday ? "YES" : "NO"}`,
            ].join(" | ");
          })
          .join("\n")
      : "No direct matched student record found.";

  return {
    currentDate: todayDate,
    currentDay: todayName,
    userQuestion: userMessage,

    importantInstruction:
      "Use this assistantContext first. Match names flexibly by ignoring spaces, case, punctuation, and teacher number prefixes. If directMatches has records, use those records as the highest priority source. Do not say the student is missing if directMatches contains the student.",

    forcedMatchedRecordsText,

    counts: {
      teachers: teachers.length,
      students: students.length,
      todayClasses: todayClasses.length,
      attendanceRecordsToday: todayAttendance.length,
    },

    directMatches,
    relevantStudents,
    relevantTeachers,
    todayClassesPreview: todayClasses.slice(0, 120),
    allTeachers: teachersCompact,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    const key = `line-${i}`;

    const parseLine = (raw: string): React.ReactNode => {
      const parts = raw.split(/(\*\*[^*]+\*\*)/g);

      return parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={j} style={{ fontWeight: 800, color: "inherit" }}>
              {part.slice(2, -2)}
            </strong>
          );
        }

        return part;
      });
    };

    if (line.startsWith("# ")) {
      nodes.push(
        <div key={key} style={{ fontWeight: 900, fontSize: 15, marginBottom: 4 }}>
          {parseLine(line.slice(2))}
        </div>
      );
    } else if (line.startsWith("## ")) {
      nodes.push(
        <div key={key} style={{ fontWeight: 800, fontSize: 14, marginBottom: 3 }}>
          {parseLine(line.slice(3))}
        </div>
      );
    } else if (line.startsWith("• ") || line.startsWith("- ")) {
      nodes.push(
        <div key={key} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
          <span style={{ opacity: 0.5, flexShrink: 0 }}>•</span>
          <span>{parseLine(line.slice(2))}</span>
        </div>
      );
    } else if (line === "") {
      nodes.push(<div key={key} style={{ height: 6 }} />);
    } else {
      nodes.push(
        <div key={key} style={{ marginBottom: 2 }}>
          {parseLine(line)}
        </div>
      );
    }
  });

  return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPING INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "2px 0", alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#3b82f6",
            animation: `ivsBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const AssistantChat: React.FC<AssistantChatProps> = ({
  appState,
  isOpen,
  onClose,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        "As-salamu alaykum! I'm your Academy Assistant. I can help you with student info, teacher schedules, attendance data, and more. What would you like to know?",
      timestamp: new Date(),
    },
  ]);

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !!input.trim() && !isThinking;

  const chatTheme = {
    panelBg: isDarkMode ? "#0f172a" : "#ffffff",
    panelBorder: isDarkMode ? "rgba(148, 163, 184, 0.22)" : "#e2e8f0",

    headerBg: isDarkMode
      ? "linear-gradient(135deg, #111827 0%, #1e293b 100%)"
      : "linear-gradient(135deg, #f0f7ff 0%, #e8f4fd 100%)",

    headerBorder: isDarkMode ? "rgba(148, 163, 184, 0.22)" : "#e2e8f0",
    bodyBg: isDarkMode ? "#0f172a" : "#f8fafc",
    softBg: isDarkMode ? "#111827" : "#fafbfd",

    inputWrapBg: isDarkMode ? "#0f172a" : "#f8fafc",
    inputBorder: isDarkMode ? "rgba(96, 165, 250, 0.32)" : "#e2e8f0",

    assistantBubbleBg: isDarkMode ? "#1e293b" : "#ffffff",
    assistantBubbleBorder: isDarkMode ? "rgba(148, 163, 184, 0.22)" : "#e2e8f0",

    titleText: isDarkMode ? "#f8fafc" : "#0f172a",
    bodyText: isDarkMode ? "#e5e7eb" : "#1e293b",
    mutedText: isDarkMode ? "#94a3b8" : "#64748b",
    faintText: isDarkMode ? "#64748b" : "#94a3b8",

    quickBg: isDarkMode ? "rgba(37, 99, 235, 0.14)" : "#eff6ff",
    quickBorder: isDarkMode ? "rgba(96, 165, 250, 0.35)" : "#bfdbfe",
    quickText: isDarkMode ? "#93c5fd" : "#2563eb",

    disabledBtnBg: isDarkMode ? "#1e293b" : "#f1f5f9",
    disabledBtnText: isDarkMode ? "#475569" : "#cbd5e1",
  };

  const conversationHistory = useMemo(() => {
    return messages.slice(1).map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.text,
    }));
  }, [messages]);

  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        label: "Total students",
        prompt:
          "Using the latest school data, tell me the total number of students. Keep the answer short.",
        icon: "👥",
      },
      {
        label: "Today's classes",
        prompt:
          "Using the latest school data, summarize today's classes by time slot. Include teacher names when useful.",
        icon: "📅",
      },
      {
        label: "Attendance today",
        prompt:
          "Using the latest school data, give today's attendance summary for teachers and students.",
        icon: "✅",
      },
      {
        label: "Total teachers",
        prompt:
          "Using the latest school data, tell me the total number of teachers. Keep the answer short.",
        icon: "👩‍🏫",
      },
    ],
    []
  );

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const el = scrollRef.current;
    if (!el) return;

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;

    if (isNearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, isThinking, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 200);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  }, [input]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
  }, []);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

const sendMessage = useCallback(
  async (text: string) => {
    const clean = text.trim();
    if (!clean || isThinking) return;

    const userMessage: Message = {
      role: "user",
      text: clean,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsThinking(true);

    try {
      const assistantContext = buildGeminiAssistantContext(clean, appState);

      const messageForGemini = `
User question:
${clean}

Highest priority matched school records:
${assistantContext.forcedMatchedRecordsText}

Instruction:
Answer the user using the matched school records above first. 
If a matched record says "Has class today: YES", confirm the class and mention the teacher and time.
If it says "Has class today: NO", say the student is found but does not have class today.
Only say "I do not have information" if there are truly no direct or relevant matches in the provided data.
`.trim();

      const enhancedAppState = {
        ...appState,
        assistantContext,
      } as AppState & {
        assistantContext: ReturnType<typeof buildGeminiAssistantContext>;
      };

      const reply = await askGeminiAssistant({
        message: messageForGemini,
        history: conversationHistory,
        appState: enhancedAppState,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            reply?.trim() ||
            "I could not find a clear answer from the current school data. Please ask again with a student name, teacher name, date, or class time.",
          timestamp: new Date(),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            err?.message ||
            "I could not connect to the assistant service. Please make sure the backend is running and your Gemini API setup is correct.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  },
  [isThinking, appState, conversationHistory]
);

  const handleSend = useCallback(async () => {
    if (!canSend) return;

    const text = input;
    setInput("");

    await sendMessage(text);

    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  }, [canSend, input, sendMessage]);

  if (!isOpen && !isVisible) return null;

  return (
    <>
      <style>{`
        @keyframes ivsBounce {
          0%, 80%, 100% {
            transform: translateY(0);
            opacity: 0.5;
          }
          40% {
            transform: translateY(-4px);
            opacity: 1;
          }
        }

        @keyframes ivsSlideUp {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes ivsMsgIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes ivsPulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }

        .ivs-chat-panel {
          animation: ivsSlideUp 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .ivs-msg {
          animation: ivsMsgIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .ivs-chat-scroll::-webkit-scrollbar {
          width: 5px;
        }

        .ivs-chat-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .ivs-chat-scroll::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.35);
          border-radius: 999px;
        }

        .ivs-chat-textarea::placeholder {
          color: ${isDarkMode ? "#64748b" : "#94a3b8"};
        }

        .ivs-quick-btn {
          transition: all 0.15s ease;
          cursor: pointer;
        }

        .ivs-quick-btn:hover:not(:disabled) {
          background: ${isDarkMode ? "rgba(37, 99, 235, 0.24)" : "#dbeafe"} !important;
          border-color: ${isDarkMode ? "rgba(96, 165, 250, 0.55)" : "#93c5fd"} !important;
          color: ${isDarkMode ? "#bfdbfe" : "#1d4ed8"} !important;
          transform: translateY(-1px);
        }

        .ivs-quick-btn:active:not(:disabled) {
          transform: scale(0.97);
        }

        .ivs-send-btn {
          transition: all 0.15s ease;
        }

        .ivs-send-btn:not(:disabled):hover {
          transform: scale(1.06);
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.40) !important;
        }

        .ivs-send-btn:not(:disabled):active {
          transform: scale(0.95);
        }

        .ivs-cursor-blink::after {
          content: "▋";
          display: inline-block;
          animation: ivsPulse 0.9s ease-in-out infinite;
          opacity: 0.5;
          font-size: 0.8em;
          vertical-align: middle;
          margin-left: 1px;
        }

        .ivs-close-btn {
          transition: all 0.15s ease;
        }

        .ivs-close-btn:hover {
          background: rgba(239, 68, 68, 0.08) !important;
          color: #ef4444 !important;
        }
      `}</style>

      <div
        ref={panelRef}
        className="ivs-chat-panel ivs-ai-chat-panel"
        role="dialog"
        aria-label="Academy AI Assistant"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 60,
          width: 400,
          maxWidth: "calc(100vw - 2rem)",
          height: "min(680px, calc(100vh - 5rem))",
          maxHeight: "calc(100vh - 5rem)",
          borderRadius: 20,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: chatTheme.panelBg,
          border: `1px solid ${chatTheme.panelBorder}`,
          boxShadow: isDarkMode
            ? "0 24px 80px rgba(0,0,0,0.55)"
            : "0 20px 60px -10px rgba(15,30,61,0.18), 0 4px 16px rgba(15,30,61,0.08)",
        }}
      >
        {/* HEADER */}
        <div
          style={{
            padding: "14px 18px",
            flexShrink: 0,
            background: chatTheme.headerBg,
            borderBottom: `1px solid ${chatTheme.headerBorder}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 20,
              boxShadow: "0 4px 12px rgba(59,130,246,0.30)",
            }}
          >
            🤖
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 800,
                fontSize: 14.5,
                color: chatTheme.titleText,
                letterSpacing: "-0.2px",
              }}
            >
              AI Chat Assistant
            </div>

            <div
              style={{
                fontSize: 11.5,
                color: chatTheme.mutedText,
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 2,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#10b981",
                  display: "inline-block",
                  boxShadow: "0 0 0 2px rgba(16,185,129,0.2)",
                  animation: "ivsPulse 2.5s ease infinite",
                }}
              />
              Iqra Virtual School · Qur&apos;an Department
            </div>
          </div>

          <button
            onClick={onClose}
            className="ivs-close-btn"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: isDarkMode
                ? "rgba(148,163,184,0.10)"
                : "rgba(100,116,139,0.08)",
              border: isDarkMode
                ? "1px solid rgba(148,163,184,0.20)"
                : "1px solid rgba(100,116,139,0.15)",
              color: chatTheme.faintText,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* QUICK ACTIONS */}
        <div
          style={{
            padding: "12px 16px 0",
            flexShrink: 0,
            background: chatTheme.softBg,
            borderBottom: `1px solid ${chatTheme.headerBorder}`,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: chatTheme.faintText,
              textTransform: "uppercase",
              letterSpacing: "0.9px",
              marginBottom: 8,
            }}
          >
            Quick questions
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 12 }}>
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="ivs-quick-btn"
                onClick={() => sendMessage(action.prompt)}
                disabled={isThinking}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 12px",
                  borderRadius: 20,
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: chatTheme.quickBg,
                  border: `1px solid ${chatTheme.quickBorder}`,
                  color: chatTheme.quickText,
                  whiteSpace: "nowrap",
                  opacity: isThinking ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 12 }}>{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* MESSAGES */}
        <div
          ref={scrollRef}
          className="ivs-chat-scroll"
          onScroll={handleScroll}
style={{
  flex: 1,
  overflowY: "auto",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: chatTheme.bodyBg,
  minHeight: 0,
}}
        >
          {messages.map((msg, idx) => {
            const isUser = msg.role === "user";

            return (
              <div
                key={idx}
                className="ivs-msg"
                style={{
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  alignItems: "flex-end",
                  gap: 8,
                }}
              >
                {!isUser && (
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 9,
                      background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      flexShrink: 0,
                      boxShadow: "0 2px 8px rgba(59,130,246,0.25)",
                    }}
                  >
                    🤖
                  </div>
                )}

<div
  style={{
    maxWidth: "78%",
    minWidth: 0,
    borderRadius: isUser
      ? "18px 18px 5px 18px"
      : "18px 18px 18px 5px",
    padding: "10px 14px",
    fontSize: 13,
    lineHeight: 1.6,
    wordBreak: "break-word",
    overflowWrap: "break-word",
    overflow: "visible",
                    ...(isUser
                      ? {
                          background:
                            "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                          color: "white",
                          boxShadow: "0 4px 14px rgba(59,130,246,0.30)",
                        }
                      : {
                          background: chatTheme.assistantBubbleBg,
                          color: chatTheme.bodyText,
                          border: `1px solid ${chatTheme.assistantBubbleBorder}`,
                          boxShadow: isDarkMode
                            ? "0 8px 22px rgba(0,0,0,0.22)"
                            : "0 2px 8px rgba(15,23,42,0.05)",
                        }),
                  }}
                >
                  {msg.text === "" && msg.isStreaming ? (
                    <TypingDots />
                  ) : isUser ? (
                    <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {msg.text}
                    </span>
                  ) : (
                    <div
                      className={msg.isStreaming ? "ivs-cursor-blink" : ""}
                      style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    >
                      {renderMarkdown(msg.text)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isThinking && !messages[messages.length - 1]?.isStreaming && (
            <div className="ivs-msg" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 9,
                  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                🤖
              </div>

              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "18px 18px 18px 5px",
                  background: chatTheme.assistantBubbleBg,
                  border: `1px solid ${chatTheme.assistantBubbleBorder}`,
                  boxShadow: isDarkMode
                    ? "0 8px 22px rgba(0,0,0,0.22)"
                    : "0 2px 8px rgba(15,23,42,0.05)",
                }}
              >
                <TypingDots />
              </div>
            </div>
          )}
        </div>

        {/* SCROLL TO BOTTOM */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            style={{
              position: "absolute",
              bottom: 76,
              right: 16,
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: chatTheme.assistantBubbleBg,
              border: `1px solid ${chatTheme.assistantBubbleBorder}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(15,23,42,0.10)",
              color: chatTheme.mutedText,
              zIndex: 2,
              transition: "all 0.15s ease",
            }}
            aria-label="Scroll to latest"
          >
            <ChevronDown size={15} />
          </button>
        )}

        {/* INPUT */}
        <div
          style={{
            padding: "10px 14px 12px",
            flexShrink: 0,
            background: chatTheme.panelBg,
            borderTop: `1px solid ${chatTheme.headerBorder}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              background: chatTheme.inputWrapBg,
              borderRadius: 16,
              border: `1.5px solid ${chatTheme.inputBorder}`,
              padding: "8px 8px 8px 14px",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            }}
            onFocusCapture={(e) => {
              const target = e.currentTarget as HTMLDivElement;
              target.style.borderColor = "#93c5fd";
              target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.10)";
            }}
            onBlurCapture={(e) => {
              const target = e.currentTarget as HTMLDivElement;
              target.style.borderColor = chatTheme.inputBorder;
              target.style.boxShadow = "none";
            }}
          >
            <textarea
              id="assistant-message"
              name="assistant_message"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about students, teachers, schedules…"
              rows={1}
              className="ivs-chat-textarea"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              style={{
                flex: 1,
                resize: "none",
                background: "transparent",
                border: "none",
                outline: "none",
                fontSize: 13.5,
                color: chatTheme.bodyText,
                lineHeight: 1.55,
                fontFamily: "inherit",
                overflowY: "auto",
                maxHeight: 100,
                padding: 0,
              }}
            />

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="ivs-send-btn"
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                border: "none",
                cursor: canSend ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s ease",
                ...(canSend
                  ? {
                      background:
                        "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                      color: "white",
                      boxShadow: "0 4px 14px rgba(59,130,246,0.35)",
                    }
                  : {
                      background: chatTheme.disabledBtnBg,
                      color: chatTheme.disabledBtnText,
                    }),
              }}
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};