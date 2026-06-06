from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

TIME_ENTRY_STATUS = [
    ("PENDING", "Pending"),
    ("APPROVED", "Approved"),
    ("REJECTED", "Rejected"),
]
TIME_ENTRY_TYPE = [("MANUAL", "Manual"), ("TIMER", "Timer"), ("POMODORO", "Pomodoro")]


class TimeEntry(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="time_entries"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="time_entries"
    )
    user_name = models.CharField(max_length=255)
    user_email = models.EmailField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_time_entries",
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")
    task_id = models.CharField(max_length=36, blank=True, default="")
    task_title = models.CharField(max_length=500, blank=True, default="")
    task_hierarchy_id = models.CharField(max_length=100, blank=True, default="")
    project_id = models.CharField(max_length=36, blank=True, default="")
    project_name = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration = models.PositiveIntegerField(default=0)  # minutes
    is_billable = models.BooleanField(default=False)
    billable_rate = models.FloatField(null=True, blank=True)
    type = models.CharField(max_length=20, choices=TIME_ENTRY_TYPE, default="MANUAL")
    status = models.CharField(
        max_length=20, choices=TIME_ENTRY_STATUS, default="PENDING"
    )
    approved_by = models.CharField(max_length=36, blank=True, default="")
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list)

    REALTIME_COLLECTION = "time_entries"

    class Meta(TimestampedModel.Meta):
        indexes = [
            models.Index(fields=["workspace", "user", "-start_time"]),
            models.Index(fields=["task_id"]),
        ]


class ActiveTimer(TimestampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="active_timer"
    )
    task_id = models.CharField(max_length=36, blank=True, default="")
    task_title = models.CharField(max_length=500, blank=True, default="")
    task_hierarchy_id = models.CharField(max_length=100, blank=True, default="")
    project_id = models.CharField(max_length=36, blank=True, default="")
    description = models.TextField(blank=True, default="")
    start_time = models.DateTimeField()
    is_paused = models.BooleanField(default=False)
    paused_at = models.DateTimeField(null=True, blank=True)
    total_paused_time = models.PositiveIntegerField(default=0)
    type = models.CharField(max_length=20, default="TIMER")
    pomodoro_settings = models.JSONField(null=True, blank=True)

    REALTIME_COLLECTION = "active_timers"
