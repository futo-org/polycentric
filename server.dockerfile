FROM ubuntu:22.04
COPY ./server/target/release/server /server
CMD /server
