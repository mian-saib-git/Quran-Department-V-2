import React from "react";

type SkeletonVariant =
  | "page" | "table" | "cards" | "schedule" | "settings" | "portal" | "list"
  | "dashboard" | "accounts" | "lessons" | "attendance" | "reports" | "salary"
  | "dropped" | "admin-overview" | "admin-table" | "admin-forms" | "health" | "logs";

type PageSkeletonProps = { variant?: SkeletonVariant; rows?: number; cards?: number; className?: string; compact?: boolean; label?: string; delayMs?: number };

function inferVariant(variant: SkeletonVariant, label = ""): SkeletonVariant {
  const text = label.toLowerCase();
  if (text.includes("salary")) return "salary";
  if (text.includes("account") || text.includes("coordinator") || text.includes("administrator")) return "accounts";
  if (text.includes("lesson")) return "lessons";
  if (text.includes("schedule")) return "schedule";
  if (text.includes("attendance")) return "attendance";
  if (text.includes("report")) return "reports";
  if (text.includes("dropped") || text.includes("leave")) return "dropped";
  if (text.includes("setting") || text.includes("maintenance") || text.includes("notice")) return "admin-forms";
  if (text.includes("health")) return "health";
  if (text.includes("audit") || text.includes("log")) return "logs";
  if (text.includes("overview") || text.includes("dashboard")) return "dashboard";
  return variant;
}

function Shimmer({ className = "" }: { className?: string }) { return <div aria-hidden="true" className={`ivs-skeleton ${className}`} />; }
const Line = ({ className = "h-3 w-24" }: { className?: string }) => <Shimmer className={`rounded-full ${className}`} />;
const Box = ({ className = "h-10 w-10" }: { className?: string }) => <Shimmer className={`rounded-2xl ${className}`} />;

function Header({ compact=false }: {compact?:boolean}) {
  return <div className={`flex items-center justify-between gap-3 ${compact?"mb-3":"mb-5"}`}>
    <div className="flex min-w-0 items-center gap-3"><Box className={compact?"h-9 w-9":"h-12 w-12"}/><div className="space-y-2"><Line className={compact?"h-3 w-32":"h-4 w-48"}/><Line className={compact?"h-2.5 w-44 max-w-[55vw]":"h-3 w-64 max-w-[65vw]"}/></div></div>
    <Box className={compact?"h-9 w-20":"h-11 w-28"}/>
  </div>;
}
function StatRow({count=4}:{count?:number}) { return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({length:count}).map((_,i)=><div key={i} className="ivs-skeleton-card flex min-h-[86px] items-center justify-between p-4"><div className="space-y-3"><Line className="h-2.5 w-20"/><Line className="h-6 w-14"/></div><Box className="h-10 w-10"/></div>)}</div>; }
function Table({rows=6, cols=5}:{rows?:number;cols?:number}) { return <div className="ivs-skeleton-card overflow-hidden"><div className="grid gap-3 border-b border-slate-200/70 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/30" style={{gridTemplateColumns:`repeat(${cols},minmax(70px,1fr))`}}>{Array.from({length:cols}).map((_,i)=><Line key={i} className="h-2.5 w-16"/>)}</div>{Array.from({length:rows}).map((_,r)=><div key={r} className="grid items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800" style={{gridTemplateColumns:`repeat(${cols},minmax(70px,1fr))`}}>{Array.from({length:cols}).map((_,c)=><div key={c} className={c===0?"flex items-center gap-2":""}>{c===0&&<Box className="h-8 w-8 shrink-0"/>}<Line className={`h-3 ${c===cols-1?"ml-auto w-16":"w-[72%]"}`}/></div>)}</div>)}</div>; }
function Dashboard(){return <div className="space-y-4"><StatRow/><div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]"><div className="ivs-skeleton-card p-4"><Line className="h-4 w-28"/><div className="mt-4 space-y-3">{Array.from({length:3}).map((_,i)=><div key={i} className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800"><div className="flex justify-between"><Line className="h-3 w-32"/><Line className="h-3 w-16"/></div><Line className="mt-3 h-2.5 w-48"/></div>)}</div></div><div className="ivs-skeleton-card p-4"><Line className="h-4 w-24"/>{Array.from({length:4}).map((_,i)=><div key={i} className="mt-3 flex items-center gap-3"><Box className="h-9 w-9"/><div className="flex-1 space-y-2"><Line className="h-3 w-[55%]"/><Line className="h-2.5 w-[35%]"/></div></div>)}</div></div></div>}
function Accounts({rows=6}:{rows?:number}){return <div className="space-y-4"><StatRow/><div className="ivs-skeleton-card p-3"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div className="flex gap-2"><Box className="h-9 w-24"/><Box className="h-9 w-24"/><Box className="h-9 w-24"/></div><Box className="h-10 w-full sm:w-72"/></div></div><div className="overflow-x-auto"><div className="min-w-[760px]"><Table rows={rows} cols={6}/></div></div></div>}
function Lessons(){return <div className="space-y-4"><StatRow count={5}/><div className="ivs-skeleton-card p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({length:6}).map((_,i)=><Box key={i} className="h-11 w-full"/>)}</div><div className="mt-4"><Table rows={5} cols={5}/></div></div></div>}
function Schedule(){return <div className="ivs-skeleton-card overflow-x-auto p-3"><div className="min-w-[980px]"><div className="grid grid-cols-[120px_repeat(6,minmax(130px,1fr))] gap-2">{Array.from({length:7}).map((_,i)=><Box key={i} className="h-20 w-full"/>)}{Array.from({length:21}).map((_,i)=><Box key={i} className={`${i%7===0?"h-24":"h-32"} w-full rounded-xl`}/>)}</div></div></div>}
function Attendance(){return <div className="space-y-4"><div className="ivs-skeleton-card p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({length:4}).map((_,i)=><Box key={i} className="h-10 w-full"/>)}</div></div><StatRow count={5}/><div className="grid gap-3 lg:grid-cols-2">{Array.from({length:6}).map((_,i)=><div key={i} className="ivs-skeleton-card p-4"><div className="flex justify-between"><div className="space-y-2"><Line className="h-3.5 w-32"/><Line className="h-2.5 w-48"/></div><Box className="h-8 w-14"/></div></div>)}</div></div>}
function Reports(){return <div className="space-y-4"><StatRow/><div className="ivs-skeleton-card p-4"><div className="grid gap-3 lg:grid-cols-3">{Array.from({length:5}).map((_,i)=><Box key={i} className="h-10 w-full"/>)}</div></div><div className="overflow-x-auto"><div className="min-w-[760px]"><Table rows={7} cols={6}/></div></div></div>}
function Salary(){return <div className="space-y-4"><div className="ivs-skeleton-card p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><Box className="h-11 w-11"/><div className="space-y-2"><Line className="h-4 w-36"/><Line className="h-2.5 w-28"/></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({length:4}).map((_,i)=><Box key={i} className="h-14 w-full sm:w-28"/>)}</div></div></div><StatRow count={3}/><div className="grid gap-4 xl:grid-cols-[1fr_1fr_.9fr]"><Table rows={4} cols={3}/><Table rows={7} cols={3}/><div className="ivs-skeleton-card grid grid-cols-2 gap-3 p-3">{Array.from({length:8}).map((_,i)=><Box key={i} className="h-24 w-full"/>)}</div></div></div>}
function Dropped(){return <div className="space-y-4"><StatRow count={3}/><div className="ivs-skeleton-card p-3"><Box className="h-10 w-full sm:w-80"/></div><Table rows={7} cols={4}/></div>}
function Forms(){return <div className="grid gap-4 lg:grid-cols-2">{Array.from({length:2}).map((_,i)=><div key={i} className="ivs-skeleton-card p-5"><div className="flex items-center gap-3"><Box className="h-11 w-11"/><div className="space-y-2"><Line className="h-4 w-40"/><Line className="h-2.5 w-64 max-w-[60vw]"/></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{Array.from({length:6}).map((_,j)=><Box key={j} className={`${j===2||j===3?"h-24 sm:col-span-2":"h-11"} w-full`}/>)}</div><Box className="mt-4 h-11 w-full"/></div>)}</div>}
function Health(){return <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({length:6}).map((_,i)=><div key={i} className="ivs-skeleton-card p-4"><div className="flex items-center gap-3"><Box className="h-10 w-10"/><Line className="h-4 w-28"/></div>{Array.from({length:4}).map((_,j)=><div key={j} className="mt-3 flex justify-between"><Line className="h-3 w-20"/><Line className="h-3 w-24"/></div>)}</div>)}</div><StatRow/></div>}

export function PageSkeleton({variant="page",rows=6,cards=6,className="",compact=false,label,delayMs=140}:PageSkeletonProps){
 const [visible,setVisible]=React.useState(delayMs<=0); React.useEffect(()=>{if(delayMs<=0)return;const id=window.setTimeout(()=>setVisible(true),delayMs);return()=>window.clearTimeout(id)},[delayMs]);
 if(!visible)return <div aria-hidden="true" className="min-h-[2px]"/>;
 const v=inferVariant(variant,label);
 let body:React.ReactNode;
 if(v==="dashboard"||v==="admin-overview"||v==="portal"||v==="page") body=<Dashboard/>;
 else if(v==="accounts"||v==="admin-table"||v==="table") body=<Accounts rows={rows}/>;
 else if(v==="lessons") body=<Lessons/>;
 else if(v==="schedule") body=<Schedule/>;
 else if(v==="attendance") body=<Attendance/>;
 else if(v==="reports") body=<Reports/>;
 else if(v==="salary") body=<Salary/>;
 else if(v==="dropped") body=<Dropped/>;
 else if(v==="settings"||v==="admin-forms") body=<Forms/>;
 else if(v==="health") body=<Health/>;
 else if(v==="logs"||v==="list") body=<Table rows={rows} cols={3}/>;
 else body=<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({length:Math.min(cards,6)}).map((_,i)=><div key={i} className="ivs-skeleton-card p-4"><Box className="h-11 w-11"/><Line className="mt-4 h-4 w-32"/><Line className="mt-3 h-3 w-[80%]"/><Box className="mt-4 h-10 w-full"/></div>)}</div>;
 return <div role="status" aria-live="polite" aria-label={label||"Loading content"} className={`ivs-skeleton-stage w-full ${className}`}><span className="sr-only">{label||"Loading content"}</span><Header compact={compact}/>{body}</div>;
}
export function InlineSkeleton({className="h-4 w-24"}:{className?:string}){return <Shimmer className={`rounded-full ${className}`}/>}
