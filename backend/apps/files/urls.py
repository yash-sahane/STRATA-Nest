from rest_framework.routers import DefaultRouter

from .viewsets import UploadedFileViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"files", UploadedFileViewSet, basename="files")

urlpatterns = router.urls
