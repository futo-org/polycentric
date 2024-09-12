output "helm_releases" {
  description = "Map of attributes of the Helm release created"
  value       = helm_release.this
}