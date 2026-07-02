from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimestampedModel

LEAVE_TYPE = [
    ("PAID", "Paid"),
    ("UNPAID", "Unpaid"),
    ("CASUAL", "Casual Leave"),
    ("SICK", "Sick Leave"),
    ("ANNUAL", "Annual Leave"),
    ("MATERNITY", "Maternity Leave"),
    ("PATERNITY", "Paternity Leave"),
    ("BEREAVEMENT", "Bereavement Leave"),
    ("HALF_DAY", "Half Day"),
    ("COMP_OFF", "Comp Off"),
]
LEAVE_STATUS = [
    ("PENDING", "Pending"),
    ("APPROVED", "Approved"),
    ("REJECTED", "Rejected"),
    ("CANCELLED", "Cancelled"),
]


class LeaveRequest(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="leave_requests"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_requests",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_leave_requests",
    )
    created_by_name = models.CharField(max_length=255, blank=True, default="")
    type = models.CharField(max_length=20, choices=LEAVE_TYPE)
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=LEAVE_STATUS, default="PENDING")
    approved_by = models.CharField(max_length=36, blank=True, default="")
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default="")
    days_count = models.FloatField(default=0)

    REALTIME_COLLECTION = "leave_requests"


class LeaveBalance(TimestampedModel):
    workspace = models.ForeignKey(
        "workspaces.Workspace", on_delete=models.CASCADE, related_name="leave_balances"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_balances",
    )
    year = models.PositiveIntegerField()
    paid_leave = models.FloatField(default=0)
    unpaid_leave = models.FloatField(default=0)
    half_day = models.FloatField(default=0)
    comp_off = models.FloatField(default=0)

    REALTIME_COLLECTION = "leave_balances"

    class Meta(TimestampedModel.Meta):
        unique_together = [("workspace", "user", "year")]
