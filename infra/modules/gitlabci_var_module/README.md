# Usage

This snippet allows you pass variables as a map to be placed into GitLab CI

This will be used for k8s credentials, registry access tokens etc

VARn is the identifier or variable name, value is the value ... 
I prefer not to omit these from the Terraform State, HC et al make it sound scary but it's fine - treat your state files like you would secrets!

``` snippet.tf
module "gitlabci_module" {
  source = "../modules/gitlabci_module"

  project_id = "12345" // use data to get ID based on name or store in variable somewhere
  
  environment_variables = {
    VAR1 = {
      value             = "value1"
      protected         = false
      environment_scope = "production"
    }
    VAR2 = {
      value             = "value2"
      protected         = true
      environment_scope = "production"
    }
    VAR3 = {
      value             = "value3"
      protected         = false
      environment_scope = "*"
    }
  }
}
```