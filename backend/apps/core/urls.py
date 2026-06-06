from django.urls import path

from .bulk_views import BulkSaveView

urlpatterns = [
    path("bulk-save/", BulkSaveView.as_view(), name="bulk-save"),
]
