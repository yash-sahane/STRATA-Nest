from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import ActiveTimer, TimeEntry
from .serializers import ActiveTimerSerializer, TimeEntrySerializer


class TimeEntryViewSet(WorkspaceScopedModelViewSet):
    queryset = TimeEntry.objects.all()
    serializer_class = TimeEntrySerializer

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            user=user,
            user_name=getattr(user, "name", "") or user.email,
            user_email=user.email,
            created_by=user,
            created_by_name=getattr(user, "name", "") or "",
        )


class ActiveTimerViewSet(WorkspaceScopedModelViewSet):
    queryset = ActiveTimer.objects.all()
    serializer_class = ActiveTimerSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
