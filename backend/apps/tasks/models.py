from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

TASK_STATUS = [
    ("BACKLOG", "Backlog"),
    ("TODO", "Todo"),
    ("IN_PROGRESS", "In Progress"),
    ("REVIEW", "Review"),
    ("DONE", "Done"),
]
TASK_PRIORITY = [
    ("LOW", "Low"),
    ("MEDIUM", "Medium"),
    ("HIGH", "High"),
    ("CRITICAL", "Critical"),
]


class Task(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="tasks"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="tasks"
    )
    hierarchy_id = models.CharField(max_length=100)
    sprint_id = models.CharField(max_length=36, blank=True, default="")
    epic_id = models.CharField(max_length=36, blank=True, default="")
    functional_requirement_id = models.CharField(max_length=36, blank=True, default="")
    parent_task_id = models.CharField(max_length=36, blank=True, default="")
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=TASK_STATUS, default="BACKLOG")
    priority = models.CharField(max_length=20, choices=TASK_PRIORITY, default="MEDIUM")
    assignee_ids = models.JSONField(default=list)
    assigned_by = models.CharField(max_length=36, blank=True, default="")
    assigned_by_name = models.CharField(max_length=255, blank=True, default="")
    assigned_to = models.JSONField(default=list)
    assigned_to_names = models.JSONField(default=list)
    watcher_ids = models.JSONField(default=list)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_tasks"
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")
    due_date = models.DateTimeField(null=True, blank=True)
    estimated_hours = models.FloatField(null=True, blank=True)
    actual_hours = models.FloatField(null=True, blank=True)
    labels = models.JSONField(default=list)
    attachments = models.JSONField(default=list)
    custom_fields = models.JSONField(default=dict)
    position = models.FloatField(default=0)
    blocked_by = models.JSONField(default=list)
    blocks = models.JSONField(default=list)

    REALTIME_COLLECTION = "tasks"

    class Meta(TimestampedModel.Meta):
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["sprint_id"]),
            models.Index(fields=["hierarchy_id"]),
        ]


class TaskComment(TimestampedModel):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="task_comments"
    )
    content = models.TextField()
    mentions = models.JSONField(default=list)
    attachments = models.JSONField(default=list)

    REALTIME_COLLECTION = "task_comments"


class KanbanColumn(TimestampedModel):
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="kanban_columns"
    )
    name = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=TASK_STATUS)
    wip_limit = models.PositiveIntegerField(null=True, blank=True)
    position = models.FloatField(default=0)
    color = models.CharField(max_length=50, blank=True, default="")

    REALTIME_COLLECTION = "kanban_columns"


class Label(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="labels"
    )
    project = models.ForeignKey(
        "projects.Project",
        on_delete=models.CASCADE,
        related_name="labels",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=50)
    description = models.TextField(blank=True, default="")

    REALTIME_COLLECTION = "labels"
