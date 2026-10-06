import type { QuranSalaryV2ProofResponse } from "../../services/djangoApiService";

const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

function money(value: unknown) {
  const number = Number(value ?? 0);
  return PKR.format(Number.isFinite(number) ? number : 0);
}

function text(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-PK");
}

function period(month: unknown, year: unknown) {
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  if (!Number.isFinite(monthNumber) || !Number.isFinite(yearNumber) || monthNumber < 1 || monthNumber > 12) {
    return [month, year].filter(Boolean).join("/") || "—";
  }
  const label = new Date(yearNumber, monthNumber - 1, 1).toLocaleString("en-US", { month: "long" });
  return `${label} ${yearNumber}`;
}

function sourcePeriod(row: Record<string, any>) {
  if (!row?.source_month && !row?.source_year) return "Current month";
  return period(row.source_month, row.source_year);
}

function blockerText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return text(value);
  const row = value as Record<string, any>;
  return text(row.message || row.detail || row.reason || row.code || JSON.stringify(row));
}

function safeFilePart(value: unknown) {
  return text(value, "teacher")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80) || "teacher";
}

export async function downloadSalaryV2Pdf(proof: QuranSalaryV2ProofResponse) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const payroll = proof.payroll;
  const ledger = Array.isArray(proof.ledger) ? proof.ledger : [];
  const adjustments = Array.isArray(payroll.adjustments) ? payroll.adjustments : [];
  const readiness: Record<string, any> = (payroll.readiness || {}) as Record<string, any>;
  const readinessCounts: Record<string, any> =
    readiness.counts && typeof readiness.counts === "object" ? readiness.counts : readiness;
  const operationalBlockers = Array.isArray(readiness.operational_blockers)
    ? readiness.operational_blockers
    : [];
  const approvalBlockers = Array.isArray(readiness.approval_blockers)
    ? readiness.approval_blockers
    : [];

  const department: Record<string, any> =
    proof.department && typeof proof.department === "object"
      ? (proof.department as Record<string, any>)
      : {};
  const departmentName = text(
    department.name || department.department_name || department.display_name,
    "Quran Department",
  );

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 8;
  const right = 8;
  const contentWidth = pageWidth - left - right;
  const topMargin = 34;
  const bottomMargin = 14;

  doc.setProperties({
    title: `Salary - ${payroll.teacher_name} - ${period(payroll.month, payroll.year)}`,
    subject: "IQRA Virtual School Salary payroll proof",
    author: "IQRA Virtual School",
  });

  const tableEnd = () => Number((doc as any).lastAutoTable?.finalY || 0);

  const ensureSpace = (y: number, needed = 22) => {
    if (y + needed <= pageHeight - bottomMargin) return y;
    doc.addPage();
    return topMargin + 2;
  };

  const sectionTitle = (title: string, y: number) => {
    const nextY = ensureSpace(y, 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(title, left, nextY);
    return nextY + 3;
  };

  const drawSummaryCard = (
    x: number,
    y: number,
    width: number,
    label: string,
    value: string,
  ) => {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x, y, width, 16, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(label.toUpperCase(), x + 3.5, y + 5);
    doc.setFontSize(12.5);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 3.5, y + 12);
  };

  const summaryGap = 3;
  const summaryWidth = (contentWidth - summaryGap * 2) / 3;
  const summaryY = topMargin + 2;

  drawSummaryCard(left, summaryY, summaryWidth, "Gross Total", money(payroll.gross_total));
  drawSummaryCard(
    left + summaryWidth + summaryGap,
    summaryY,
    summaryWidth,
    "Deduction Total",
    money(payroll.deduction_total),
  );
  drawSummaryCard(
    left + (summaryWidth + summaryGap) * 2,
    summaryY,
    summaryWidth,
    "Final Payout",
    money(payroll.final_total),
  );

  let y = summaryY + 21;

  const componentRows = [
    ["Normal Earnings", money(payroll.normal_earnings)],
    ["Substitute Earnings", money(payroll.substitute_earnings)],
    ["Approved Bonus", money(payroll.approved_bonus_total)],
    ["Automatic Absence Deduction", money(payroll.automatic_absence_deduction_total)],
    ["Approved Manual Deduction", money(payroll.approved_manual_deduction_total)],
    ["Dropped-Class Reversal", money(payroll.dropped_class_reversal_total)],
    ["Previous-Month / Rejoin Restoration", money(payroll.previous_month_restoration_total)],
  ];

  y = sectionTitle("Native Salary Components", y);
  autoTable(doc, {
    startY: y,
    head: [["Component", "Amount"]],
    body: componentRows,
    theme: "grid",
    margin: { left, right, top: topMargin, bottom: bottomMargin },
    tableWidth: 102,
    styles: { fontSize: 7, cellPadding: 1.5, textColor: [30, 41, 59] },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: "right", cellWidth: 38 } },
  });
  const componentsEnd = tableEnd();

  const lifecycleRows = [
    ["Status", text(payroll.status)],
    ["Calculated", dateTime(payroll.calculated_at)],
    ["Submitted", dateTime(payroll.submitted_at)],
    ["Approved", dateTime(payroll.approved_at)],
    ["Paid", dateTime(payroll.paid_at)],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Status", "Value"]],
    body: lifecycleRows,
    theme: "grid",
    margin: { left: 114, right, top: topMargin, bottom: bottomMargin },
    tableWidth: 82,
    styles: { fontSize: 7, cellPadding: 1.5, textColor: [30, 41, 59] },
    headStyles: { fillColor: [5, 150, 105], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [240, 253, 250] },
  });
  const lifecycleEnd = tableEnd();

  const readinessRows = [
    ["Department Submission Ready", readiness.department_submission_ready ? "Yes" : "No"],
    ["Super Admin Approval Ready", readiness.super_admin_approval_ready ? "Yes" : "No"],
    ["Unresolved Coverages", text(readinessCounts.unresolved_coverages, "0")],
    ["Not Marked Student Attendance", text(readinessCounts.not_marked_student_attendance, "0")],
    ["Present Without Substitute", text(readinessCounts.present_without_substitute, "0")],
    ["Invalid Substitute Assignments", text(readinessCounts.invalid_substitute_assignments, "0")],
    ["Pending Adjustments", text(readinessCounts.pending_adjustments, "0")],
  ];

  autoTable(doc, {
    startY: y,
    head: [["Readiness", "Value"]],
    body: readinessRows,
    theme: "grid",
    margin: { left: 199, right, top: topMargin, bottom: bottomMargin },
    tableWidth: pageWidth - 207,
    styles: { fontSize: 6.7, cellPadding: 1.35, textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: "center", cellWidth: 28 } },
  });
  const readinessEnd = tableEnd();

  y = Math.max(componentsEnd, lifecycleEnd, readinessEnd) + 6;

  const noteRows = [
    ["Department Note", text(payroll.department_note)],
    ["Super Admin Note", text(payroll.super_admin_note)],
  ];

  y = sectionTitle("Notes", y);
  autoTable(doc, {
    startY: y,
    head: [["Note", "Content"]],
    body: noteRows,
    theme: "grid",
    margin: { left, right, top: topMargin, bottom: bottomMargin },
    styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak", textColor: [30, 41, 59] },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: contentWidth - 38 } },
  });
  y = tableEnd() + 6;

  if (operationalBlockers.length || approvalBlockers.length) {
    const blockerRows = [
      ...operationalBlockers.map((item: unknown) => ["Attendance / schedule", blockerText(item)]),
      ...approvalBlockers.map((item: unknown) => ["Approval", blockerText(item)]),
    ];

    y = sectionTitle("Items to Review", y);
    autoTable(doc, {
      startY: y,
      head: [["Area", "Issue"]],
      body: blockerRows,
      theme: "grid",
      margin: { left, right, top: topMargin, bottom: bottomMargin },
      styles: { fontSize: 6.8, cellPadding: 1.35, overflow: "linebreak", textColor: [30, 41, 59] },
      headStyles: { fillColor: [225, 29, 72], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [255, 241, 242] },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: contentWidth - 30 } },
    });
    y = tableEnd() + 6;
  }

  y = sectionTitle("Adjustment History", y);
  const adjustmentRows = adjustments.length
    ? adjustments.map((row: any) => [
        text(row.adjustment_type_label || row.adjustment_type || row.type_label || row.type),
        text(row.effect_label || row.effect),
        money(row.amount),
        text(row.status_label || row.status),
        text(row.reason),
        sourcePeriod(row),
        text(row.review_note),
      ])
    : [["—", "—", money(0), "No adjustments", "—", "—", "—"]];

  autoTable(doc, {
    startY: y,
    head: [["Type", "Effect", "Amount", "Status", "Reason", "Applies To", "Review Note"]],
    body: adjustmentRows,
    theme: "grid",
    margin: { left, right, top: topMargin, bottom: bottomMargin },
    styles: { fontSize: 6.1, cellPadding: 1.1, overflow: "linebreak", textColor: [30, 41, 59] },
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [250, 245, 255] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 20, halign: "center" },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 25, halign: "center" },
      4: { cellWidth: 62 },
      5: { cellWidth: 31, halign: "center" },
      6: { cellWidth: contentWidth - 196 },
    },
  });
  y = tableEnd() + 6;

  y = sectionTitle(`Calculation Details (${ledger.length} entries)`, y);
  const ledgerRows = ledger.length
    ? ledger.map((row: any) => [
        text(row.date),
        text(row.entry_type_label || row.entry_type),
        text(row.student_name),
        text(row.salary_unit_number),
        text(row.class_count_at_time),
        money(row.rate),
        money(row.amount),
        sourcePeriod(row),
        text(row.description),
      ])
    : [["", "No calculation entries", "", "", "", money(0), money(0), "", ""]];

  autoTable(doc, {
    startY: y,
    head: [[
      "Date",
      "Reason",
      "Student",
      "Class Position",
      "Active Classes",
      "Rate",
      "Amount",
      "Applies To",
      "Description",
    ]],
    body: ledgerRows,
    theme: "grid",
    margin: { left, right, top: topMargin, bottom: bottomMargin },
    styles: {
      fontSize: ledger.length > 60 ? 4.8 : ledger.length > 30 ? 5.3 : 5.8,
      cellPadding: 0.9,
      overflow: "linebreak",
      valign: "middle",
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      fontSize: 5.4,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22, halign: "center" },
      1: { cellWidth: 37 },
      2: { cellWidth: 36 },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 19, halign: "center" },
      5: { cellWidth: 24, halign: "right" },
      6: { cellWidth: 27, halign: "right" },
      7: { cellWidth: 29, halign: "center" },
      8: { cellWidth: contentWidth - 212 },
    },
  });

  const totalPages = doc.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    doc.setPage(pageNumber);

    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, pageWidth, 31, "F");

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(8, 6, pageWidth - 16, 21, 4, 4, "F");

    doc.setFont("helvetica", "bold");
    doc.setTextColor(165, 180, 252);
    doc.setFontSize(7.2);
    doc.text("IQRA VIRTUAL SCHOOL", 14, 12.5);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11.5);
    doc.text(`${departmentName} · Salary Salary Calculation Details`, 14, 19);

    doc.setTextColor(203, 213, 225);
    doc.setFontSize(7);
    doc.text(
      `${period(payroll.month, payroll.year)} · ${text(payroll.status)}`,
      14,
      24,
    );

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.text(text(payroll.teacher_name), pageWidth - 14, 17, { align: "right" });

    doc.setTextColor(203, 213, 225);
    doc.setFontSize(6.8);
    doc.text(
      `Page ${pageNumber} of ${totalPages}`,
      pageWidth - 14,
      23.5,
      { align: "right" },
    );

    doc.setDrawColor(203, 213, 225);
    doc.line(left, pageHeight - 9, pageWidth - right, pageHeight - 9);
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(6.2);
    doc.text(
      "Generated from the recorded salary calculation.",
      left,
      pageHeight - 5,
    );
  }

  const filename = [
    "IVS_Salary_Details",
    safeFilePart(payroll.teacher_name),
    String(payroll.year),
    String(payroll.month).padStart(2, "0"),
  ].join("_");

  doc.save(`${filename}.pdf`);
}
