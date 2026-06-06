from rest_framework.routers import DefaultRouter

from .viewsets import ActivityLogViewSet, SavedSearchViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"activity_logs", ActivityLogViewSet, basename="activity_logs")
router.register(r"saved_searches", SavedSearchViewSet, basename="saved_searches")

urlpatterns = router.urls
