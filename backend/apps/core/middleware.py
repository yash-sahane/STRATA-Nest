"""Cookie -> Authorization header bridge so DRF's JWTAuthentication sees the token.

Runs before AuthenticationMiddleware does anything, so per-request `request.user`
is correctly populated for both cookie- and header-based JWT.
"""

from __future__ import annotations

from django.conf import settings


class JWTCookieMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if "HTTP_AUTHORIZATION" not in request.META:
            token = request.COOKIES.get(settings.JWT_ACCESS_COOKIE_NAME)
            if token:
                request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        return self.get_response(request)
