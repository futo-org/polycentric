# Create external-dns namespace
resource "kubernetes_namespace" "external_dns" {
  metadata {
    name = "external-dns"
  }
}

data "cloudflare_api_token_permission_groups" "all" {}

data "cloudflare_zone" "main" {
  name = "futoinfra.com"
}

# Create Cloudflare API Token for DNS Management
resource "cloudflare_api_token" "external_dns" {
  name = "cert-dns-token"

  policy {
    permission_groups = [
      data.cloudflare_api_token_permission_groups.all.zone["DNS Write"],
      data.cloudflare_api_token_permission_groups.all.zone["Zone Read"],
    ]
    resources = {
      "com.cloudflare.api.account.zone.${data.cloudflare_zone.main.id}" = "*"
    }
  }

  policy {
    permission_groups = [
      data.cloudflare_api_token_permission_groups.all.zone["SSL and Certificates Write"],
      data.cloudflare_api_token_permission_groups.all.zone["Page Rules Write"],
    ]
    resources = {
      "com.cloudflare.api.account.zone.${data.cloudflare_zone.main.id}" = "*"
    }
  }

  policy {
    permission_groups = [
      data.cloudflare_api_token_permission_groups.all.account["Account Settings Read"],
    ]
    resources = {
      "com.cloudflare.api.account.*" = "*"
    }
  }
}

resource "kubernetes_secret" "cloudflare_api_token" {
  metadata {
    name      = "cloudflare-api-key"
    namespace = kubernetes_namespace.external_dns.metadata[0].name
  }

  data = {
    apiKey = base64encode(cloudflare_api_token.external_dns.value)
  }
}

resource "helm_release" "external_dns" {
  depends_on = [ kubernetes_secret.cloudflare_api_token, cloudflare_api_token.external_dns ]
  name       = "external-dns"
  namespace  = kubernetes_namespace.external_dns.metadata[0].name
  repository = "https://kubernetes-sigs.github.io/external-dns/"
  chart      = "external-dns"
  version    = "1.14.5"
  timeout    = 60

  values = [
    yamlencode({
      provider = "cloudflare"
      env = [
        {
          name = "CF_API_TOKEN"
          valueFrom = {
            secretKeyRef = {
              name = "cloudflare-api-key"
              key  = "apiKey"
            }
          }
        }
      ]
      logLevel = "debug"
    })
  ]
}
