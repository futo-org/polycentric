# variable "grafana_folder_uid" {
#   description = "The UID of the Grafana folder where the dashboard will be saved."
#   type        = string
# }

# variable "dashboard_uid" {
#   description = "The UID for the Grafana dashboard."
#   type        = string
# }

# variable "dashboard_title" {
#   description = "The title for the Grafana dashboard."
#   type        = string
# }


# variable "bucket_name" {
#   description = "The bucket name in InfluxDB."
#   type        = string
# }

# variable "com_docker_service" {
#   description = "The docker compose service name."
#   type        = string
# }

# resource "grafana_dashboard" "test" {
#   folder = grafana_folder.test.uid
#   config_json = jsonencode({
#     "annotations": {
#       "list": [
#         {
#           "builtIn": 1,
#           "datasource": {
#             "type": "grafana",
#             "uid": "-- Grafana --"
#           },
#           "enable": true,
#           "hide": true,
#           "iconColor": "rgba(0, 211, 255, 1)",
#           "name": "Annotations & Alerts",
#           "type": "dashboard"
#         }
#       ]
#     },
#     "description": "Test dashboard",
#     "editable": true,
#     "fiscalYearStartMonth": 0,
#     "graphTooltip": 0,
#     "links": [],
#     "liveNow": false,
#     "panels": [
#       {
#         "gridPos": {
#           "h": 1,
#           "w": 24,
#           "x": 0,
#           "y": 0
#         },
#         "id": 19,
#         "title": "Polycentric",
#         "type": "row"
#       },
#       {
#         "datasource": {
#           "type": "influxdb",
#           "uid": var.datasource_influxdb_uid
#         },
#         "fieldConfig": {
#           "defaults": {
#             "color": {
#               "mode": "palette-classic"
#             },
#             "custom": {
#               "axisCenteredZero": false,
#               "axisColorMode": "text",
#               "axisLabel": "",
#               "axisPlacement": "auto",
#               "barAlignment": 0,
#               "drawStyle": "line",
#               "fillOpacity": 0,
#               "gradientMode": "none",
#               "hideFrom": {
#                 "legend": false,
#                 "tooltip": false,
#                 "viz": false
#               },
#               "lineInterpolation": "linear",
#               "lineWidth": 1,
#               "pointSize": 5,
#               "scaleDistribution": {
#                 "type": "linear"
#               },
#               "showPoints": "auto",
#               "spanNulls": false,
#               "stacking": {
#                 "group": "A",
#                 "mode": "none"
#               },
#               "thresholdsStyle": {
#                 "mode": "off"
#               }
#             },
#             "decimals": 2,
#             "mappings": [],
#             "max": 100,
#             "min": 0,
#             "thresholds": {
#               "mode": "absolute",
#               "steps": [
#                 {
#                   "color": "green",
#                   "value": null
#                 },
#                 {
#                   "color": "red",
#                   "value": 80
#                 }
#               ]
#             },
#             "unit": "percent"
#           },
#           "overrides": []
#         },
#         "gridPos": {
#           "h": 5,
#           "w": 5,
#           "x": 1,
#           "y": 1
#         },
#         "id": 22,
#         "options": {
#           "legend": {
#             "calcs": [],
#             "displayMode": "list",
#             "placement": "bottom",
#             "showLegend": true
#           },
#           "tooltip": {
#             "mode": "single",
#             "sort": "none"
#           }
#         },
#         "pluginVersion": "9.5.2",
#         "targets": [
#           {
#             "datasource": {
#               "type": "influxdb",
#               "uid": var.datasource_influxdb_uid
#             },
#             "query": "from(bucket: \"${var.bucket_name}\")\n  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n  |> filter(fn: (r) => r[\"_measurement\"] == \"docker_container_cpu\")\n  |> filter(fn: (r) => r[\"host\"] == \"telegraf\")\n  |> filter(fn: (r) => r[\"cpu\"] == \"cpu-total\")\n  |> filter(fn: (r) => r[\"_field\"] == \"usage_percent\")\n  |> filter(fn: (r) => r[\"com.docker.compose.service\"] == \"${var.com_docker_service}\")\n  |> aggregateWindow(every: v.windowPeriod, fn: last, createEmpty: false)\n  |> yield(name: \"last\")",
#             "refId": "A"
#           }
#         ],
#         "title": "Polycentric CPU Utilization",
#         "type": "timeseries"
#       }
#     ],
#     "refresh": "5s",
#     "schemaVersion": 38,
#     "style": "dark",
#     "tags": [],
#     "templating": {
#       "list": []
#     },
#     "time": {
#       "from": "now-30m",
#       "to": "now"
#     },
#     "timepicker": {},
#     "timezone": "",
#     "title": var.dashboard_title,
#     "uid": var.dashboard_uid,
#     "version": 1,
#     "weekStart": ""
#   })
# }
