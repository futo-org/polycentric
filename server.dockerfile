FROM ubuntu:22.04
COPY ./server/target/debug/server /server
COPY ./packages/polycentric-web/build /static
CMD /server
