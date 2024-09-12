# resource "grafana_data_source" "influxdb-ex" {
#   type                = "influxdb"
#   name                = "" # 
#   url                 = "" # 
#   basic_auth_enabled  = true # not sure if there's a better auth model
#   basic_auth_username = "" # user
#   database_name       = "" # dbname

#   json_data_encoded = jsonencode({
#     authType          = "default"
#     basicAuthPassword = "mypassword" 
#   })
# }


#  resource "grafana_data_source" "postgres-ex" {
#     type          = "postgres"
#     name          = "polycentric"
#     url           = module.secret.polycentric_pghost_kubernetes_secret
#     username      = module.secret.polycentric_pguser_kubernetes_secret
#     password      = module.secret.polycentric_pgpassword_kubernetes_secret
#     database_name = module.secret.polycentric_pgdatabase_kubernetes_secret
#     json_data {
#       ssl_mode = "disable"
#     }
#   } 