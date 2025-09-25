FROM ubuntu:22.04
RUN apt-get update -y && apt-get install -y ca-certificates
COPY ./server/target/release/server /server
COPY ./server/target/release/health_probe /health_probe

# Container health check: runs every 30s, fails after 3s timeout if probe exits non-zero
HEALTHCHECK --interval=60s --timeout=3s CMD ["/health_probe"]

CMD /server
