from rest_framework.routers import DefaultRouter

from .viewsets import LeaveBalanceViewSet, LeaveRequestViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"leave_requests", LeaveRequestViewSet, basename="leave_requests")
router.register(r"leave_balances", LeaveBalanceViewSet, basename="leave_balances")

urlpatterns = router.urls
