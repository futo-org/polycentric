# immunatable idempotent infrastructure


## Seperation of concerns


application packaging
configuration managment
secrets

ci cd, kubernetes specific configurations

## Make Friendly

step by step

interfaces and seperation of concerns

progressive interfaces and goals, imagine various roles and tasks that need to be done
"I'm a _blank_ and I want to _blank_"

Secret Managment and rotation lifecycles

upgrade and downgrade lifecycles

logging, metrics, telemetry

actors, actions, tools

## clusterdeps

create container registry
generate configurations, credentials
k8s deployed

helmcharts

telegraf

influxdb

grafana

tailscale cert for routing to grafana host

## If you have go

`go install github.com/digitalocean/doctl/cmd/doctl@latest`

else download [doctl](https://github.com/digitalocean/doctl)



1. stand up kubernetes cluster
2. create cert and lb for application code
3. create and configure grafana
4. 