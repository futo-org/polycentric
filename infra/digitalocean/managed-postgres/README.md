# Use managed postgres, do not put stateful workflows into Kubernetes

MANY suggest stateful workloads are fine - I'd rather make them someone elses problem and do not mind them being out-of-band. This reduces operational complexity.

This doesn't mean you should blindly trust DO - make point-in-time (incrimental backups) backups AND continuous or differential backups (ship and store wal).
IMO point-in-time / Incrimental backups are the Disaster Recovery
Differential backups are a lot friendly.

Keep the DB in a private subnet, I can enumate access patterns later


``` snippet.tf
# https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_postgresql_config
resource "digitalocean_database_postgresql_config" "example" { // get these from the current deployment
  cluster_id = digitalocean_database_cluster.example.id
  timezone   = "UTC"
  work_mem   = 16
}

# https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_cluster
resource "digitalocean_database_cluster" "example" {
  name       = "example-postgresql-cluster"
  engine     = "pg"
  version    = "15"
  size       = "db-s-1vcpu-1gb"
  region     = "nyc1"
  node_count = 1
}

https://registry.terraform.io/providers/digitalocean/digitalocean/latest/docs/resources/database_connection_pool
resource "digitalocean_database_connection_pool" "pool-01" {
  cluster_id = digitalocean_database_cluster.postgres-example.id
  name       = "pool-01"
  mode       = "transaction"
  size       = 20
  db_name    = "defaultdb"
  user       = "doadmin"
}

```

## Lifecycles of a database

The simplest way to manage a DB cluster is to have a single master (read write) and replicas ( read ) and use a proxy service to handle the fiddly parts.
Most applications read more than they write, much more more. It's easier to scale out than up.

Seeds,
Migrations,
etc