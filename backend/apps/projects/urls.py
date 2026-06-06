from rest_framework.routers import DefaultRouter

from .viewsets import ProjectViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"projects", ProjectViewSet, basename="projects")

urlpatterns = router.urls
