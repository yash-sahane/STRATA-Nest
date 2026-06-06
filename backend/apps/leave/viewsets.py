from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import LeaveBalance, LeaveRequest
from .serializers import LeaveBalanceSerializer, LeaveRequestSerializer


class LeaveRequestViewSet(WorkspaceScopedModelViewSet):
    queryset = LeaveRequest.objects.all()
    serializer_class = LeaveRequestSerializer

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            user=user,
            created_by=user,
            created_by_name=getattr(user, "name", "") or "",
        )


class LeaveBalanceViewSet(WorkspaceScopedModelViewSet):
    queryset = LeaveBalance.objects.all()
    serializer_class = LeaveBalanceSerializer
