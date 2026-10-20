import React, { memo, useEffect, useId, useRef, useState } from "react";
import NotificationBell from "./NotificationBell";
import "./IVSClockCard.css";

// Shared IVS clock: the original user's analog dial, digital layout and date,
// sized for existing portal topbars. The notification inbox remains mounted
// independently so the clock's once-per-second updates do not poll the API.
type ClockProps = { now?: Date; compact?: boolean; className?: string };
const TICKS = Array.from({ length: 60 }, (_, index) => {
  if (index % 15 === 0) return null;
  const angle = index * Math.PI / 30;
  const large = index % 5 === 0;
  return {
    index, large,
    x1: 42 + Math.sin(angle) * 38,
    y1: 42 - Math.cos(angle) * 38,
    x2: 42 + Math.sin(angle) * (large ? 34.2 : 36),
    y2: 42 - Math.cos(angle) * (large ? 34.2 : 36),
  };
}).filter((tick): tick is NonNullable<typeof tick> => tick !== null);

function forwardAngle(target: number, prior: React.MutableRefObject<number | null>) {
  if (prior.current === null) { prior.current = target; return target; }
  const delta = ((target - prior.current) % 360 + 360) % 360;
  prior.current += delta;
  return prior.current;
}

function IVSClockCard({ now, compact = false, className = "" }: ClockProps) {
  const uid = useId().replace(/:/g, "");
  const [internalNow, setInternalNow] = useState(() => new Date());
  useEffect(() => {
    if (now) return;
    const timer = window.setInterval(() => setInternalNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [Boolean(now)]);
  const value = now ?? internalNow;
  const h = value.getHours();
  const m = value.getMinutes();
  const s = value.getSeconds();
  const hh = String(h % 12 || 12).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const period = h >= 12 ? "PM" : "AM";
  const weekday = value.toLocaleDateString("en-US", { weekday: "long" });
  const monthDay = value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const hourRef = useRef<number | null>(null);
  const minuteRef = useRef<number | null>(null);
  const secondRef = useRef<number | null>(null);
  const hourAngle = forwardAngle((h % 12) * 30 + m * 0.5, hourRef);
  const minuteAngle = forwardAngle(m * 6 + s * 0.1, minuteRef);
  const secondAngle = forwardAngle(s * 6, secondRef);
  const rotation = (degrees: number): React.CSSProperties => ({
    transform: `rotate(${degrees}deg)`,
    transformOrigin: "42px 42px",
  });

  return (
    <div className={`ivc-card ${compact ? "ivc-compact" : ""} ${className}`}>
      <svg className="ivc-dial" viewBox="0 0 84 84" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#dfe3f7"/>
          </linearGradient>
          <radialGradient id={`${uid}-face`} cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#fff"/><stop offset="1" stopColor="#f3f5fd"/>
          </radialGradient>
        </defs>
        <circle cx="42" cy="42" r="40.5" fill={`url(#${uid}-rim)`}/>
        <circle cx="42" cy="42" r="38.6" fill={`url(#${uid}-face)`} stroke="#e3e7f6" strokeWidth=".8"/>
        {TICKS.map(t => <line key={t.index} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={t.large ? "#aeb7d3" : "#d9deef"} strokeWidth={t.large ? 1.3 : .7} strokeLinecap="round" />)}
        {([ ["12",42,17],["3",67,42.5],["6",42,68],["9",17,42.5] ] as const).map(([text,x,y]) =>
          <text key={text} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="8.5"
            fontWeight="800" fill="#8b97b1">{text}</text>)}
        <g className="ivc-hand-slow" style={rotation(hourAngle)}><line x1="42" y1="46" x2="42" y2="26" stroke="#1b2438" strokeWidth="3.6" strokeLinecap="round"/></g>
        <g className="ivc-hand-slow" style={rotation(minuteAngle)}><line x1="42" y1="46" x2="42" y2="17" stroke="#5b52f0" strokeWidth="2.9" strokeLinecap="round"/></g>
        <g className="ivc-hand-second" style={rotation(secondAngle)}><line x1="42" y1="50" x2="42" y2="13" stroke="#f43f5e" strokeWidth="1.2" strokeLinecap="round"/></g>
        <circle cx="42" cy="42" r="4" fill="#5b52f0"/>
        <circle cx="42" cy="42" r="1.6" fill="white"/>
        <path d="M14 30 A30 30 0 0 1 36 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" opacity=".8"/>
      </svg>
      <div className="ivc-body">
        <div className="ivc-time" aria-label={`${hh}:${mm} ${period}`}>
          <span className="ivc-digits">{hh}<span className="ivc-colon">:</span>{mm}</span>
          <span className="ivc-period">{period}</span>
        </div>
        <div className="ivc-date">
          <span className="ivc-weekday">{weekday}</span>
          <span className="ivc-separator" aria-hidden="true" />
          <span className="ivc-month">{monthDay}</span>
        </div>
      </div>
      <NotificationBell appearance="clock" />
    </div>
  );
}

export default memo(IVSClockCard);
