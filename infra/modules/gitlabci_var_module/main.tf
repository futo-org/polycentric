terraform {
  required_providers {
    gitlab = {
      source = "gitlabhq/gitlab"
      version = "17.3.1"
    }
  }
}

# export GITLAB_BASE_URL=https://gitlab.futo.org/api/v4/
# GITLAB_TOKEN=***
# provider "gitlab" {}

variable "project_id" {
  type        = string
  description = "The GitLab project ID"
}

variable "environment_variables" {
  type = map(object({
    value             = string
    protected         = bool
    environment_scope = string
  }))
  description = "A map of environment variables to be added to the GitLab project"
}


resource "gitlab_project_variable" "example" {
  for_each = var.environment_variables

  project           = var.project_id

  key               = each.key
  value             = each.value.value
  protected         = each.value.protected
  environment_scope = each.value.environment_scope # scope to production, staging, etfc
}