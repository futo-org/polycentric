resource "digitalocean_kubernetes_cluster" "main" {
  name    = local.cluster_name
  region  = var.REGION
  version = "1.30.4-do.0"
  # vpc_uuid
  registry_integration = true
  surge_upgrade        = true

  node_pool {
    name       = "default"
    size       = "s-1vcpu-2gb"
    node_count = 3
    tags       = ["default"]
  }
}

resource "digitalocean_kubernetes_node_pool" "mon" {
  cluster_id = digitalocean_kubernetes_cluster.main.id

  name       = "monitoring"
  size       = "s-1vcpu-2gb"
  auto_scale = false
  node_count = 1
  min_nodes  = 1
  max_nodes  = 2
  tags       = ["monitoring"]
}

resource "digitalocean_project" "main" {
  name        = "Tom's Kubernetes Work"
  description = "Playing with k8s terraform"
  purpose     = "Web Application"
  environment = "Development"
  resources   = [digitalocean_kubernetes_cluster.main.urn]
}

provider "kubernetes" {
  host                   = digitalocean_kubernetes_cluster.main.endpoint
  cluster_ca_certificate = base64decode(digitalocean_kubernetes_cluster.main.kube_config[0].cluster_ca_certificate)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "doctl"
    args = ["kubernetes", "cluster", "kubeconfig", "exec-credential",
    "--version=v1beta1", digitalocean_kubernetes_cluster.main.id]
  }
}

provider "helm" {
  kubernetes {
    host                   = digitalocean_kubernetes_cluster.main.endpoint
    cluster_ca_certificate = base64decode(digitalocean_kubernetes_cluster.main.kube_config[0].cluster_ca_certificate)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "doctl"
      args = ["kubernetes", "cluster", "kubeconfig", "exec-credential",
      "--version=v1beta1", digitalocean_kubernetes_cluster.main.id]
    }
  }
}
