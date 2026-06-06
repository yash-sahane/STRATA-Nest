from __future__ import annotations

from apps.core.viewsets import WorkspaceScopedModelViewSet

from .models import KanbanColumn, Label, Task, TaskComment
from .serializers import (
    KanbanColumnSerializer,
    LabelSerializer,
    TaskCommentSerializer,
    TaskSerializer,
)


class TaskViewSet(WorkspaceScopedModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(
            created_by=user, created_by_name=getattr(user, "name", "") or ""
        )


class TaskCommentViewSet(WorkspaceScopedModelViewSet):
    queryset = TaskComment.objects.all()
    serializer_class = TaskCommentSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class KanbanColumnViewSet(WorkspaceScopedModelViewSet):
    queryset = KanbanColumn.objects.all()
    serializer_class = KanbanColumnSerializer


class LabelViewSet(WorkspaceScopedModelViewSet):
    queryset = Label.objects.all()
    serializer_class = LabelSerializer
