from rest_framework.routers import DefaultRouter

from .viewsets import ActiveTimerViewSet, TimeEntryViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"time_entries", TimeEntryViewSet, basename="time_entries")
router.register(r"active_timers", ActiveTimerViewSet, basename="active_timers")

urlpatterns = router.urls
