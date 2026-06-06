from rest_framework.routers import DefaultRouter

from .viewsets import (
    KanbanColumnViewSet,
    LabelViewSet,
    TaskCommentViewSet,
    TaskViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register(r"tasks", TaskViewSet, basename="tasks")
router.register(r"task_comments", TaskCommentViewSet, basename="task_comments")
router.register(r"kanban_columns", KanbanColumnViewSet, basename="kanban_columns")
router.register(r"labels", LabelViewSet, basename="labels")

urlpatterns = router.urls
