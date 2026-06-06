"""Native query parameter filtering for API resources.

The frontend sends ordinary query params such as `?workspaceId=...`,
`?projectId=...`, `?status=ACTIVE`, and `?ordering=-createdAt`. This backend
maps camelCase API field names onto Django model fields.
"""

from __future__ import annotations

import re
from typing import Iterable

from django.db import models
from django.db.models import Q, QuerySet
from rest_framework.filters import BaseFilterBackend

_SYS_MAP = {"id": "id", "createdAt": "created_at", "updatedAt": "updated_at"}
_CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")
_IGNORED = {"page", "page_size", "pageSize", "format", "ordering"}
_LOOKUP_ALIASES = {
    "ne": "exact",
    "lt": "lt",
    "lte": "lte",
    "gt": "gt",
    "gte": "gte",
    "icontains": "icontains",
    "istartswith": "istartswith",
    "iendswith": "iendswith",
    "isnull": "isnull",
    "not_in": "in",
}
_NEGATED_LOOKUPS = {"ne", "not_in"}


def _xlate_field(name: str) -> str:
    if name in _SYS_MAP:
        return _SYS_MAP[name]
    return _CAMEL_RE.sub("_", name).lower()


class CamelCaseQueryFilter(BaseFilterBackend):
    """Apply simple equality/list filtering and ordering from query params."""

    def filter_queryset(self, request, queryset: QuerySet, view) -> QuerySet:
        params = getattr(request, "query_params", None) or request.GET
        model_fields = {field.name for field in queryset.model._meta.get_fields()}

        for raw_key, values in params.lists():
            if raw_key in _IGNORED:
                continue
            resolved = self._lookup(raw_key, model_fields)
            if resolved is None:
                continue
            lookup, negate = resolved
            clean_values = [value for value in values if value != ""]
            if not clean_values:
                continue
            if lookup.endswith("__isnull"):
                value = clean_values[-1].lower() in {"1", "true", "yes"}
                queryset = (
                    queryset.exclude(**{lookup: value})
                    if negate
                    else queryset.filter(**{lookup: value})
                )
                continue
            if len(clean_values) == 1 and "," in clean_values[0]:
                clean_values = [value for value in clean_values[0].split(",") if value]
            field = self._field_for_lookup(queryset.model, lookup)
            clean_values = [self._coerce_value(field, value) for value in clean_values]
            if len(clean_values) > 1:
                expr = lookup if lookup.endswith("__in") else f"{lookup}__in"
                queryset = (
                    queryset.exclude(**{expr: clean_values})
                    if negate
                    else queryset.filter(**{expr: clean_values})
                )
            else:
                queryset = (
                    queryset.exclude(**{lookup: clean_values[0]})
                    if negate
                    else queryset.filter(**{lookup: clean_values[0]})
                )

        ordering = params.get("ordering")
        if ordering:
            clauses = []
            for raw_field in ordering.split(","):
                raw_field = raw_field.strip()
                if not raw_field:
                    continue
                prefix = "-" if raw_field.startswith("-") else ""
                field = _xlate_field(raw_field.lstrip("-"))
                if field in model_fields:
                    clauses.append(f"{prefix}{field}")
            if clauses:
                queryset = queryset.order_by(*clauses)
        return queryset

    @staticmethod
    def _lookup(raw_key: str, model_fields: set[str]) -> tuple[str, bool] | None:
        raw_field, suffix = (raw_key.split("__", 1) + [""])[:2]
        field = _xlate_field(raw_field)
        if field in model_fields:
            if suffix:
                lookup = _LOOKUP_ALIASES.get(suffix)
                if lookup is None:
                    return None
                return f"{field}__{lookup}", suffix in _NEGATED_LOOKUPS
            return field, False
        if field.endswith("_id") and field[:-3] in model_fields:
            if suffix:
                lookup = _LOOKUP_ALIASES.get(suffix)
                if lookup is None:
                    return None
                return f"{field}__{lookup}", suffix in _NEGATED_LOOKUPS
            return field, False
        return None

    @staticmethod
    def _field_for_lookup(model, lookup: str):
        field_name = lookup.split("__", 1)[0]
        try:
            return model._meta.get_field(field_name)
        except Exception:
            if field_name.endswith("_id"):
                try:
                    return model._meta.get_field(field_name[:-3])
                except Exception:
                    return None
            return None

    @staticmethod
    def _coerce_value(field, value: str):
        if isinstance(field, models.BooleanField):
            lowered = value.lower()
            if lowered in {"1", "true", "yes", "on"}:
                return True
            if lowered in {"0", "false", "no", "off"}:
                return False
        return value


def or_filter(qs: QuerySet, clauses: Iterable[tuple[str, str, object]]) -> QuerySet:
    """Apply a small OR expression for domain endpoints that need one."""
    q = Q()
    for op, field, value in clauses:
        f = _xlate_field(field)
        if op == "eq":
            q |= Q(**{f: value})
        elif op == "contains":
            q |= Q(**{f"{f}__icontains": value})
        elif op == "search":
            q |= Q(**{f"{f}__icontains": value})
    return qs.filter(q)
