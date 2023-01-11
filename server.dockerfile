FROM ubuntu:22.04
COPY ./server/target/debug/server /server
CMD /server
