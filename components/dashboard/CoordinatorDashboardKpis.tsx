import React from "react";
import { BookOpen, ChevronRight, Users } from "lucide-react";
import { DashboardBackdrop } from "./DashboardPrimitives";
import { formatTime12 } from "../../services/quranScheduleHelpers";

export type CoordinatorDashboardKpisProps = {
  studentsCount: number;
  teachersCount: number;
  liveNowCount: number;
  currentSlot: string;
  upNextCount: number;
  nextSlot: string;
};

export const CoordinatorDashboardKpis: React.FC<CoordinatorDashboardKpisProps> = ({
  studentsCount,
  teachersCount,
  liveNowCount,
  currentSlot,
  upNextCount,
  nextSlot,
}) => {
  return (
    <div className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/55 backdrop-blur-xl shadow-[0_18px_55px_rgba(15,23,42,0.10)] p-6 md:p-7">
      <DashboardBackdrop />

      <div className="relative z-10">
        {/* ✅ KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">Students</div>
                <div className="text-2xl font-extrabold text-emerald-600 mt-1">{studentsCount}</div>
              </div>
              <div className="h-10 w-10 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                <Users size={20} />
              </div>
            </div>
          </div>

          <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">Teachers</div>
                <div className="text-2xl font-extrabold text-blue-600 mt-1">{teachersCount}</div>
              </div>
              <div className="h-10 w-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
                <BookOpen size={20} />
              </div>
            </div>
          </div>

          <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">Live Now</div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">{liveNowCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">{formatTime12(currentSlot)}</div>
              </div>
              <div className="h-10 w-10 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              </div>
            </div>
          </div>

          <div className="ui-glass ui-card ui-gradient-border p-4 ui-card-hover">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500">Up Next</div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">{upNextCount}</div>
                <div className="text-[11px] text-slate-500 mt-1">{formatTime12(nextSlot)}</div>
              </div>
              <div className="h-10 w-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-600">
                <ChevronRight size={18} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoordinatorDashboardKpis;
