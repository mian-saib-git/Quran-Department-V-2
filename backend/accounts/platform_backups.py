import glob
import hashlib
import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterable

from django.conf import settings
from django.utils import timezone

from .models import PlatformBackup
from .platform_runtime import get_backup_retention_count


BACKUP_EXTENSIONS = {".dump", ".backup"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


def backup_root() -> Path:
    root = Path(settings.BASE_DIR) / "platform_backups"
    root.mkdir(parents=True, exist_ok=True)
    return root


def backup_path(filename: str) -> Path:
    safe_name = Path(str(filename or "")).name
    if not safe_name or safe_name != filename:
        raise ValueError("Invalid backup filename.")
    return backup_root() / safe_name


def _candidate_binary_paths(binary: str) -> Iterable[str]:
    configured = str(os.getenv("PG_BIN", "") or "").strip()
    if configured:
        yield str(Path(configured) / binary)
        yield str(Path(configured) / f"{binary}.exe")

    located = shutil.which(binary) or shutil.which(f"{binary}.exe")
    if located:
        yield located

    if os.name == "nt":
        patterns = [
            rf"C:\Program Files\PostgreSQL\*\bin\{binary}.exe",
            rf"C:\Program Files (x86)\PostgreSQL\*\bin\{binary}.exe",
        ]
        for pattern in patterns:
            for item in sorted(glob.glob(pattern), reverse=True):
                yield item
    else:
        for prefix in ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]:
            yield str(Path(prefix) / binary)


def find_postgres_binary(binary: str) -> str | None:
    seen = set()
    for candidate in _candidate_binary_paths(binary):
        normalized = os.path.normcase(os.path.abspath(candidate))
        if normalized in seen:
            continue
        seen.add(normalized)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def postgres_command_version(binary: str) -> str:
    executable = find_postgres_binary(binary)
    if not executable:
        return ""
    try:
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return (result.stdout or result.stderr or "").strip()
    except Exception:
        return ""


def database_command_environment() -> dict[str, str]:
    environment = os.environ.copy()
    password = str(settings.DATABASES["default"].get("PASSWORD", "") or "")
    if password:
        environment["PGPASSWORD"] = password
    return environment


def database_connection_args() -> tuple[list[str], str]:
    config = settings.DATABASES["default"]
    database_name = str(config.get("NAME", "") or "")
    args = []
    host = str(config.get("HOST", "") or "")
    port = str(config.get("PORT", "") or "")
    user = str(config.get("USER", "") or "")
    if host:
        args.extend(["--host", host])
    if port:
        args.extend(["--port", port])
    if user:
        args.extend(["--username", user])
    return args, database_name


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_payload(item: PlatformBackup) -> dict:
    path = backup_path(item.filename)
    exists = path.exists()
    return {
        "id": item.id,
        "filename": item.filename,
        "original_filename": item.original_filename,
        "source": item.source,
        "status": item.status,
        "size_bytes": item.size_bytes,
        "checksum_sha256": item.checksum_sha256,
        "database_name": item.database_name,
        "postgres_version": item.postgres_version,
        "validation_message": item.validation_message,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "created_by": (
            {
                "id": item.created_by_id,
                "username": item.created_by.username,
                "full_name": item.created_by.get_full_name() or item.created_by.username,
            }
            if item.created_by_id and item.created_by
            else None
        ),
        "file_exists": exists,
        "download_ready": bool(exists and item.status in {PlatformBackup.Status.READY, PlatformBackup.Status.VALIDATED}),
    }


def validate_custom_backup(path: Path) -> tuple[bool, str]:
    if not path.exists() or path.stat().st_size <= 0:
        return False, "The backup file is empty."

    with path.open("rb") as source:
        signature = source.read(5)
    if signature != b"PGDMP":
        return False, "Only PostgreSQL custom-format backups are accepted."

    pg_restore = find_postgres_binary("pg_restore")
    if not pg_restore:
        return False, (
            "pg_restore was not found. Add PostgreSQL bin to PATH or set PG_BIN "
            "before uploading backups."
        )

    result = subprocess.run(
        [pg_restore, "--list", str(path)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
        env=database_command_environment(),
    )
    if result.returncode != 0:
        return False, (result.stderr or result.stdout or "Backup validation failed.").strip()[:1000]
    return True, "PostgreSQL custom-format backup validated successfully."


def create_database_backup(actor=None, *, source=PlatformBackup.Source.GENERATED, prefix="ivs_backup") -> PlatformBackup:
    pg_dump = find_postgres_binary("pg_dump")
    if not pg_dump:
        raise RuntimeError(
            "pg_dump was not found. Add PostgreSQL bin to PATH or set the PG_BIN environment variable."
        )

    connection_args, database_name = database_connection_args()
    timestamp = timezone.localtime().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{prefix}_{timestamp}.dump"
    path = backup_path(filename)

    command = [
        pg_dump,
        "--format=custom",
        "--compress=6",
        "--no-owner",
        "--no-privileges",
        "--file",
        str(path),
        *connection_args,
        database_name,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=60 * 30,
        check=False,
        env=database_command_environment(),
    )

    if result.returncode != 0 or not path.exists():
        if path.exists():
            path.unlink(missing_ok=True)
        raise RuntimeError((result.stderr or result.stdout or "Database backup failed.").strip()[:1200])

    valid, validation_message = validate_custom_backup(path)
    if not valid:
        path.unlink(missing_ok=True)
        raise RuntimeError(validation_message)

    item = PlatformBackup.objects.create(
        filename=filename,
        original_filename=filename,
        source=source,
        status=PlatformBackup.Status.VALIDATED,
        size_bytes=path.stat().st_size,
        checksum_sha256=sha256_file(path),
        database_name=database_name,
        postgres_version=postgres_command_version("pg_dump"),
        validation_message=validation_message,
        created_by=actor,
    )
    enforce_backup_retention()
    return item


def save_uploaded_backup(uploaded_file, actor=None) -> PlatformBackup:
    original_name = Path(str(getattr(uploaded_file, "name", "") or "backup.dump")).name
    suffix = Path(original_name).suffix.lower()
    if suffix not in BACKUP_EXTENSIONS:
        raise ValueError("Upload a .dump or .backup PostgreSQL custom-format file.")

    size = int(getattr(uploaded_file, "size", 0) or 0)
    if size <= 0:
        raise ValueError("The selected backup file is empty.")
    if size > MAX_UPLOAD_BYTES:
        raise ValueError("The backup file is larger than the 2 GB upload limit.")

    timestamp = timezone.localtime().strftime("%Y%m%d_%H%M%S_%f")
    base = "".join(char for char in Path(original_name).stem if char.isalnum() or char in {"-", "_"})[:80]
    filename = f"uploaded_{timestamp}_{base or 'backup'}.dump"
    path = backup_path(filename)

    try:
        with path.open("wb") as destination:
            for chunk in uploaded_file.chunks():
                destination.write(chunk)

        valid, validation_message = validate_custom_backup(path)
        if not valid:
            raise ValueError(validation_message)

        item = PlatformBackup.objects.create(
            filename=filename,
            original_filename=original_name,
            source=PlatformBackup.Source.UPLOADED,
            status=PlatformBackup.Status.VALIDATED,
            size_bytes=path.stat().st_size,
            checksum_sha256=sha256_file(path),
            database_name=str(settings.DATABASES["default"].get("NAME", "") or ""),
            postgres_version=postgres_command_version("pg_restore"),
            validation_message=validation_message,
            created_by=actor,
        )
        enforce_backup_retention()
        return item
    except Exception:
        path.unlink(missing_ok=True)
        raise


def delete_backup_file(item: PlatformBackup) -> None:
    path = backup_path(item.filename)
    path.unlink(missing_ok=True)
    item.delete()


def enforce_backup_retention() -> None:
    retention = get_backup_retention_count()
    generated = PlatformBackup.objects.filter(source=PlatformBackup.Source.GENERATED).order_by("-created_at", "-id")
    for item in generated[retention:]:
        try:
            delete_backup_file(item)
        except Exception:
            continue
