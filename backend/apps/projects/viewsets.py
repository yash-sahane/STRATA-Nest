from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import Project
from .serializers import ProjectSerializer


class ProjectViewSet(WorkspaceScopedModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            owner=user,
            created_by=user,
            created_by_name=getattr(user, "name", "") or "",
        )
