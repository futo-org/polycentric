FROM ubuntu:22.04
RUN apt-get update -y && apt-get install -y ca-certificates
COPY ./server/target/release/server /server
CMD /server
