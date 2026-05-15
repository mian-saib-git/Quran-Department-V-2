import React from 'react';
import { Teacher, AttendanceRecord, AttendanceStatus } from '../types';
import { Check, X, Clock, Video } from 'lucide-react';

export const TeacherCard: React.FC<{
  teacher: Teacher;
  attendanceToday: AttendanceRecord | undefined;
  metaLine?: string;
  classKey?: string;
  onMarkAttendance: (teacherId: string, status: AttendanceStatus, classKey?: string) => void;
}> = ({
  teacher,
  attendanceToday,
  metaLine,
  classKey,
  onMarkAttendance,
}) => {
  return (
    <div className="p-5 ui-glass ui-card ui-gradient-border ui-card-hover ui-shine anim-fade-up">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h3 className="font-bold text-slate-900 text-lg">{teacher.name}</h3>
          {metaLine && <p className="text-xs text-slate-500 mt-1">{metaLine}</p>}
<p className="text-sm text-slate-500 mt-1">
  {teacher.email ? `Email: ${teacher.email}` : 'Email: —'}
  {teacher.phone ? ` • Phone: ${teacher.phone}` : ' • Phone: —'}
</p>

        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-2xl text-xs font-extrabold ui-pill ${
            attendanceToday?.status === AttendanceStatus.PRESENT
              ? 'bg-green-50 text-green-700 border-green-200'
              : attendanceToday?.status === AttendanceStatus.ABSENT
              ? 'bg-red-50 text-red-700 border-red-200'
              : attendanceToday?.status === AttendanceStatus.LEAVE
              ? 'bg-orange-50 text-orange-700 border-orange-200'
              : 'bg-slate-50 text-slate-600 border-slate-200'
          }`}
        >
          {attendanceToday?.status ?? 'Unmarked'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onMarkAttendance(teacher.id, AttendanceStatus.PRESENT, classKey)}
          className={`ui-btn flex items-center justify-center gap-1 py-2 rounded-2xl border transition-colors text-sm font-semibold ${
            attendanceToday?.status === AttendanceStatus.PRESENT
              ? 'bg-green-600 text-white border-green-600'
              : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
          }`}
        >
          <Check size={16} /> Present
        </button>
        <button
          onClick={() => onMarkAttendance(teacher.id, AttendanceStatus.ABSENT, classKey)}
          className={`ui-btn flex items-center justify-center gap-1 py-2 rounded-2xl border transition-colors text-sm font-semibold ${
            attendanceToday?.status === AttendanceStatus.ABSENT
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
          }`}
        >
          <X size={16} /> Absent
        </button>
        <button
          onClick={() => onMarkAttendance(teacher.id, AttendanceStatus.LEAVE, classKey)}
          className={`ui-btn flex items-center justify-center gap-1 py-2 rounded-2xl border transition-colors text-sm font-semibold ${
            attendanceToday?.status === AttendanceStatus.LEAVE
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100'
          }`}
        >
          <Clock size={16} /> Leave
        </button>
      </div>
    </div>
  );
};
