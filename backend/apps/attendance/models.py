from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

ATTENDANCE_STATUS = [
    ("PRESENT", "Present"),
    ("LATE", "Late"),
    ("EARLY_LEAVE", "Early Leave"),
    ("ABSENT", "Absent"),
    ("LEAVE", "Leave"),
    ("HALF_DAY", "Half Day"),
]


class Attendance(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace",
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    date = models.DateField()
    check_in_time = models.DateTimeField()
    check_out_time = models.DateTimeField(null=True, blank=True)
    work_hours = models.FloatField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=ATTENDANCE_STATUS, default="PRESENT"
    )
    late_minutes = models.IntegerField(default=0)
    location = models.CharField(max_length=255, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_weekend = models.BooleanField(default=False)
    is_holiday = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_attendance",
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")

    REALTIME_COLLECTION = "attendance"

    class Meta(TimestampedModel.Meta):
        unique_together = [("workspace", "user", "date")]
        indexes = [models.Index(fields=["workspace", "date"])]


class Holiday(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="holidays"
    )
    name = models.CharField(max_length=255)
    date = models.DateField()
    is_optional = models.BooleanField(default=False)
    description = models.TextField(blank=True, default="")

    REALTIME_COLLECTION = "holidays"

    class Meta(TimestampedModel.Meta):
        unique_together = [("workspace", "date", "name")]
