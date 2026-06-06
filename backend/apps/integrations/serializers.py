from __future__ import annotations

from rest_framework import serializers

from apps.core.serializers import NativeModelSerializer

from .models import DiscordIntegration, GitCommit, GitHubIntegration, GitLabIntegration


class GitHubIntegrationSerializer(NativeModelSerializer):
    projectId = serializers.CharField(source="project_id")
    repoOwner = serializers.CharField(source="repo_owner")
    repoName = serializers.CharField(source="repo_name")
    accessToken = serializers.CharField(source="access_token", write_only=True)
    webhookSecret = serializers.CharField(
        source="webhook_secret", required=False, allow_blank=True
    )
    autoUpdateStatus = serializers.BooleanField(
        source="auto_update_status", required=False
    )
    enabledEvents = serializers.JSONField(source="enabled_events", required=False)

    class Meta:
        model = GitHubIntegration
        fields = [
            "id",
            "created_at",
            "updated_at",
            "projectId",
            "repoOwner",
            "repoName",
            "accessToken",
            "webhookSecret",
            "autoUpdateStatus",
            "enabledEvents",
        ]


class GitLabIntegrationSerializer(NativeModelSerializer):
    projectId = serializers.CharField(source="project_id")
    projectPath = serializers.CharField(source="project_path")
    accessToken = serializers.CharField(source="access_token", write_only=True)
    webhookSecret = serializers.CharField(
        source="webhook_secret", required=False, allow_blank=True
    )
    autoUpdateStatus = serializers.BooleanField(
        source="auto_update_status", required=False
    )
    enabledEvents = serializers.JSONField(source="enabled_events", required=False)

    class Meta:
        model = GitLabIntegration
        fields = [
            "id",
            "created_at",
            "updated_at",
            "projectId",
            "projectPath",
            "accessToken",
            "webhookSecret",
            "autoUpdateStatus",
            "enabledEvents",
        ]


class DiscordIntegrationSerializer(NativeModelSerializer):
    projectId = serializers.CharField(source="project_id")
    webhookUrl = serializers.URLField(source="webhook_url")
    enabledEvents = serializers.JSONField(source="enabled_events", required=False)

    class Meta:
        model = DiscordIntegration
        fields = [
            "id",
            "created_at",
            "updated_at",
            "projectId",
            "webhookUrl",
            "enabledEvents",
        ]


class GitCommitSerializer(NativeModelSerializer):
    projectId = serializers.CharField(source="project_id")
    commitSha = serializers.CharField(source="commit_sha")
    authorEmail = serializers.EmailField(source="author_email")
    linkedTaskIds = serializers.JSONField(source="linked_task_ids", required=False)

    class Meta:
        model = GitCommit
        fields = [
            "id",
            "created_at",
            "updated_at",
            "projectId",
            "provider",
            "commitSha",
            "message",
            "author",
            "authorEmail",
            "timestamp",
            "linkedTaskIds",
            "url",
        ]
