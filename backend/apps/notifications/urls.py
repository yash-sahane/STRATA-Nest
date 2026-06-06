from rest_framework.routers import DefaultRouter

from .viewsets import NotificationViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"notifications", NotificationViewSet, basename="notifications")

urlpatterns = router.urls
