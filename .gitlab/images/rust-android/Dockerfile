ARG RUST_IMAGE

FROM ${RUST_IMAGE}

# Android NDK. cargo-ndk only needs the llvm toolchain, so drop the
# standalone tools we never run.
RUN curl -L -o /tmp/ndk.zip "https://dl.google.com/android/repository/android-ndk-r27c-linux.zip" \
    && unzip -q /tmp/ndk.zip -d /opt \
    && mv /opt/android-ndk-* /opt/android-ndk \
    && rm /tmp/ndk.zip \
    && rm -rf /opt/android-ndk/simpleperf /opt/android-ndk/shader-tools

RUN cargo install cargo-ndk && rm -rf /usr/local/cargo/registry

ENV ANDROID_NDK_HOME=/opt/android-ndk
ENV PATH="/opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/bin:${PATH}"

# JDK 17 + Android SDK (for the kt-core AAR build).
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
RUN curl -L -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" \
    && mkdir -p /opt/android-sdk/cmdline-tools \
    && unzip -q /tmp/cmdline-tools.zip -d /opt/android-sdk/cmdline-tools \
    && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
    && rm /tmp/cmdline-tools.zip
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH="/opt/android-sdk/cmdline-tools/latest/bin:${PATH}"
# Pin SDK at compileSdk 35.
RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools" \
    && rm -rf ${ANDROID_HOME}/.temp
