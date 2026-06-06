from rest_framework.routers import DefaultRouter

from .viewsets import EpicViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"epics", EpicViewSet, basename="epics")

urlpatterns = router.urls
