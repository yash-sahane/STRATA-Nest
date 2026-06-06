from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import Retrospective, Sprint
from .serializers import RetrospectiveSerializer, SprintSerializer


class SprintViewSet(WorkspaceScopedModelViewSet):
    queryset = Sprint.objects.all()
    serializer_class = SprintSerializer

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            created_by=user, created_by_name=getattr(user, "name", "") or ""
        )


class RetrospectiveViewSet(WorkspaceScopedModelViewSet):
    queryset = Retrospective.objects.all()
    serializer_class = RetrospectiveSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
