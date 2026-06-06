from rest_framework.routers import DefaultRouter

from .viewsets import ClientRequirementViewSet, FunctionalRequirementViewSet

router = DefaultRouter(trailing_slash=True)
router.register(
    r"client_requirements", ClientRequirementViewSet, basename="client_requirements"
)
router.register(
    r"functional_requirements",
    FunctionalRequirementViewSet,
    basename="functional_requirements",
)

urlpatterns = router.urls
