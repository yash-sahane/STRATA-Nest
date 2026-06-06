"""Map DRF exceptions into the native API error shape."""

from __future__ import annotations

from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None
    detail = response.data
    message = (
        detail.get("detail")
        if isinstance(detail, dict) and "detail" in detail
        else detail
    )
    response.data = {
        "error": {
            "message": (
                str(message) if not isinstance(message, (list, dict)) else message
            ),
            "code": response.status_code,
            "type": exc.__class__.__name__,
        }
    }
    return response
