resource "tls_private_key" "main" {
  algorithm = "RSA"
}

resource "tls_cert_request" "main" {
  private_key_pem = tls_private_key.main.private_key_pem

  subject {
    common_name  = "futoinfra.com"
    organization = "FUTO"
  }

  dns_names = ["futoinfra.com", "*.futoinfra.com"]
}

resource "cloudflare_origin_ca_certificate" "main" {
  csr                = tls_cert_request.main.cert_request_pem
  hostnames          = ["futoinfra.com", "*.futoinfra.com"]
  request_type       = "origin-rsa"
  requested_validity = 5475
}

resource "digitalocean_certificate" "main" {
  name             = "poly-cf-origin-cert"
  type             = "custom"
  private_key      = tls_private_key.main.private_key_pem
  leaf_certificate = cloudflare_origin_ca_certificate.main.certificate
  lifecycle {
    create_before_destroy = true
  }
}