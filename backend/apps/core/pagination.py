"""Pagination primitives for native collection responses."""

from __future__ import annotations

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class NativePagination(PageNumberPagination):
    """Return a compact collection envelope with pagination metadata."""

    page_size = 100
    page_size_query_param = "pageSize"
    max_page_size = 1000

    def get_paginated_response(self, data):
        return Response(
            {
                "items": data,
                "total": self.page.paginator.count,
                "page": self.page.number,
                "pageSize": self.get_page_size(self.request),
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "properties": {
                "items": schema,
                "total": {"type": "integer"},
                "page": {"type": "integer"},
                "pageSize": {"type": "integer"},
            },
        }
