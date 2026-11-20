import React from "react";
import { ChevronRight } from "lucide-react";
import { ClassCard } from "../ClassCard";
import { formatTime12 } from "../../services/quranScheduleHelpers";
import {
  AttendanceStatus,
  EntityType,
  type AttendanceRecord,
  type Student,
  type Teacher,
} from "../../types";

export type CoverageAssignmentInput = {
  student_id: number;
  substitute_teacher_id: number;
};

export type CoordinatorLiveClassesSectionProps = {
  currentClasses: Student[];
  nextClasses: Student[];
  currentSlot: string;
  nextSlot: string;
  todayStr: string;
  teacherById: Map<string, Teacher>;
  studentAttendanceToday: Map<string, AttendanceRecord>;
  getTeacherAttendance: (teacherId: string, timeSlot: string) => AttendanceRecord | undefined;
  onMarkAttendance: (
    entityId: string,
    status: AttendanceStatus,
    type?: EntityType,
    classKey?: string,
    coverageAssignments?: CoverageAssignmentInput[],
  ) => Promise<boolean>;
  onUnmarkAttendance: (
    entityId: string,
    type?: EntityType,
    classKey?: string,
  ) => Promise<boolean>;
  onOpenAccountEditor: (role: "teacher" | "student", profileId: string) => void;
};

export const CoordinatorLiveClassesSection: React.FC<CoordinatorLiveClassesSectionProps> = ({
  currentClasses,
  nextClasses,
  currentSlot,
  nextSlot,
  todayStr,
  teacherById,
  studentAttendanceToday,
  getTeacherAttendance,
  onMarkAttendance,
  onUnmarkAttendance,
  onOpenAccountEditor,
}) => {
  const renderClassList = (students: Student[], isCurrentSession: boolean) => (
    <div className="space-y-2">
      {students.map((student) => {
        const teacher = teacherById.get(student.teacherId);
        const teacherRec = teacher ? getTeacherAttendance(teacher.id, student.timeSlot) : undefined;

        return (
          <React.Fragment key={student.id}>
            <ClassCard
              student={student}
              teacher={teacher}
              attendanceToday={studentAttendanceToday.get(student.id)}
              onMarkAttendance={onMarkAttendance}
              onUnmarkAttendance={(id: string) => onUnmarkAttendance(id)}
              teacherAttendanceToday={teacherRec}
              attendanceDate={todayStr}
              onMarkTeacherAttendance={(
                teacherId: string,
                status: AttendanceStatus,
                coverageAssignments: CoverageAssignmentInput[] = [],
              ) =>
                onMarkAttendance(
                  teacherId,
                  status,
                  EntityType.TEACHER,
                  student.timeSlot,
                  coverageAssignments,
                )
              }
              onUnmarkTeacherAttendance={(teacherId: string) =>
                onUnmarkAttendance(teacherId, EntityType.TEACHER, student.timeSlot)
              }
              isCurrentSession={isCurrentSession}
              onOpenStudent={(item) => onOpenAccountEditor("student", item.id)}
              onOpenTeacher={(item) => onOpenAccountEditor("teacher", item.id)}
            />
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
      {/* Live Now */}
      <section className="min-w-0 space-y-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-3 text-xl font-black text-slate-950 dark:text-white">
            <span className="h-3 w-3 rounded-full bg-rose-500 animate-pulse" />
            Live Now
          </h3>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {currentClasses.length} class{currentClasses.length === 1 ? "" : "es"}
          </span>
        </div>

        {currentClasses.length === 0 ? (
          <div className="text-center p-8 ui-glass ui-card ui-gradient-border text-slate-600">
            No classes scheduled for {formatTime12(currentSlot)}
          </div>
        ) : (
          renderClassList(currentClasses, true)
        )}
      </section>

      {/* Up Next */}
      <section className="min-w-0 space-y-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-xl font-black text-slate-950 dark:text-white">
            Up Next <ChevronRight size={19} className="text-slate-400" />
          </h3>
          <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Next scheduled classes
          </span>
        </div>

        {nextClasses.length === 0 ? (
          <div className="text-center p-8 ui-glass ui-card ui-gradient-border text-slate-600">
            No classes scheduled for {formatTime12(nextSlot)}
          </div>
        ) : (
          renderClassList(nextClasses, false)
        )}
      </section>
    </div>
  );
};

export default CoordinatorLiveClassesSection;
