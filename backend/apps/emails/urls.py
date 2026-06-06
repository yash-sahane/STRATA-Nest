from django.urls import path

from .views import (
    SendInvitationEmailView,
    SendLeaveEmailView,
    SendNotificationEmailView,
)

urlpatterns = [
    path(
        "email/send-invitation/",
        SendInvitationEmailView.as_view(),
        name="email-send-invitation",
    ),
    path("email/send-leave/", SendLeaveEmailView.as_view(), name="email-send-leave"),
    path(
        "email/send-notification/",
        SendNotificationEmailView.as_view(),
        name="email-send-notification",
    ),
]
