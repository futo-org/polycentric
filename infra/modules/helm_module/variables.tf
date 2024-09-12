variable "helm_releases" {
  description = "A map of Helm releases to create. Pass in an arbitrary map of Helm chart definitions to deploy"
  type        = any
  default     = {}
}