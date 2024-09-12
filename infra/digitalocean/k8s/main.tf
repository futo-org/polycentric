terraform {
  #   backend "http" {}
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "4.41.0"
    }
    gitlab = {
      source = "gitlabhq/gitlab"
      version = "17.3.1"
    }
    tailscale = {
      source = "tailscale/tailscale"
      version = "0.16.2"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "4.0.5"
    }
    null = {
      source  = "hashicorp/null"
      version = "3.2.2"
    }
  }
}

provider "cloudflare" {}

provider "digitalocean" {}

provider "tailscale" {}

provider "gitlab" {}

variable "ENVIRONMENT" {
  default = "test"
}
variable "PROJECT" {
  default = "polycentric"
}
variable "REGION" { # check valid region
  default = "sfo2"
}
variable "FQDN" {
  default = "polycentrictest.futoinfra.com"
}
variable "ROOT_DOMAIN" {
  default = "futoinfra.com"
}

locals {
  cluster_name = "${var.PROJECT}-${var.ENVIRONMENT}1"
}
