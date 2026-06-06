"""User directory routes mounted under `/api/v1/`."""

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import InviteUserView
from .viewsets import UserViewSet

router = DefaultRouter(trailing_slash=True)
router.register(r"users", UserViewSet, basename="users")

urlpatterns = [
    # Admin-driven invitation flow.
    # Must come BEFORE the router so it isn't shadowed by the detail route.
    path("users/invite/", InviteUserView.as_view(), name="users-invite"),
] + router.urls
