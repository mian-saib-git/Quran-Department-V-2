import type { QuranSalaryV2ProofResponse } from "../../services/djangoApiService";
import { buildSalaryStatementData, formatPkr } from "./salaryV2PdfData";

const NAVY: [number, number, number] = [22, 35, 71];
const PURPLE: [number, number, number] = [79, 70, 229];
const INK: [number, number, number] = [20, 32, 60];
const MUTED: [number, number, number] = [99, 112, 138];
const BORDER: [number, number, number] = [224, 231, 241];

function monthLabel(month: number, year: number): string {
  if (month < 1 || month > 12 || !Number.isInteger(month) || !Number.isInteger(year)) return `${month}/${year}`;
  return new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function safeFileName(value: string): string {
  return String(value || "Teacher")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    calculating: "Calculating",
    department_review: "Department Review",
    pending_super_admin: "Awaiting Approval",
    approved: "Approved",
    rejected: "Needs Revision",
    reopened: "Reopened",
    paid: "Paid",
  };
  return labels[value] || value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

async function loadBrandLogo(): Promise<string> {
  // A cleaned print-resolution copy of the logo supplied by IVS. We keep it
  // separate so this PDF patch cannot overwrite the website's existing logo.
  const path = `${import.meta.env.BASE_URL || "/"}ivs-salary-logo.png`;
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok || !(response.headers.get("content-type") || "").includes("image/")) {
    throw new Error("IVS salary logo is missing. Confirm public/ivs-salary-logo.png was installed and reload the website.");
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not load the IVS salary logo."));
    reader.readAsDataURL(blob);
  });
}

export async function downloadSalaryV2Pdf(proof: QuranSalaryV2ProofResponse): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, logo] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadBrandLogo(),
  ]);

  const data = buildSalaryStatementData(proof);
  const payroll = proof.payroll;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 14;
  const width = pageWidth - left * 2;

  doc.setProperties({
    title: `IVS Monthly Salary - ${payroll.teacher_name} - ${monthLabel(payroll.month, payroll.year)}`,
    subject: "IQRA Virtual School monthly teacher salary statement",
    author: "IQRA Virtual School",
  });

  const rgb = (color: [number, number, number]) => doc.setTextColor(color[0], color[1], color[2]);
  const fill = (color: [number, number, number]) => doc.setFillColor(color[0], color[1], color[2]);
  const stroke = (color: [number, number, number]) => doc.setDrawColor(color[0], color[1], color[2]);
  const label = (value: string, x: number, y: number, size = 7) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(size); rgb(MUTED);
    doc.text(value.toUpperCase(), x, y);
  };
  const value = (content: string, x: number, y: number, size = 11, color = INK, align: "left" | "right" = "left") => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(size); rgb(color);
    doc.text(content, x, y, { align });
  };
  const fit = (content: string, max: number) => {
    let result = content;
    while (doc.getTextWidth(result) > max && result.length > 4) result = `${result.slice(0, -2)}...`;
    return result;
  };

  // Refined document header. Logo is the real uploaded IVS mark, not a
  // generated shield or invented school brand.
  doc.setFillColor(248, 250, 255); doc.rect(0, 0, pageWidth, 40, "F");
  doc.setFillColor(255, 255, 255); doc.roundedRect(left - 1, 6, 31, 31, 4, 4, "F");
  doc.addImage(logo, "PNG", left, 7, 29, 29);
  value("IQRA VIRTUAL SCHOOL", 49, 17.5, 14, NAVY);
  label(data.departmentName, 49, 24, 7.2);
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); rgb(MUTED);

  fill([234, 232, 255]); doc.roundedRect(140, 12, 56, 19, 4, 4, "F");
  value("MONTHLY SALARY", 145, 19, 8, PURPLE);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); rgb(MUTED);
  doc.text("Statement", 145, 25);

  // Teacher / month / review state.
  fill([255, 255, 255]); stroke(BORDER);
  doc.roundedRect(left, 44, width, 24, 4, 4, "FD");
  label("TEACHER", left + 6, 51.5);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  value(fit(String(payroll.teacher_name || "Teacher"), 72), left + 6, 59, 10.5);
  label("SALARY MONTH", 100, 51.5);
  value(monthLabel(payroll.month, payroll.year), 100, 59, 10.2);
  fill([239, 237, 255]); doc.roundedRect(153, 50, 38, 12, 4, 4, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); rgb(PURPLE);
  doc.text(fit(statusLabel(String(payroll.status || "")), 34), 172, 57.4, { align: "center" });

  // Five small, carefully spaced totals. These come directly from saved
  // payroll totals and remain accurate if rates or monthly rules change.
  const cards = [
    { title: "CLASS EARNINGS", amount: data.classEarnings, background: [233, 251, 245], color: [16, 125, 93] },
    { title: "SUBSTITUTES", amount: data.substitute, background: [238, 247, 255], color: [37, 99, 185] },
    { title: "EXTRA CREDITS", amount: data.bonus + data.restoration, background: [247, 241, 255], color: [108, 60, 195] },
    { title: "DEDUCTIONS", amount: data.deductions, background: [255, 242, 242], color: [178, 43, 69] },
    { title: "FINAL PAYOUT", amount: data.final, background: NAVY, color: [255, 255, 255] },
  ] as const;
  const gap = 2.5;
  const cardWidth = (width - gap * 4) / 5;
  cards.forEach((card, index) => {
    const x = left + index * (cardWidth + gap);
    const background = [...card.background] as [number, number, number];
    const color = [...card.color] as [number, number, number];
    fill(background); doc.roundedRect(x, 74, cardWidth, 24, 3, 3, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(5.9);
    rgb(index === 4 ? [216, 216, 255] : MUTED);
    doc.text(card.title, x + 3, 82);
    doc.setFontSize(9.7); rgb(color);
    doc.text(formatPkr(card.amount), x + 3, 91.3);
  });

  value("Student monthly summary", left, 108, 12.2, NAVY);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.4); rgb(MUTED);
  doc.text(`${data.students.length} students  |  ${data.classCount} paid classes  |  Monthly totals`, left, 113);

  const formatted = data.students.map((student) => [
    student.studentName,
    String(student.paidClasses),
    formatPkr(student.classEarnings),
    formatPkr(student.cutting),
    formatPkr(student.net),
  ]);
  autoTable(doc, {
    startY: 117,
    head: [["STUDENT", "CLASSES", "CLASS PAY", "CUTTING", "NET"]],
    body: formatted,
    foot: [["STUDENT TOTAL", String(data.classCount), formatPkr(data.classEarnings), formatPkr(data.studentCutting), formatPkr(data.studentNet)]],
    showFoot: "lastPage",
    showHead: "everyPage",
    theme: "plain",
    margin: { left, right: left, top: 26, bottom: 16 },
    tableWidth: width,
    pageBreak: "auto",
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica", fontSize: 8.15, cellPadding: { top: 1.35, bottom: 1.35, left: 2, right: 2 },
      minCellHeight: 5.25, textColor: INK, overflow: "linebreak", valign: "middle", lineColor: BORDER,
    },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.2, minCellHeight: 7 },
    alternateRowStyles: { fillColor: [247, 249, 253] },
    footStyles: { fillColor: [236, 234, 255], textColor: PURPLE, fontStyle: "bold", minCellHeight: 7.5, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 64 }, 1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 34, halign: "right" }, 3: { cellWidth: 28, halign: "right" },
      4: { cellWidth: width - 151, halign: "right", fontStyle: "bold" },
    },
  });

  let y = Number((doc as any).lastAutoTable?.finalY || 117) + 7;
  // Reserve enough room for adjustments and the final payout on one page.
  if (y + 71 > pageHeight - 11) {
    doc.addPage();
    y = 29;
  }

  // Every material salary component remains visible even if zero.
  fill([248, 250, 255]); stroke(BORDER);
  doc.roundedRect(left, y, width, 36, 4, 4, "FD");
  value("Adjustments & deductions", left + 5, y + 7.5, 10.2, NAVY);
  const adjustments: Array<[string, number, number, number]> = [
    ["Substitute earnings", data.substitute, left + 5, y + 16],
    ["Approved bonus", data.bonus, left + 5, y + 23],
    ["Rejoin restoration", data.restoration, left + 5, y + 30],
    ["Absence / leave cutting", data.absenceCutting, left + 96, y + 16],
    ["Manual deductions", data.manualCutting, left + 96, y + 23],
    ["Dropped-class reversal", data.droppedCutting, left + 96, y + 30],
  ];
  for (const [name, amount, x, itemY] of adjustments) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.35); rgb(MUTED);
    doc.text(name, x, itemY);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.7); rgb(INK);
    doc.text(formatPkr(amount), x + 82, itemY, { align: "right" });
  }

  y += 41;
  fill(NAVY); doc.roundedRect(left, y, width, 25, 4, 4, "F");
  doc.setDrawColor(108, 116, 160);
  doc.line(left + 61, y + 5, left + 61, y + 20);
  doc.line(left + 116, y + 5, left + 116, y + 20);
  const totalSections: Array<[string, number, number]> = [
    ["GROSS EARNINGS", data.gross, left + 5],
    ["TOTAL CUTTING", data.deductions, left + 67],
    ["FINAL PAYABLE SALARY", data.final, left + 121],
  ];
  totalSections.forEach(([title, amount, x], i) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); rgb([204, 211, 255]);
    doc.text(title, x, y + 8);
    doc.setFont("helvetica", "bold"); doc.setFontSize(i === 2 ? 14 : 11.5); rgb([255, 255, 255]);
    doc.text(formatPkr(amount), x, y + 18);
  });

  // Modest, readable continuation headers and footers on long statements.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    if (page > 1) {
      fill([246, 248, 253]); doc.rect(0, 0, pageWidth, 22, "F");
      value("IQRA VIRTUAL SCHOOL", left, 10, 10.5, NAVY);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); rgb(MUTED);
      doc.text(`${payroll.teacher_name}  |  ${monthLabel(payroll.month, payroll.year)} `, left, 16.3);
    }
    stroke(BORDER); doc.line(left, pageHeight - 9.5, pageWidth - left, pageHeight - 9.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.6); rgb(MUTED);
    doc.text("IQRA Virtual School  |  Quran Department", left, pageHeight - 5.6);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - left, pageHeight - 5.6, { align: "right" });
  }

  const filename = `IVS_Monthly_Salary_${safeFileName(payroll.teacher_name)}_${payroll.year}_${String(payroll.month).padStart(2, "0")}.pdf`;
  doc.save(filename);
}
