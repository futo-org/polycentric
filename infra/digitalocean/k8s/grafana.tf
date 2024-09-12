# Variable definitions
variable "grafana_domain" {
  default = "futoinfra.com"
}

variable "grafana_oauth_client_name" {
  default = "polycentric_grafana"
}

# GitLab OAuth Application for Grafana
resource "gitlab_application" "oidc" {
  confidential = true
  scopes       = ["openid", "profile", "email"]
  name         = var.grafana_oauth_client_name
  redirect_url = "https://grafana.${var.grafana_domain}/login/gitlab"
}

# Create namespace for monitoring
resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
  }
}

# Helm release for Grafana
resource "helm_release" "grafana" {
  name       = "grafana"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  repository = "https://grafana.github.io/helm-charts"
  chart      = "grafana"
  version    = "8.5.1"

  values = [
    yamlencode({
      adminPassword = ""
      nodeSelector = {
        "droplet.digitalocean.com/tag" = "monitoring"
      }
      server = {
        root_url = "https://grafana.${var.grafana_domain}"
      }
      auth = {
        disable_login_form = false
        oauth_auto_login   = true
        oauth = {
          gitlab = {
            enabled        = true
            client_id      = gitlab_application.oidc.application_id
            client_secret  = gitlab_application.oidc.secret
            scopes         = ["openid", "profile", "email"]
            auth_url       = "https://gitlab.com/oauth/authorize"
            token_url      = "https://gitlab.com/oauth/token"
            api_url        = "https://gitlab.com/api/v4/user"
            allowed_groups = ["developers"]
          }
        }
      }
      service = {
        type = "LoadBalancer"
        annotations = {
          "service.beta.kubernetes.io/do-loadbalancer-name"                                 = "grafana.futoinfra.com"
          "service.beta.kubernetes.io/do-loadbalancer-protocol"                             = "https"
          "service.beta.kubernetes.io/do-loadbalancer-certificate-id"                       = digitalocean_certificate.main.uuid
          "service.beta.kubernetes.io/do-loadbalancer-healthcheck-path"                     = "/api/health"
          "service.beta.kubernetes.io/do-loadbalancer-healthcheck-protocol"                 = "http"
          "service.beta.kubernetes.io/do-loadbalancer-healthcheck-check-interval-seconds"   = "10"
          "service.beta.kubernetes.io/do-loadbalancer-healthcheck-response-timeout-seconds" = "5"
          "service.beta.kubernetes.io/do-loadbalancer-healthcheck-unhealthy-threshold"      = "3"
          "service.beta.kubernetes.io/do-loadbalancer-healthcheck-healthy-threshold"        = "5"
          "service.beta.kubernetes.io/do-loadbalancer-http-idle-timeout-seconds"            = "60"
        }
        labels = {
          "app.kubernetes.io/managed-by" = "Helm"
        }
        ports = [
          {
            port       = 443
            targetPort = 3000
            name       = "https"
            protocol   = "TCP"
          },
          {
            port       = 80
            targetPort = 3000
            name       = "http"
            protocol   = "TCP"
          }
        ]
      }
      persistence = {
        enabled          = true
        storageClassName = "do-block-storage"
        accessModes      = ["ReadWriteOnce"]
        size             = "10Gi"
      }
      grafana_ini = {
        paths = {
          data = "/var/lib/grafana/"
        }
        mode  = "console"
        level = "debug"
      }
    })
  ]
}
