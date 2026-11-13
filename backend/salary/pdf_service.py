"""
IVS Unified Salary Management — Pure-Python Itemized Salary Slip PDF Generator.

Generates official itemized salary statement PDFs from approved payroll snapshots.
Uses pure Python without external binary or C-extension dependencies.
Complies with PDF-1.4 standard.
Supports Unicode, Urdu, and Arabic text rendering with font embedding,
RTL character shaping, and multi-page layout.
"""
from __future__ import annotations

import calendar
from datetime import datetime
import io
import os
import struct
import unicodedata
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from django.conf import settings
from django.utils import timezone

from salary.models import TeacherPayroll, SalaryPayrollPeriod


# ---------------------------------------------------------------------------
# Formatting Helpers
# ---------------------------------------------------------------------------

def format_pkr(val: Any) -> str:
    """Format decimal amount as standard PKR currency string."""
    try:
        d = Decimal(str(val or "0.00")).quantize(Decimal("0.01"))
        return f"PKR {d:,.2f}"
    except Exception:
        return "PKR 0.00"


# ---------------------------------------------------------------------------
# Arabic & Urdu Shaping Tables & Ligature Resolver
# ---------------------------------------------------------------------------

# char: (joining_group, (isolated, final, initial, medial))
# joining_group: 0 = non-joining, 1 = right-joining only, 2 = dual-joining
ARABIC_URDU_DATA: Dict[int, Tuple[int, Tuple[int, int, int, int]]] = {
    0x0621: (0, (0xFE80, 0xFE80, 0xFE80, 0xFE80)), # Hamza
    0x0622: (1, (0xFE81, 0xFE82, 0xFE81, 0xFE82)), # Alef Madda
    0x0623: (1, (0xFE83, 0xFE84, 0xFE83, 0xFE84)), # Alef Hamza Above
    0x0624: (1, (0xFE85, 0xFE86, 0xFE85, 0xFE86)), # Waw Hamza
    0x0625: (1, (0xFE87, 0xFE88, 0xFE87, 0xFE88)), # Alef Hamza Below
    0x0626: (2, (0xFE89, 0xFE8A, 0xFE8B, 0xFE8C)), # Yeh Hamza
    0x0627: (1, (0xFE8D, 0xFE8E, 0xFE8D, 0xFE8E)), # Alef
    0x0628: (2, (0xFE8F, 0xFE90, 0xFE91, 0xFE92)), # Beh
    0x0629: (1, (0xFE93, 0xFE94, 0xFE93, 0xFE94)), # Teh Marbuta
    0x062A: (2, (0xFE95, 0xFE96, 0xFE97, 0xFE98)), # Teh
    0x062B: (2, (0xFE99, 0xFE9A, 0xFE9B, 0xFE9C)), # Theh
    0x062C: (2, (0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0)), # Jeem
    0x062D: (2, (0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4)), # Hah
    0x062E: (2, (0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8)), # Khah
    0x062F: (1, (0xFEA9, 0xFEAA, 0xFEA9, 0xFEAA)), # Dal
    0x0630: (1, (0xFEAB, 0xFEAC, 0xFEAB, 0xFEAC)), # Thal
    0x0631: (1, (0xFEAD, 0xFEAE, 0xFEAD, 0xFEAE)), # Reh
    0x0632: (1, (0xFEAF, 0xFEB0, 0xFEAF, 0xFEB0)), # Zain
    0x0633: (2, (0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4)), # Seen
    0x0634: (2, (0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8)), # Sheen
    0x0635: (2, (0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC)), # Sad
    0x0636: (2, (0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0)), # Dad
    0x0637: (2, (0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4)), # Tah
    0x0638: (2, (0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8)), # Zah
    0x0639: (2, (0xFEC9, 0xFECA, 0xFECB, 0xFECC)), # Ain
    0x063A: (2, (0xFECD, 0xFECE, 0xFECF, 0xFED0)), # Ghain
    0x0641: (2, (0xFED1, 0xFED2, 0xFED3, 0xFED4)), # Feh
    0x0642: (2, (0xFED5, 0xFED6, 0xFED7, 0xFED8)), # Qaf
    0x0643: (2, (0xFED9, 0xFEDA, 0xFEDB, 0xFEDC)), # Kaf
    0x0644: (2, (0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0)), # Lam
    0x0645: (2, (0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4)), # Meem
    0x0646: (2, (0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8)), # Noon
    0x0647: (2, (0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC)), # Heh
    0x0648: (1, (0xFEED, 0xFEEE, 0xFEED, 0xFEEE)), # Waw
    0x0649: (1, (0xFEEF, 0xFEF0, 0xFEEF, 0xFEF0)), # Alef Maksura
    0x064A: (2, (0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4)), # Yeh
    # Urdu Extensions
    0x0679: (2, (0xFB66, 0xFB67, 0xFB68, 0xFB69)), # Tteh ٹ
    0x067E: (2, (0xFB56, 0xFB57, 0xFB58, 0xFB59)), # Peh پ
    0x0686: (2, (0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D)), # Cheh چ
    0x0688: (1, (0xFB88, 0xFB89, 0xFB88, 0xFB89)), # Ddal ڈ
    0x0691: (1, (0xFB8C, 0xFB8D, 0xFB8C, 0xFB8D)), # Rreh ڑ
    0x0698: (1, (0xFB8A, 0xFB8B, 0xFB8A, 0xFB8B)), # Zheh ژ
    0x06AF: (2, (0xFB92, 0xFB93, 0xFB94, 0xFB95)), # Gaf گ
    0x06BA: (1, (0xFB9E, 0xFB9F, 0xFB9E, 0xFB9F)), # Noon Ghunna ں
    0x06BE: (2, (0xFBAB, 0xFBAC, 0xFBAD, 0xFBAE)), # Heh Doachashmee ھ
    0x06C1: (2, (0xFBA6, 0xFBA7, 0xFBA8, 0xFBA9)), # Heh Goal ہ
    0x06CC: (2, (0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF)), # Urdu Yeh ی
    0x06D2: (1, (0xFBAE, 0xFBAF, 0xFBAE, 0xFBAF)), # Yeh Barree ے
}

LAM_ALEF_MAP: Dict[int, Tuple[int, int]] = {
    0x0622: (0xFEF5, 0xFEF6),
    0x0623: (0xFEF7, 0xFEF8),
    0x0625: (0xFEF9, 0xFEFA),
    0x0627: (0xFEFB, 0xFEFC),
}


def is_arabic_codepoint(cp: int) -> bool:
    """Check if codepoint is within Arabic or Urdu Unicode ranges."""
    return (0x0600 <= cp <= 0x06FF) or (0xFB50 <= cp <= 0xFDFF) or (0xFE70 <= cp <= 0xFEFF)


def shape_arabic_word(word: str) -> str:
    """
    Applies contextual Arabic character shaping (isolated, final, initial, medial)
    including Lam-Alef ligatures.
    """
    chars = list(word)
    merged: List[Tuple[int, int]] = []
    i = 0
    n = len(chars)
    while i < n:
        cp = ord(chars[i])
        # Skip harakat/tashkeel for base joining
        if 0x064B <= cp <= 0x065F:
            i += 1
            continue
        if cp == 0x0644 and i + 1 < n and ord(chars[i+1]) in LAM_ALEF_MAP:
            alef_cp = ord(chars[i+1])
            merged.append((-(LAM_ALEF_MAP[alef_cp][0]), 1))
            i += 2
        elif cp in ARABIC_URDU_DATA:
            merged.append((cp, ARABIC_URDU_DATA[cp][0]))
            i += 1
        else:
            merged.append((cp, 0))
            i += 1

    shaped: List[str] = []
    m_len = len(merged)
    for idx, (cp, jtype) in enumerate(merged):
        if cp < 0:
            iso_code = -cp
            prev_connects = (idx > 0 and merged[idx-1][1] == 2)
            for alef_code, (iso, fin) in LAM_ALEF_MAP.items():
                if iso == iso_code:
                    shaped.append(chr(fin if prev_connects else iso))
                    break
            continue

        if cp not in ARABIC_URDU_DATA:
            shaped.append(chr(cp))
            continue

        prev_connects = (idx > 0 and merged[idx-1][1] == 2)
        next_connects = (idx + 1 < m_len and merged[idx+1][1] in (1, 2) and jtype == 2)

        forms = ARABIC_URDU_DATA[cp][1]
        if prev_connects and next_connects:
            shaped.append(chr(forms[3])) # medial
        elif prev_connects:
            shaped.append(chr(forms[1])) # final
        elif next_connects:
            shaped.append(chr(forms[2])) # initial
        else:
            shaped.append(chr(forms[0])) # isolated

    return "".join(shaped)


def bidi_reorder(text: str) -> str:
    """
    Processes mixed bidirectional text.
    Arabic and Urdu words are shaped and visually reversed so they render correctly
    in standard left-to-right PDF text streams.
    """
    if not text:
        return ""
    if not any(is_arabic_codepoint(ord(c)) for c in text):
        return text

    tokens = text.split(" ")
    processed_tokens: List[str] = []
    for token in tokens:
        if any(is_arabic_codepoint(ord(c)) for c in token):
            shaped = shape_arabic_word(token)
            processed_tokens.append(shaped[::-1])
        else:
            processed_tokens.append(token)

    arabic_count = sum(1 for c in text if is_arabic_codepoint(ord(c)))
    latin_count = sum(1 for c in text if ('a' <= c <= 'z' or 'A' <= c <= 'Z'))
    if arabic_count > latin_count:
        return " ".join(reversed(processed_tokens))
    return " ".join(processed_tokens)


# ---------------------------------------------------------------------------
# TrueType Font Parser and CMap Manager
# ---------------------------------------------------------------------------

class TTFFontManager:
    """
    Pure-Python TrueType font loader and CMap extractor.
    Discovers licensed Unicode fonts (DejaVu Sans / Tahoma / Arial) and
    builds PDF Type 0 composite font metrics and ToUnicode CMaps.
    """
    _instance: Optional["TTFFontManager"] = None

    def __init__(self):
        self.font_bytes: Optional[bytes] = None
        self.font_name: str = "UnicodeFont"
        self.cmap: Dict[int, int] = {} # char_code -> GID
        self.ascent = 800
        self.descent = -200
        self.cap_height = 700
        self.bbox = [-600, -300, 1500, 1000]
        self._load()

    @classmethod
    def get_instance(cls) -> "TTFFontManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _load(self):
        candidates: List[Path] = []
        custom_path = getattr(settings, "SALARY_UNICODE_FONT_PATH", None)
        if custom_path:
            candidates.append(Path(custom_path))

        bundled_font = Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf"
        candidates.append(bundled_font)
        candidates.append(Path("C:/Windows/Fonts/tahoma.ttf"))
        candidates.append(Path("C:/Windows/Fonts/arial.ttf"))
        candidates.append(Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
        candidates.append(Path("/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"))

        chosen: Optional[Path] = None
        for p in candidates:
            if p.exists() and p.is_file():
                chosen = p
                break

        if not chosen:
            return

        try:
            with open(chosen, "rb") as f:
                data = f.read()
            self.font_bytes = data
            self.font_name = chosen.stem.replace(" ", "")

            num_tables, = struct.unpack(">H", data[4:6])
            pos = 12
            cmap_offset = None
            hhea_offset = None

            for _ in range(num_tables):
                tag = data[pos:pos+4]
                offset, length = struct.unpack(">II", data[pos+8:pos+16])
                if tag == b"cmap":
                    cmap_offset = offset
                elif tag == b"hhea":
                    hhea_offset = offset
                pos += 16

            if hhea_offset:
                asc, desc = struct.unpack(">hh", data[hhea_offset+4:hhea_offset+8])
                self.ascent = asc
                self.descent = desc

            if cmap_offset:
                version, num_subtables = struct.unpack(">HH", data[cmap_offset:cmap_offset+4])
                sub_off = None
                for i in range(num_subtables):
                    plat, enc, s_off = struct.unpack(">HHI", data[cmap_offset+4+i*8:cmap_offset+12+i*8])
                    fmt, = struct.unpack(">H", data[cmap_offset+s_off:cmap_offset+s_off+2])
                    if fmt == 4:
                        sub_off = cmap_offset + s_off
                        break
                if sub_off:
                    fmt, length, lang, seg_count_x2 = struct.unpack(">HHHH", data[sub_off:sub_off+8])
                    seg_count = seg_count_x2 // 2
                    end_codes = struct.unpack(f">{seg_count}H", data[sub_off+14:sub_off+14+seg_count*2])
                    start_codes = struct.unpack(f">{seg_count}H", data[sub_off+16+seg_count*2:sub_off+16+seg_count*4])
                    id_deltas = struct.unpack(f">{seg_count}h", data[sub_off+16+seg_count*4:sub_off+16+seg_count*6])
                    id_range_offsets = struct.unpack(f">{seg_count}H", data[sub_off+16+seg_count*6:sub_off+16+seg_count*8])

                    for i in range(seg_count):
                        st = start_codes[i]
                        en = end_codes[i]
                        delta = id_deltas[i]
                        ro = id_range_offsets[i]
                        if st == 0xFFFF:
                            break
                        for c in range(st, en + 1):
                            if ro == 0:
                                gid = (c + delta) & 0xFFFF
                            else:
                                ro_addr = sub_off + 16 + seg_count*6 + i*2 + ro + (c - st)*2
                                if ro_addr + 2 <= len(data):
                                    g, = struct.unpack(">H", data[ro_addr:ro_addr+2])
                                    gid = (g + delta) & 0xFFFF if g != 0 else 0
                                else:
                                    gid = 0
                            if gid:
                                self.cmap[c] = gid
        except Exception:
            self.font_bytes = None
            self.cmap.clear()

    def get_glyph_id(self, cp: int) -> int:
        return self.cmap.get(cp, 0)


# ---------------------------------------------------------------------------
# Text Encoding Helper
# ---------------------------------------------------------------------------

def _escape_pdf_text(text: str) -> str:
    """Escape special characters for PDF literal strings."""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def encode_pdf_text_element(
    text: str,
    default_font: str,
    font_mgr: TTFFontManager,
    used_cids: Dict[int, int],
) -> Tuple[str, str]:
    """
    Selects the optimal PDF font and encoding for the text.
    If text contains Unicode characters beyond Latin-1 and a Unicode font is available:
    shapes and bidi-reorders the string, looks up TrueType glyph IDs, records the CID mapping,
    and returns ("/F_UNI", "<hex_gids>").
    Otherwise, returns (default_font, "(escaped_text)").
    """
    if not text:
        return default_font, "()"

    has_unicode = any(ord(c) > 126 or ord(c) < 32 for c in text)
    if has_unicode and font_mgr.font_bytes:
        processed = bidi_reorder(text)
        gids: List[int] = []
        for ch in processed:
            cp = ord(ch)
            gid = font_mgr.get_glyph_id(cp)
            gids.append(gid)
            used_cids[gid] = cp
        hex_content = "".join(f"{g:04X}" for g in gids)
        return "/F_UNI", f"<{hex_content}>"
    else:
        # Standard ASCII / Latin-1
        try:
            ascii_text = text.encode("latin1").decode("latin1")
        except UnicodeEncodeError:
            ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "replace").decode("ascii")
        return default_font, f"({_escape_pdf_text(ascii_text)})"


# ---------------------------------------------------------------------------
# Data Extraction Service
# ---------------------------------------------------------------------------

def get_salary_slip_statement_data(teacher_payroll: TeacherPayroll) -> Dict[str, Any]:
    """
    Extracts structured, itemized salary statement data from the TeacherPayroll
    and its approved or submitted period snapshot.
    """
    try:
        teacher_payroll.refresh_from_db()
    except Exception:
        pass
    period = teacher_payroll.payroll_period
    try:
        period.refresh_from_db()
    except Exception:
        pass
    teacher = teacher_payroll.teacher
    teacher_name = getattr(teacher, "historical_name", "") or (
        teacher.user.get_full_name() if teacher and teacher.user else f"Teacher #{teacher_payroll.teacher_id}"
    )

    basic_salary = teacher_payroll.basic_salary
    regular_class_earnings = teacher_payroll.regular_class_earnings
    lesson_bonuses = teacher_payroll.lesson_bonuses
    substitute_earnings = teacher_payroll.substitute_earnings
    cancellation_earnings = teacher_payroll.cancellation_earnings
    positive_adjustments = teacher_payroll.positive_adjustments
    cuttings = teacher_payroll.cuttings
    gross_salary = teacher_payroll.gross_salary
    net_salary = teacher_payroll.net_salary

    individual_bonuses = Decimal("0.00")
    bulk_bonuses = Decimal("0.00")
    individual_cuttings = Decimal("0.00")
    bulk_cuttings = Decimal("0.00")
    advance_recovery = Decimal("0.00")

    adjustments = teacher.payroll_adjustments.filter(
        period_year=period.payroll_year,
        period_month=period.payroll_month,
        status="confirmed",
    )
    for adj in adjustments:
        if adj.direction == "credit":
            if adj.batch_id:
                bulk_bonuses += adj.amount
            else:
                individual_bonuses += adj.amount
        elif adj.direction == "debit":
            if adj.advance_recovery_id:
                advance_recovery += adj.amount
            elif adj.batch_id:
                bulk_cuttings += adj.amount
            else:
                individual_cuttings += adj.amount

    if individual_bonuses + bulk_bonuses == Decimal("0.00") and positive_adjustments > Decimal("0.00"):
        individual_bonuses = positive_adjustments
    if individual_cuttings + bulk_cuttings + advance_recovery == Decimal("0.00") and cuttings > Decimal("0.00"):
        individual_cuttings = cuttings

    payments = teacher_payroll.payment_records.all().order_by("payment_date", "id")
    payments_data = [
        {
            "id": p.id,
            "method": p.get_payment_method_display(),
            "amount": format_pkr(p.amount_paid),
            "date": p.payment_date.isoformat(),
            "reference": p.reference_number,
        }
        for p in payments
    ]

    is_approved = period.status in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]

    return {
        "statement_id": f"SLIP-{period.payroll_year}-{period.payroll_month:02d}-{teacher_payroll.id}",
        "institution_name": period.institution.name,
        "department_name": period.department.name,
        "teacher_id": teacher_payroll.teacher_id,
        "teacher_name": teacher_name,
        "payroll_year": period.payroll_year,
        "payroll_month": period.payroll_month,
        "period_label": f"{period.payroll_year}-{period.payroll_month:02d}",
        "status": period.status,
        "status_display": period.get_status_display(),
        "is_approved": is_approved,
        "is_draft": not is_approved,
        "approval_info": {
            "approved_by": (
                period.approved_by.get_full_name() or period.approved_by.username
                if period.approved_by
                else None
            ),
            "approved_at": period.approved_at.isoformat() if period.approved_at else None,
            "notes": period.approval_notes,
        },
        "payment_summary": {
            "paid_amount": format_pkr(teacher_payroll.paid_amount),
            "payment_status": teacher_payroll.get_payment_status_display(),
            "is_fully_paid": teacher_payroll.payment_status == "paid",
            "records": payments_data,
        },
        "financials": {
            "basic_salary": format_pkr(basic_salary),
            "regular_class_earnings": format_pkr(regular_class_earnings),
            "lesson_bonuses": format_pkr(lesson_bonuses),
            "substitute_earnings": format_pkr(substitute_earnings),
            "cancellation_earnings": format_pkr(cancellation_earnings),
            "gross_salary": format_pkr(gross_salary),
            "individual_bonuses": format_pkr(individual_bonuses),
            "bulk_bonuses": format_pkr(bulk_bonuses),
            "total_additions": format_pkr(positive_adjustments),
            "individual_cuttings": format_pkr(individual_cuttings),
            "bulk_cuttings": format_pkr(bulk_cuttings),
            "advance_recovery": format_pkr(advance_recovery),
            "total_cuttings": format_pkr(cuttings),
            "net_salary": format_pkr(net_salary),
        },
        "raw_amounts": {
            "gross": str(gross_salary),
            "additions": str(positive_adjustments),
            "cuttings": str(cuttings),
            "net": str(net_salary),
            "paid": str(teacher_payroll.paid_amount),
        },
    }


# ---------------------------------------------------------------------------
# Clean PDF Binary Assembler
# ---------------------------------------------------------------------------

def assemble_pdf_1_4(
    pages_lines: List[List[str]],
    used_cids: Dict[int, int],
    font_mgr: TTFFontManager,
) -> bytes:
    """
    Assembles a fully compliant, strictly numbered PDF-1.4 binary stream
    with multi-page /Pages tree, embedded Type 0 Unicode font, and cross-reference table.
    """
    num_p = len(pages_lines)
    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: List[int] = []

    def write_item(b: bytes) -> int:
        offsets.append(pdf.tell())
        pdf.write(f"{len(offsets)} 0 obj\n".encode("ascii") + b + b"\nendobj\n")
        return len(offsets)

    has_uni = bool(font_mgr.font_bytes and used_cids)

    # 1: Catalog
    write_item(b"<< /Type /Catalog /Pages 2 0 R >>")

    # 2: Pages container
    page_ids = [3 + i for i in range(num_p)]
    kids_str = " ".join(f"{pid} 0 R" for pid in page_ids)
    write_item(f"<< /Type /Pages /Kids [{kids_str}] /Count {num_p} >>".encode("ascii"))

    res_id = 3 + 2 * num_p
    f1_id = res_id + 1
    f2_id = res_id + 2
    funi_id = res_id + 3
    cid_id = res_id + 4
    desc_id = res_id + 5
    file_id = res_id + 6
    cmap_id = res_id + 7

    # Page objects: 3 .. 2+num_p
    for i in range(num_p):
        c_id = 3 + num_p + i
        write_item(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents {c_id} 0 R /Resources {res_id} 0 R >>".encode("ascii"))

    # Content streams: (3+num_p) .. (2+2*num_p)
    for pl in pages_lines:
        stream_b = "\n".join(pl).encode("latin1")
        write_item(f"<< /Length {len(stream_b)} >>\nstream\n".encode("ascii") + stream_b + b"\nendstream")

    # Resources: res_id
    uni_ref = f" /F_UNI {funi_id} 0 R" if has_uni else ""
    write_item(f"<< /Font << /F1 {f1_id} 0 R /F2 {f2_id} 0 R{uni_ref} >> >>".encode("ascii"))

    # Standard Type 1 fonts
    write_item(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    write_item(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    # Embedded Unicode font objects
    if has_uni and font_mgr.font_bytes:
        write_item(f"<< /Type /Font /Subtype /Type0 /BaseFont /{font_mgr.font_name} /Encoding /Identity-H /DescendantFonts [{cid_id} 0 R] /ToUnicode {cmap_id} 0 R >>".encode("ascii"))
        write_item(f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{font_mgr.font_name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor {desc_id} 0 R /CIDToGIDMap /Identity /DW 1000 >>".encode("ascii"))
        desc_s = f"<< /Type /FontDescriptor /FontName /{font_mgr.font_name} /Flags 32 /FontBBox [{font_mgr.bbox[0]} {font_mgr.bbox[1]} {font_mgr.bbox[2]} {font_mgr.bbox[3]}] /ItalicAngle 0 /Ascent {font_mgr.ascent} /Descent {font_mgr.descent} /CapHeight {font_mgr.cap_height} /StemV 80 /FontFile2 {file_id} 0 R >>"
        write_item(desc_s.encode("ascii"))
        write_item(f"<< /Length {len(font_mgr.font_bytes)} /Length1 {len(font_mgr.font_bytes)} >>\nstream\n".encode("ascii") + font_mgr.font_bytes + b"\nendstream")

        cmap_lines = []
        for g, c in sorted(used_cids.items()):
            cmap_lines.append(f"<{g:04X}> <{c:04X}>")
        cmap_body = f"""/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Custom-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
{len(cmap_lines)} beginbfchar
{chr(10).join(cmap_lines)}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end"""
        cmap_b = cmap_body.encode("ascii")
        write_item(f"<< /Length {len(cmap_b)} >>\nstream\n".encode("ascii") + cmap_b + b"\nendstream")

    # XRef Table
    xref_pos = pdf.tell()
    pdf.write(f"xref\n0 {len(offsets) + 1}\n".encode("ascii"))
    pdf.write(b"0000000000 65535 f \n")
    for off in offsets:
        pdf.write(f"{off:010d} 00000 n \n".encode("ascii"))

    # Trailer
    pdf.write(
        f"trailer\n<< /Size {len(offsets) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )

    return pdf.getvalue()


# ---------------------------------------------------------------------------
# Main PDF Generator
# ---------------------------------------------------------------------------

def generate_salary_slip_pdf(teacher_payroll: Union[TeacherPayroll, Dict[str, Any]]) -> bytes:
    """
    Generates a clean, valid PDF 1.4 binary salary statement for the given TeacherPayroll or dictionary payload.
    Supports Unicode teacher & institution names (English, Urdu, Arabic),
    right-to-left character shaping, multi-page overflow, and approved immutability snapshots.
    """
    if isinstance(teacher_payroll, dict):
        data = dict(teacher_payroll)
    else:
        data = get_salary_slip_statement_data(teacher_payroll)

    fin = data.get("financials")
    if not fin and "earnings" in data:
        earn = data["earnings"]
        fin = {
            "basic_salary": earn.get("basic_salary_earnings", "0.00"),
            "regular_class_earnings": earn.get("regular_class_earnings", "0.00"),
            "lesson_bonuses": earn.get("lesson_plan_bonus_earnings", "0.00"),
            "substitute_earnings": earn.get("substitute_compensation_earnings", "0.00"),
            "cancellation_earnings": earn.get("cancellation_earnings", "0.00"),
            "individual_bonuses": earn.get("positive_adjustments", "0.00"),
            "bulk_bonuses": "0.00",
            "total_additions": earn.get("positive_adjustments", "0.00"),
            "individual_cuttings": earn.get("cuttings", "0.00"),
            "bulk_cuttings": "0.00",
            "advance_recovery": "0.00",
            "total_cuttings": earn.get("cuttings", "0.00"),
            "gross_salary": earn.get("gross_draft_earnings", "0.00"),
            "net_salary": earn.get("draft_net_salary", "0.00"),
        }
        data["financials"] = fin
    elif fin:
        if "total_additions" not in fin:
            fin["total_additions"] = fin.get("positive_adjustments", "0.00")
        if "total_cuttings" not in fin:
            fin["total_cuttings"] = fin.get("cuttings", "0.00")
    is_approved = data.get("is_approved", data.get("status") in ["APPROVED", "PAID"])
    teacher_name = data.get("teacher_name", "Unknown Teacher")
    if "statement_id" not in data:
        data["statement_id"] = f"SLIP-{data.get('payroll_year', 2026)}-{data.get('payroll_month', 1):02d}-1"
    if "period_label" not in data:
        m = data.get("payroll_month", 1)
        y = data.get("payroll_year", 2026)
        data["period_label"] = f"{calendar.month_name[m]} {y}"
    if "generated_at" not in data:
        data["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M UTC")
    if "teacher_id" not in data:
        data["teacher_id"] = 1
    if "designation" not in data:
        data["designation"] = "Teacher"
    if "compensation_model" not in data:
        data["compensation_model"] = "Per-Class"
    if "payments" not in data:
        data["payments"] = []
    if "status_display" not in data:
        data["status_display"] = data.get("status", "APPROVED")
    if "approval_info" not in data:
        data["approval_info"] = {"approved_by": "Authorized Administrator", "approved_at": None}
    if "payment_summary" not in data:
        data["payment_summary"] = {
            "payment_status": data.get("payment_status", "Unpaid" if not is_approved else "Paid"),
            "paid_amount": "0.00",
            "is_fully_paid": is_approved,
            "records": data.get("payments", []),
        }

    font_mgr = TTFFontManager.get_instance()
    used_cids: Dict[int, int] = {}
    pages_lines: List[List[str]] = [[]]

    p1 = pages_lines[0]

    # 1. Header Card (Navy box)
    p1.append("0.086 0.137 0.278 rg")
    p1.append("18 730 559 80 re f")

    inst_font, inst_text = encode_pdf_text_element(data["institution_name"].upper(), "/F2", font_mgr, used_cids)
    p1.append(f"BT {inst_font} 15 Tf 1 1 1 rg 36 775 Td {inst_text} Tj ET")

    dept_title = f"{data['department_name']} - OFFICIAL SALARY STATEMENT"
    dept_font, dept_text = encode_pdf_text_element(dept_title, "/F1", font_mgr, used_cids)
    p1.append(f"BT {dept_font} 10 Tf 0.85 0.90 0.98 rg 36 755 Td {dept_text} Tj ET")

    p1.append(f"BT /F2 11 Tf 1 1 1 rg 430 765 Td (MONTH: {_escape_pdf_text(data['period_label'])}) Tj ET")

    # 2. Watermark for Draft Preview
    if not is_approved:
        p1.append("0.92 0.92 0.92 rg")
        p1.append("BT")
        p1.append("/F2 32 Tf")
        p1.append("q 0.707 0.707 -0.707 0.707 160 380 cm")
        p1.append("(DRAFT PREVIEW - NOT APPROVED) Tj")
        p1.append("Q")
        p1.append("ET")

    # 3. Teacher Info Card
    p1.append("0.96 0.97 0.98 rg")
    p1.append("18 660 559 55 re f")
    p1.append("0.85 0.88 0.92 RG 1 w")
    p1.append("18 660 559 55 re S")

    # Adaptive font sizing for teacher name
    name_len = len(teacher_name)
    name_font_size = 12
    if name_len > 40:
        name_font_size = 9
    elif name_len > 30:
        name_font_size = 10.5

    t_font, t_text = encode_pdf_text_element(f"Teacher: {teacher_name}", "/F2", font_mgr, used_cids)
    p1.append(f"BT {t_font} {name_font_size} Tf 0.1 0.15 0.25 rg 36 695 Td {t_text} Tj ET")

    p1.append(
        f"BT /F1 9 Tf 0.35 0.40 0.48 rg "
        f"36 675 Td (Teacher ID: #{data['teacher_id']} | Status: {_escape_pdf_text(data['status_display'].upper())}) Tj ET"
    )

    # Approval Badge
    p1.append("BT /F1 9 Tf 0.1 0.15 0.25 rg")
    if is_approved:
        app_by = data["approval_info"]["approved_by"] or "Authorized Administrator"
        app_at = data["approval_info"]["approved_at"][:10] if data["approval_info"]["approved_at"] else "Recorded"
        f_by, t_by = encode_pdf_text_element(f"Approved by: {app_by}", "/F1", font_mgr, used_cids)
        p1.append(f"360 695 Td {t_by} Tj")
        p1.append(f"360 675 Td (Approval Date: {_escape_pdf_text(app_at)}) Tj")
    else:
        p1.append("360 685 Td (Approval Status: PENDING / DRAFT) Tj")
    p1.append("ET")

    # 4. Itemized Tables (Earnings Left, Deductions Right)
    p1.append("0.2 0.3 0.5 RG 1.5 w 18 640 270 0 m 288 640 l S")
    p1.append("BT /F2 11 Tf 0.086 0.137 0.278 rg 25 645 Td (GROSS EARNINGS & BONUSES) Tj ET")

    earnings_rows = [
        ("Basic Monthly Salary", fin["basic_salary"]),
        ("Regular Classes Taught", fin["regular_class_earnings"]),
        ("Lesson Plan Bonuses", fin["lesson_bonuses"]),
        ("Substitute Teaching Pay", fin["substitute_earnings"]),
        ("Official Cancellations", fin["cancellation_earnings"]),
        ("Individual Bonuses/Additions", fin["individual_bonuses"]),
        ("Bulk Bonuses Batch", fin["bulk_bonuses"]),
    ]
    y = 620
    for label, val in earnings_rows:
        p1.append(f"BT /F1 9 Tf 0.2 0.2 0.25 rg 25 {y} Td ({_escape_pdf_text(label)}) Tj 210 {y} Td ({_escape_pdf_text(val)}) Tj ET")
        y -= 20

    p1.append(f"18 {y+5} 270 0 m 288 {y+5} l S")
    p1.append(f"BT /F2 10 Tf 0.086 0.137 0.278 rg 25 {y-10} Td (TOTAL GROSS + ADDITIONS) Tj 200 {y-10} Td ({_escape_pdf_text(fin['gross_salary'])}) Tj ET")

    p1.append("0.7 0.2 0.2 RG 1.5 w 306 640 270 0 m 576 640 l S")
    p1.append("BT /F2 11 Tf 0.6 0.1 0.1 rg 315 645 Td (DEDUCTIONS & CUTTINGS) Tj ET")

    deductions_rows = [
        ("Individual Cuttings/Deductions", fin["individual_cuttings"]),
        ("Bulk Cuttings Batch", fin["bulk_cuttings"]),
        ("Advance Salary Recovery", fin["advance_recovery"]),
    ]
    y_ded = 620
    for label, val in deductions_rows:
        p1.append(f"BT /F1 9 Tf 0.2 0.2 0.25 rg 315 {y_ded} Td ({_escape_pdf_text(label)}) Tj 490 {y_ded} Td ({_escape_pdf_text(val)}) Tj ET")
        y_ded -= 20

    p1.append(f"306 {y+5} 270 0 m 576 {y+5} l S")
    p1.append(f"BT /F2 10 Tf 0.6 0.1 0.1 rg 315 {y-10} Td (TOTAL DEDUCTIONS) Tj 490 {y-10} Td ({_escape_pdf_text(fin['total_cuttings'])}) Tj ET")

    # 5. Net Salary Highlight Banner
    y_net = y - 60
    p1.append(f"0.93 0.96 0.99 rg 18 {y_net} 559 45 re f 0.1 0.3 0.6 RG 2 w 18 {y_net} 559 45 re S")
    p1.append(f"BT /F2 14 Tf 0.086 0.137 0.278 rg 36 {y_net+16} Td (FINAL APPROVED NET SALARY:) Tj 360 {y_net+16} Td ({_escape_pdf_text(fin['net_salary'])}) Tj ET")

    # 6. Payment Settlement Status Section
    y_pay = y_net - 45
    p1.append(
        f"BT /F2 10 Tf 0.1 0.15 0.25 rg "
        f"25 {y_pay} Td (PAYMENT SETTLEMENT STATUS: {_escape_pdf_text(data['payment_summary']['payment_status'].upper())}) Tj "
        f"360 {y_pay} Td (Amount Paid: {_escape_pdf_text(data['payment_summary']['paid_amount'])}) Tj ET"
    )

    # 7. Payment Disbursement Records with Multi-Page Overflow
    y_rec = y_pay - 20
    records = data["payment_summary"]["records"]
    cur_page_lines = p1

    if records:
        cur_page_lines.append("BT /F1 8 Tf 0.3 0.35 0.4 rg 25 " + str(y_rec) + " Td (Recorded Disbursements:) Tj ET")
        y_rec -= 15

        for rec in records:
            if y_rec < 65:
                # Add new overflow page
                pages_lines.append([])
                cur_page_lines = pages_lines[-1]
                cur_page_lines.append("0.086 0.137 0.278 rg 18 780 559 40 re f")
                f_cont, t_cont = encode_pdf_text_element(
                    f"{data['institution_name'].upper()} - SALARY STATEMENT (CONTINUED) | {teacher_name}",
                    "/F2",
                    font_mgr,
                    used_cids,
                )
                cur_page_lines.append(f"BT {f_cont} 10 Tf 1 1 1 rg 36 795 Td {t_cont} Tj ET")
                cur_page_lines.append("BT /F1 8 Tf 0.3 0.35 0.4 rg 25 760 Td (Additional Recorded Disbursements / Audit Trail:) Tj ET")
                y_rec = 740

            ref_val = rec.get("reference") or rec.get("payment_reference") or f"TXN-{rec.get('id', 'N/A')}"
            meth_val = rec.get("method") or rec.get("payment_method") or "Bank Transfer"
            date_val = rec.get("date") or rec.get("payment_date") or ""
            amt_val = rec.get("amount") or rec.get("amount_paid") or "0.00"
            cur_page_lines.append(
                f"BT /F1 8 Tf 0.2 0.2 0.2 rg "
                f"36 {y_rec} Td (Ref #{_escape_pdf_text(str(ref_val))} | {_escape_pdf_text(str(meth_val))} | "
                f"Date: {_escape_pdf_text(str(date_val))} | {_escape_pdf_text(str(amt_val))}) Tj ET"
            )
            y_rec -= 14
    else:
        cur_page_lines.append(f"BT /F1 8 Tf 0.5 0.5 0.5 rg 25 {y_rec} Td (No external payment disbursement records posted yet.) Tj ET")

    # 8. Footers on all pages
    total_pages = len(pages_lines)
    for p_idx, pl in enumerate(pages_lines):
        pl.append("BT /F1 7 Tf 0.4 0.45 0.5 rg")
        pl.append(
            f"18 35 Td (IQRA Virtual School - Confidential Unified Salary Statement. Page {p_idx+1} of {total_pages}. "
            "Generated deterministically from approved immutable snapshots.) Tj"
        )
        pl.append(
            f"18 25 Td (Statement Ref: {_escape_pdf_text(data['statement_id'])} | Generated: {timezone.now().strftime('%Y-%m-%d %H:%M:%S UTC')}) Tj"
        )
        pl.append("ET")

    return assemble_pdf_1_4(pages_lines, used_cids, font_mgr)
