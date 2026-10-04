import base64
import hashlib
import os
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError

from .models import PlatformAuditLog, PlatformSetting, User


SETTING_CORS_ORIGINS = "cors_allowed_origins"
SETTING_GEMINI_MODEL = "gemini_model"
SETTING_GEMINI_API_KEY = "gemini_api_key"
SETTING_BACKUP_RETENTION = "backup_retention_count"
SETTING_MAINTENANCE_MESSAGE = "maintenance_message"

CACHE_KEY_RUNTIME_SETTINGS = "ivs_platform_runtime_settings_v1"


def is_main_admin(user) -> bool:
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and (
            getattr(user, "is_superuser", False)
            or getattr(user, "role", "") == User.Role.PLATFORM_ADMIN
        )
    )


def require_current_password(user, password: str) -> str | None:
    password = str(password or "")
    if not password:
        return "Your current Main Admin password is required."
    if not user.check_password(password):
        return "The current Main Admin password is incorrect."
    return None


def _fernet_instances():
    try:
        from cryptography.fernet import Fernet, MultiFernet
    except ImportError as exc:
        raise RuntimeError(
            "The cryptography package is required for secure secret storage. "
            "Run: pip install cryptography"
        ) from exc

    keys = [settings.SECRET_KEY]
    keys.extend(getattr(settings, "SECRET_KEY_FALLBACKS", []) or [])
    fernets = []
    for raw_key in keys:
        digest = hashlib.sha256(str(raw_key).encode("utf-8")).digest()
        fernets.append(Fernet(base64.urlsafe_b64encode(digest)))
    return MultiFernet(fernets)


def encrypt_secret(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    return _fernet_instances().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    try:
        return _fernet_instances().decrypt(value.encode("ascii")).decode("utf-8")
    except Exception:
        return ""


def invalidate_runtime_settings_cache() -> None:
    cache.delete(CACHE_KEY_RUNTIME_SETTINGS)


def _load_runtime_settings() -> dict[str, Any]:
    cached = cache.get(CACHE_KEY_RUNTIME_SETTINGS)
    if isinstance(cached, dict):
        return cached

    values: dict[str, Any] = {}
    try:
        for item in PlatformSetting.objects.all():
            values[item.key] = {
                "value": item.value,
                "encrypted_value": item.encrypted_value,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            }
    except (DatabaseError, Exception):
        # During migrations or startup, environment settings remain available.
        values = {}

    cache.set(CACHE_KEY_RUNTIME_SETTINGS, values, timeout=60)
    return values


def get_json_setting(key: str, default: Any = None) -> Any:
    item = _load_runtime_settings().get(key)
    if not item:
        return default
    value = item.get("value")
    return default if value is None else value


def set_json_setting(key: str, value: Any, user=None) -> PlatformSetting:
    setting, _created = PlatformSetting.objects.update_or_create(
        key=key,
        defaults={
            "value": value,
            "updated_by": user,
        },
    )
    invalidate_runtime_settings_cache()
    return setting


def get_secret_setting(key: str, env_name: str = "") -> tuple[str, str]:
    item = _load_runtime_settings().get(key)
    if item and item.get("encrypted_value"):
        decrypted = decrypt_secret(item["encrypted_value"])
        if decrypted:
            return decrypted, "database"

    if env_name:
        environment_value = os.getenv(env_name, "").strip()
        if environment_value:
            return environment_value, "environment"

    return "", "missing"


def set_secret_setting(key: str, value: str, user=None) -> PlatformSetting:
    setting, _created = PlatformSetting.objects.update_or_create(
        key=key,
        defaults={
            "encrypted_value": encrypt_secret(value),
            "updated_by": user,
        },
    )
    invalidate_runtime_settings_cache()
    return setting


def clear_secret_setting(key: str, user=None) -> None:
    setting, _created = PlatformSetting.objects.get_or_create(key=key)
    setting.encrypted_value = ""
    setting.updated_by = user
    setting.save(update_fields=["encrypted_value", "updated_by", "updated_at"])
    invalidate_runtime_settings_cache()


def get_runtime_cors_origins() -> list[str]:
    database_value = get_json_setting(SETTING_CORS_ORIGINS, None)
    if isinstance(database_value, list):
        return sorted({str(item).strip() for item in database_value if str(item).strip()})
    return sorted({str(item).strip() for item in getattr(settings, "CORS_ALLOWED_ORIGINS", []) if str(item).strip()})


def get_gemini_credentials() -> tuple[str, str, str]:
    api_key, source = get_secret_setting(SETTING_GEMINI_API_KEY, "GEMINI_API_KEY")
    model = str(
        get_json_setting(
            SETTING_GEMINI_MODEL,
            os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        )
        or "gemini-2.5-flash"
    ).strip()
    return api_key, model, source


def get_backup_retention_count() -> int:
    raw = get_json_setting(SETTING_BACKUP_RETENTION, 10)
    try:
        return min(max(int(raw), 1), 50)
    except (TypeError, ValueError):
        return 10


def get_client_ip(request) -> str | None:
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR", "") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


def record_audit_event(
    *,
    actor=None,
    request=None,
    category: str,
    action: str,
    summary: str,
    target_type: str = "",
    target_id: Any = "",
    target_label: str = "",
    details: dict[str, Any] | None = None,
) -> PlatformAuditLog | None:
    try:
        return PlatformAuditLog.objects.create(
            actor=actor,
            category=str(category)[:80],
            action=str(action)[:120],
            summary=str(summary)[:500],
            target_type=str(target_type)[:80],
            target_id=str(target_id or "")[:120],
            target_label=str(target_label or "")[:255],
            details=details or {},
            ip_address=get_client_ip(request) if request is not None else None,
        )
    except Exception:
        # Auditing must never break the primary operation.
        return None
