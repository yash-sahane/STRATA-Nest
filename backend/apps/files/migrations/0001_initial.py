# Generated initial migration for apps.files (hand-written; matches models.py).
from django.conf import settings
from django.db import migrations, models

import apps.core.models
import apps.files.models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UploadedFile",
            fields=[
                (
                    "id",
                    models.CharField(
                        default=apps.core.models.generate_native_id,
                        editable=False,
                        max_length=36,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=255)),
                (
                    "file",
                    models.FileField(
                        max_length=500, upload_to=apps.files.models._upload_path
                    ),
                ),
                ("mime_type", models.CharField(blank=True, default="", max_length=128)),
                ("size", models.BigIntegerField(default=0)),
                (
                    "workspace_id",
                    models.CharField(blank=True, default="", max_length=36),
                ),
                ("project_id", models.CharField(blank=True, default="", max_length=36)),
                (
                    "bucket",
                    models.CharField(blank=True, default="default", max_length=64),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=models.deletion.SET_NULL,
                        related_name="uploaded_files",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"abstract": False, "ordering": ["-created_at"]},
        ),
    ]
