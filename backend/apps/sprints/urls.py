from rest_framework.routers import DefaultRouter

from .viewsets import RetrospectiveViewSet, SprintViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"sprints", SprintViewSet, basename="sprints")
router.register(r"retrospectives", RetrospectiveViewSet, basename="retrospectives")

urlpatterns = router.urls
