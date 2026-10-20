"""Preserve existing user display names before any account-login hard deletion.

This is intentionally a data-only migration. It does not delete users, teacher
profiles, attendance, lesson records or reports, and does not alter FK links.
Uses the same display-name fallback as Django's AbstractUser.get_full_name():
trim(first_name + ' ' + last_name), or username when neither is set.
"""
from django.db import migrations


# Every (table, foreign-key) pair is a nullable user reference from migration 0024.
ACTOR_TABLES = (
    ("academy_attendance", "marked_by_id"),
    ("academy_lesson", "created_by_id"),
    ("academy_dailylessonreport", "created_by_id"),
    ("academy_monthlylessonsummary", "created_by_id"),
    ("academy_monthlylessonplan", "created_by_id"),
)


def backfill_historical_names(apps, schema_editor):
    # The schema changes in 0024 make these text columns available.
    # All identifiers below are hard-coded by this migration, not user input.
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE academy_teacherprofile AS p
            SET historical_name = LEFT(
                COALESCE(
                    NULLIF(BTRIM(CONCAT_WS(' ',
                        NULLIF(BTRIM(u.first_name), ''),
                        NULLIF(BTRIM(u.last_name), '')
                    )), ''),
                    NULLIF(BTRIM(u.username), ''),
                    'User #' || u.id::text
                ), 255
            )
            FROM accounts_user AS u
            WHERE p.user_id = u.id
              AND (p.historical_name IS NULL OR BTRIM(p.historical_name) = '')
            """
        )

        for table, actor_fk in ACTOR_TABLES:
            cursor.execute(
                f"""
                UPDATE {table} AS evidence
                SET actor_name_snapshot = LEFT(
                    COALESCE(
                        NULLIF(BTRIM(CONCAT_WS(' ',
                            NULLIF(BTRIM(u.first_name), ''),
                            NULLIF(BTRIM(u.last_name), '')
                        )), ''),
                        NULLIF(BTRIM(u.username), ''),
                        'User #' || u.id::text
                    ), 255
                )
                FROM accounts_user AS u
                WHERE evidence.{actor_fk} = u.id
                  AND (evidence.actor_name_snapshot IS NULL
                       OR BTRIM(evidence.actor_name_snapshot) = '')
                """
            )


class Migration(migrations.Migration):
    dependencies = [
        ("academy", "0024_teacher_login_history_detach"),
    ]

    # SQL UPDATEs remain atomic under PostgreSQL's default Django migration
    # transaction. A reverse data erase would destroy history, so do nothing.
    operations = [
        migrations.RunPython(backfill_historical_names, migrations.RunPython.noop),
    ]
