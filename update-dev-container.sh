#! /bin/bash
DOCKERFILE_MD5=($(md5sum Dockerfile))

(docker build . -t gitlab.futo.org:5050/polycentric/polycentric:dev-container-${DOCKERFILE_MD5[0]} && \
docker push gitlab.futo.org:5050/polycentric/polycentric:dev-container-${DOCKERFILE_MD5[0]} && \
sed -i "/DOCKERFILE_MD5: /c\  DOCKERFILE_MD5: ${DOCKERFILE_MD5[0]}" .gitlab-ci.yml) || \
echo "Failed to push dev container to gitlab repo. Are you logged into docker? (docker login gitlab.futo.org:5050)"