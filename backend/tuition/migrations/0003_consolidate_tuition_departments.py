from django.db import migrations


TUITION_FEATURE_PREFIXES = (
    "tuition_",
    "tab_tuition_",
)


def consolidate_tuition_departments(
    apps,
    schema_editor,
):
    Department = apps.get_model(
        "accounts",
        "Department",
    )

    DepartmentFeature = apps.get_model(
        "accounts",
        "DepartmentFeature",
    )

    UserDepartmentRole = apps.get_model(
        "accounts",
        "UserDepartmentRole",
    )

    TuitionDepartmentConfig = apps.get_model(
        "tuition",
        "TuitionDepartmentConfig",
    )

    institution_ids = list(
        Department.objects
        .filter(
            department_type="tuition",
        )
        .values_list(
            "institution_id",
            flat=True,
        )
        .distinct()
    )

    for institution_id in institution_ids:
        departments = list(
            Department.objects
            .filter(
                institution_id=institution_id,
                department_type="tuition",
            )
            .order_by("id")
        )

        if len(departments) <= 1:
            continue

        target = next(
            (
                item
                for item in departments
                if item.code
                == "tuition-department"
            ),
            departments[0],
        )

        duplicates = [
            item
            for item in departments
            if item.id != target.id
        ]

        for source in duplicates:
            # Copy feature states into the
            # canonical SaaS department.
            source_feature_settings = (
                DepartmentFeature.objects
                .filter(
                    department_id=source.id,
                )
                .select_related("feature")
            )

            for source_setting in (
                source_feature_settings
            ):
                target_setting, created = (
                    DepartmentFeature.objects
                    .get_or_create(
                        department_id=target.id,
                        feature_id=(
                            source_setting.feature_id
                        ),
                        defaults={
                            "is_enabled":
                                source_setting.is_enabled,
                        },
                    )
                )

                feature_key = (
                    source_setting.feature.key
                )

                if (
                    created
                    or feature_key.startswith(
                        TUITION_FEATURE_PREFIXES
                    )
                ):
                    target_setting.is_enabled = (
                        source_setting.is_enabled
                    )

                    target_setting.save(
                        update_fields=[
                            "is_enabled",
                        ]
                    )

            # Merge department role assignments
            # without violating their uniqueness
            # constraint.
            role_links = list(
                UserDepartmentRole.objects
                .filter(
                    department_id=source.id,
                )
            )

            for role_link in role_links:
                existing = (
                    UserDepartmentRole.objects
                    .filter(
                        user_id=role_link.user_id,
                        institution_id=(
                            role_link.institution_id
                        ),
                        department_id=target.id,
                        role=role_link.role,
                    )
                    .first()
                )

                if existing:
                    if (
                        role_link.is_active
                        and not existing.is_active
                    ):
                        existing.is_active = True

                        existing.save(
                            update_fields=[
                                "is_active",
                            ]
                        )

                    role_link.delete()

                else:
                    role_link.department_id = (
                        target.id
                    )

                    role_link.save(
                        update_fields=[
                            "department",
                        ]
                    )

            # Move or merge the one-to-one
            # Tuition configuration.
            source_config = (
                TuitionDepartmentConfig.objects
                .filter(
                    department_id=source.id,
                )
                .first()
            )

            target_config = (
                TuitionDepartmentConfig.objects
                .filter(
                    department_id=target.id,
                )
                .first()
            )

            if source_config:
                if target_config:
                    for field_name in [
                        "default_timezone",
                        "operating_start",
                        "operating_end",
                        "class_duration_minutes",
                        "operating_weekdays",
                        "allow_custom_start_times",
                    ]:
                        setattr(
                            target_config,
                            field_name,
                            getattr(
                                source_config,
                                field_name,
                            ),
                        )

                    target_config.save()

                    source_config.delete()

                else:
                    (
                        TuitionDepartmentConfig
                        .objects
                        .filter(
                            id=source_config.id,
                        )
                        .update(
                            department_id=target.id,
                        )
                    )

            # Move every other model that has
            # a ForeignKey named "department".
            excluded_models = {
                "accounts.departmentfeature",
                "accounts.userdepartmentrole",
                (
                    "tuition."
                    "tuitiondepartmentconfig"
                ),
            }

            for model in apps.get_models():
                model_label = (
                    model._meta.label_lower
                )

                if model_label in excluded_models:
                    continue

                try:
                    department_field = (
                        model._meta.get_field(
                            "department"
                        )
                    )
                except Exception:
                    continue

                related_model = getattr(
                    department_field.remote_field,
                    "model",
                    None,
                )

                if (
                    related_model is None
                    or related_model
                    ._meta
                    .label_lower
                    != "accounts.department"
                ):
                    continue

                (
                    model.objects
                    .filter(
                        department_id=source.id,
                    )
                    .update(
                        department_id=target.id,
                    )
                )

            source.delete()

        update_fields = []

        if target.name != "Tuition Department":
            target.name = "Tuition Department"
            update_fields.append("name")

        if target.department_type != "tuition":
            target.department_type = "tuition"
            update_fields.append(
                "department_type"
            )

        if not target.is_active:
            target.is_active = True
            update_fields.append("is_active")

        if update_fields:
            target.save(
                update_fields=update_fields
            )


def reverse_consolidation(
    apps,
    schema_editor,
):
    # Deliberately irreversible because the
    # duplicate department contained no unique
    # user or academic data.
    pass


class Migration(migrations.Migration):

    dependencies = [
        (
            "tuition",
            "0002_seed_tuition_foundation",
        ),
    ]

    operations = [
        migrations.RunPython(
            consolidate_tuition_departments,
            reverse_consolidation,
        ),
    ]
