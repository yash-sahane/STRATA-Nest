from __future__ import annotations

from django.db import models

from apps.core.models import TimestampedModel

PROVIDER = [("GITHUB", "GitHub"), ("GITLAB", "GitLab")]


class GitHubIntegration(TimestampedModel):
    project = models.OneToOneField(
        "projects.Project", on_delete=models.CASCADE, related_name="github_integration"
    )
    repo_owner = models.CharField(max_length=255)
    repo_name = models.CharField(max_length=255)
    access_token = models.TextField()  # store encrypted at rest in prod
    webhook_secret = models.CharField(max_length=255, blank=True, default="")
    auto_update_status = models.BooleanField(default=False)
    enabled_events = models.JSONField(default=list)

    REALTIME_COLLECTION = "github_integrations"


class GitLabIntegration(TimestampedModel):
    project = models.OneToOneField(
        "projects.Project", on_delete=models.CASCADE, related_name="gitlab_integration"
    )
    project_path = models.CharField(max_length=512)
    access_token = models.TextField()
    webhook_secret = models.CharField(max_length=255, blank=True, default="")
    auto_update_status = models.BooleanField(default=False)
    enabled_events = models.JSONField(default=list)

    REALTIME_COLLECTION = "gitlab_integrations"


class DiscordIntegration(TimestampedModel):
    project = models.OneToOneField(
        "projects.Project", on_delete=models.CASCADE, related_name="discord_integration"
    )
    webhook_url = models.URLField(max_length=500)
    enabled_events = models.JSONField(default=list)

    REALTIME_COLLECTION = "discord_integrations"


class GitCommit(TimestampedModel):
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="git_commits"
    )
    provider = models.CharField(max_length=10, choices=PROVIDER)
    commit_sha = models.CharField(max_length=64)
    message = models.TextField()
    author = models.CharField(max_length=255)
    author_email = models.EmailField()
    timestamp = models.DateTimeField()
    linked_task_ids = models.JSONField(default=list)
    url = models.URLField(max_length=500)

    REALTIME_COLLECTION = "git_commits"

    class Meta(TimestampedModel.Meta):
        unique_together = [("project", "commit_sha")]
