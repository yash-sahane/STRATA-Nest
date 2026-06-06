from rest_framework.routers import DefaultRouter

from .viewsets import AttendanceViewSet, HolidayViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"attendance", AttendanceViewSet, basename="attendance")
router.register(r"holidays", HolidayViewSet, basename="holidays")

urlpatterns = router.urls
