import React from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";

export type DashboardTimelinePopup = {
  slot: string;
  x: number;
  y: number;
  pinned: boolean;
} | null;

type ChartItem = {
  time: string;
  timeLabel: string;
  count: number;
  [key: string]: unknown;
};

type Props = {
  chartData: ChartItem[];
  currentSlot: string;
  timelinePopup: DashboardTimelinePopup;
  setTimelinePopup: React.Dispatch<React.SetStateAction<DashboardTimelinePopup>>;
  timelineCardRef: React.RefObject<HTMLDivElement | null>;
};

export default function DashboardTimelineChart({
  chartData,
  currentSlot,
  timelinePopup,
  setTimelinePopup,
  timelineCardRef,
}: Props) {
  const setPopupFromEvent = (
    data: any,
    event: any,
    pinned: boolean,
  ) => {
    if (!pinned && timelinePopup?.pinned) return;

    const card = timelineCardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    let x = event?.clientX ? event.clientX - rect.left + 16 : 260;
    let y = event?.clientY ? event.clientY - rect.top - 30 : 70;

    x = Math.max(16, Math.min(x, rect.width - 280));
    y = Math.max(58, Math.min(y, rect.height - 230));

    setTimelinePopup({
      slot: String(data?.time || ""),
      x,
      y,
      pinned,
    });
  };

  return (
    <ResponsiveContainer width="100%" height={205}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 10, left: -20, bottom: 0 }}
        accessibilityLayer={false}
      >
        <XAxis
          dataKey="timeLabel"
          tick={{ fontSize: 10, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: "#64748b" }}
        />
        <Bar
          isAnimationActive={false}
          dataKey="count"
          radius={[9, 9, 9, 9]}
          onMouseEnter={(data: any, _index: number, event: any) => {
            setPopupFromEvent(data, event, false);
          }}
          onMouseMove={(data: any, _index: number, event: any) => {
            setPopupFromEvent(data, event, false);
          }}
          onClick={(data: any, _index: number, event: any) => {
            setPopupFromEvent(data, event, true);
          }}
          style={{ cursor: "pointer", outline: "none" }}
        >
          {chartData.map((item, index) => (
            <Cell
              key={`cell-${index}`}
              fill={
                timelinePopup?.slot === item.time
                  ? "#10b981"
                  : item.time === currentSlot
                    ? "#22c55e"
                    : "#cbd5e1"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
