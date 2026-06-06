from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

api_v1 = [
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.accounts.directory_urls")),  # /users/
    path("", include("apps.core.urls")),  # /bulk-save/
    path("", include("apps.workspaces.urls")),
    path("", include("apps.projects.urls")),
    path("", include("apps.requirements.urls")),
    path("", include("apps.epics.urls")),
    path("", include("apps.sprints.urls")),
    path("", include("apps.tasks.urls")),
    path("", include("apps.attendance.urls")),
    path("", include("apps.leave.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.time_tracking.urls")),
    path("", include("apps.integrations.urls")),
    path("", include("apps.activity.urls")),
    path("", include("apps.files.urls")),
    path("", include("apps.emails.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger"
    ),
]
