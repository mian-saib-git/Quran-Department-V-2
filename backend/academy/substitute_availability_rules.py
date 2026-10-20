"""Pure substitute-eligibility rules. No database side effects."""

def can_release_scheduled_teacher(student_statuses, teacher_status):
    """An overlapping class releases its teacher only after confirmed absences.

    Teacher must be explicitly marked present for that scheduled session.
    Every enrolled student in that session must be marked absent or leave.
    Missing/unmarked attendance must never free a teacher.
    """
    statuses = list(student_statuses)
    return (
        teacher_status == "present"
        and bool(statuses)
        and all(s in {"absent", "leave"} for s in statuses)
    )
