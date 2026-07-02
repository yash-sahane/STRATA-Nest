from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import LeaveBalance, LeaveRequest


class LeaveRequestSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id", read_only=True)
    createdBy = serializers.CharField(source="created_by_id", read_only=True)
    createdByName = serializers.CharField(
        source="created_by_name", required=False, allow_blank=True, read_only=True
    )
    startDate = serializers.DateField(source="start_date")
    endDate = serializers.DateField(source="end_date")
    approvedBy = serializers.CharField(
        source="approved_by", required=False, allow_blank=True
    )
    approvedAt = serializers.DateTimeField(
        source="approved_at", required=False, allow_null=True
    )
    rejectionReason = serializers.CharField(
        source="rejection_reason", required=False, allow_blank=True
    )
    daysCount = serializers.FloatField(source="days_count")

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "createdBy",
            "createdByName",
            "type",
            "startDate",
            "endDate",
            "reason",
            "status",
            "approvedBy",
            "approvedAt",
            "rejectionReason",
            "daysCount",
        ]


class LeaveBalanceSerializer(NativeModelSerializer):
    workspaceId = serializers.CharField(source="workspace_id")
    userId = serializers.CharField(source="user_id")
    paidLeave = serializers.FloatField(source="paid_leave")
    unpaidLeave = serializers.FloatField(source="unpaid_leave")
    halfDay = serializers.FloatField(source="half_day")
    compOff = serializers.FloatField(source="comp_off")

    class Meta:
        model = LeaveBalance
        fields = [
            "id",
            "created_at",
            "updated_at",
            "workspaceId",
            "userId",
            "year",
            "paidLeave",
            "unpaidLeave",
            "halfDay",
            "compOff",
        ]
