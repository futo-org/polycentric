terraform {
#   backend "http" {}
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {}

resource "digitalocean_container_registry" "main" {
  name                   = "polycentric"
  subscription_tier_slug = "professional"
  region = "sfo2"
}

resource "digitalocean_container_registry_docker_credentials" "main" {
  registry_name = digitalocean_container_registry.main.name
}

module "gitlabci_var_module" {
  source = "../gitlabci_var_module"

  project_id = "42"
  environment_variables = {
    DO_OCI_REGISTRY = {
        value = digitalocean_container_registry.main.server_url
        protected = false
        environment_scope = "*"
    }
    CI_DO_OCI_TOKEN = {
        value = jsondecode(digitalocean_container_registry_docker_credentials.main.docker_credentials).auths["registry.digitalocean.com"].auth
        protected = false
        environment_scope = "*"
    }
  }
}