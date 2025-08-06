FROM ubuntu:22.04
RUN apt-get update -y && apt-get install -y ca-certificates

# Copy the pre-built binary produced by the build-forum-server CI job
COPY ./build-artifacts/forum_server /forum_server

# Default command
CMD ["/forum_server"] 