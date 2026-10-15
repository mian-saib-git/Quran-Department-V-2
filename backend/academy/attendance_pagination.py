"""Bounded attendance reads. Authorization must be applied before these helpers."""
from datetime import date
from django.db.models import Count, Max, Q
from rest_framework.exceptions import ValidationError


def positive_int(params, key, default):
    raw = params.get(key, default)
    try:
        value = int(raw)
    except (ValueError, TypeError):
        raise ValidationError({key: "Use a positive integer."})
    if value < 1:
        raise ValidationError({key: "Use a positive integer."})
    return value


def filter_attendance(queryset, params):
    dates = {}
    for key in ("date", "date_from", "date_to"):
        value = params.get(key)
        if value:
            try:
                dates[key] = date.fromisoformat(value)
            except (TypeError, ValueError):
                raise ValidationError({key: "Use YYYY-MM-DD."})
    if dates.get("date_from", date.min) > dates.get("date_to", date.max):
        raise ValidationError({"date_to": "Must not precede date_from."})
    if "date" in dates:
        queryset = queryset.filter(date=dates["date"])
    basis = params.get("date_basis", "attendance")
    if basis not in ("attendance", "updated", "either"):
        raise ValidationError({"date_basis": "Use attendance, updated or either."})
    by_date, by_update = Q(), Q()
    for key, suffix in (("date_from", "gte"), ("date_to", "lte")):
        if key in dates:
            by_date &= Q(**{f"date__{suffix}": dates[key]})
            by_update &= Q(**{f"updated_at__date__{suffix}": dates[key]})
    queryset = queryset.filter(by_date if basis == "attendance" else by_update if basis == "updated" else by_date | by_update)
    for key in ("teacher_id", "student_id", "schedule_id"):
        if params.get(key):
            queryset = queryset.filter(**{key: positive_int(params, key, None)})
    for key, choices in (("entity_type", ("student", "teacher")), ("status", ("present", "absent", "leave"))):
        if params.get(key):
            if params[key] not in choices:
                raise ValidationError({key: "Invalid choice."})
            queryset = queryset.filter(**{key: params[key]})
    if params.get("class_key"):
        queryset = queryset.filter(class_key=params["class_key"])
    return queryset


def attendance_page(queryset, params):
    page = positive_int(params, "page", 1)
    size = min(positive_int(params, "page_size", 100), 500)
    snapshot = params.get("snapshot")
    if snapshot is None:
        snapshot = queryset.aggregate(value=Max("id"))["value"] or 0
    else:
        try:
            snapshot = int(snapshot)
            if snapshot < 0:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError({"snapshot": "Invalid snapshot."})
    queryset = queryset.filter(id__lte=snapshot)
    counts = dict(queryset.order_by().values_list("status").annotate(total=Count("id")))
    total = sum(counts.values())
    pages = max(1, (total + size - 1) // size)
    rows = list(queryset.order_by("-date", "-id")[(page - 1) * size:page * size])
    metadata = {
        "count": total, "page": page, "page_size": size, "total_pages": pages,
        "next": page + 1 if page < pages else None,
        "previous": page - 1 if page > 1 else None,
        "snapshot": snapshot, "status_counts": counts,
    }
    return rows, metadata
