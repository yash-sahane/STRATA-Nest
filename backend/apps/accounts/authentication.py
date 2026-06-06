"""DRF authentication class that reads the JWT from an httpOnly cookie.

Falls through to the standard Authorization header when no cookie is present.
"""

from __future__ import annotations

from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


class JWTCookieAuthentication(JWTAuthentication):
    def authenticate(self, request):
        header = self.get_header(request)
        if header is None:
            raw_token = request.COOKIES.get(settings.JWT_ACCESS_COOKIE_NAME)
            if raw_token is None:
                return None
            try:
                validated = self.get_validated_token(raw_token)
            except (AuthenticationFailed, InvalidToken, TokenError):
                return None
            return self.get_user(validated), validated
        return super().authenticate(request)
