# notes

seperate projects?
seperate VPCs?
vpc for different environments?

## todo

use helm provider & kubernetes provider after bootstrapping




https://github.com/digitalocean/terraform-provider-digitalocean/blob/main/examples/kubernetes/kubernetes-config/main.tf


k8s managed DNS records via external-DNS

``` yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-dns
spec:
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: external-dns
  template:
    metadata:
      labels:
        app: external-dns
    spec:
      containers:
        - name: external-dns
          image: registry.k8s.io/external-dns/external-dns:v0.14.2
          args:
            - --source=service # ingress is also possible
            - --domain-filter=example.com # (optional) limit to only example.com domains; change to match the zone created above.
            - --zone-id-filter=023e105f4ecef8ad9ca31a8372d0c353 # (optional) limit to a specific zone.
            - --provider=cloudflare
            - --cloudflare-proxied # (optional) enable the proxy feature of Cloudflare (DDOS protection, CDN...)
            - --cloudflare-dns-records-per-page=5000 # (optional) configure how many DNS records to fetch per request
    env:
      - name: CF_API_TOKEN # Provision this with terraform, scope to domain, zone, etc
        valueFrom:
          secretKeyRef:
            name: cloudflare-api-key
            key: apiKey
```

OR create DNS records that point to public facing load balancer in front cluster.

Digital Ocean Managed Certs vs cert-manager provisioned certificates.


Can be provisioned ahead of time and stored as a var

Digital Ocean Managed public Load Balancer (to private endpoints) vs direct exposure via ingress controller (layer 7)

DO Managed Cert + DO Public Load balancer

``` yaml
    service.beta.kubernetes.io/do-loadbalancer-certificate-id: "1234-5678-9012-3456" ## If using DO certs, store this somewhere (kubernetes Secrets?) to be applied
    service.beta.kubernetes.io/do-loadbalancer-protocol: "https"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-port: "80"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-protocol: "http"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-path: "/health"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-check-interval-seconds: "3"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-response-timeout-seconds: "5"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-unhealthy-threshold: "3"
    service.beta.kubernetes.io/do-loadbalancer-healthcheck-healthy-threshold: "5"
```

Digital Ocean managed Postgres service vs helm chart
