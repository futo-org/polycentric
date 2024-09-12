# helm_module

For deploying multiple helm releases from a map

### Example

identifier key = chart name

``` hcl
module "helm_releases" {
  source = "../helm_module" # path to this directory

  helm_releases = {
    "$name" = {
      create_namespace = false
      namespace        = "default"
      name             = "$name"
      repository       = "https://repo.git"
      chart            = "$chartname"
      version          = "$chartversion"
      wait             = false
      values           = [file("${path.module}/helm/$name/values.yaml")] # https://helm.sh/docs/chart_template_guide/values_files/
    }
    // etc
  }
}
```