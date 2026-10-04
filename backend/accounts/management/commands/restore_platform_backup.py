import subprocess

from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from accounts.models import PlatformBackup
from accounts.platform_backups import (
    backup_path,
    create_database_backup,
    database_command_environment,
    database_connection_args,
    find_postgres_binary,
    validate_custom_backup,
)


class Command(BaseCommand):
    help = (
        "Restore a validated platform backup. Stop the Django server first. "
        "A pre-restore backup is created automatically."
    )

    def add_arguments(self, parser):
        parser.add_argument("--backup-id", type=int, required=True)
        parser.add_argument("--confirm", type=str, required=True)

    def handle(self, *args, **options):
        try:
            item = PlatformBackup.objects.get(id=options["backup_id"])
        except PlatformBackup.DoesNotExist as exc:
            raise CommandError("Backup record not found.") from exc

        if options["confirm"] != item.filename:
            raise CommandError(f"Confirmation must exactly match: {item.filename}")

        path = backup_path(item.filename)
        valid, message = validate_custom_backup(path)
        if not valid:
            raise CommandError(message)

        pg_restore = find_postgres_binary("pg_restore")
        if not pg_restore:
            raise CommandError("pg_restore was not found. Configure PATH or PG_BIN.")

        self.stdout.write("Creating an automatic pre-restore backup...")
        pre_restore = create_database_backup(source=PlatformBackup.Source.PRE_RESTORE, prefix="pre_restore")
        self.stdout.write(self.style.SUCCESS(f"Pre-restore backup: {pre_restore.filename}"))

        connection_args, database_name = database_connection_args()
        for db_connection in connections.all():
            db_connection.close()

        command = [
            pg_restore,
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
            *connection_args,
            "--dbname",
            database_name,
            str(path),
        ]
        self.stdout.write(f"Restoring {item.filename}...")
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            env=database_command_environment(),
        )
        if result.returncode != 0:
            raise CommandError((result.stderr or result.stdout or "Restore failed.").strip())

        self.stdout.write(self.style.SUCCESS("Database restore completed successfully."))
        self.stdout.write("Run migrations and restart Django before opening the website:")
        self.stdout.write("  python manage.py migrate")
        self.stdout.write("  python manage.py runserver")
