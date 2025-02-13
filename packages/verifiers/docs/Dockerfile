FROM ubuntu:22.04

RUN apt-get update -y && \
    apt-get install -y curl libicu70 && \ 
    curl -sL https://deb.nodesource.com/setup_18.x | bash && \
    apt-get install nodejs -y && \
    npm install --global retypeapp wrangler

