FROM --platform=linux/amd64 ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# OpenWrt ImageBuilder derleme araçları
RUN apt-get update && apt-get install -y \
    build-essential \
    libncurses5-dev \
    libncursesw5-dev \
    zlib1g-dev \
    gawk \
    git \
    gettext \
    libssl-dev \
    xsltproc \
    rsync \
    wget \
    unzip \
    python3 \
    python3-distutils \
    file \
    subversion \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /builder
COPY build-firmware.sh /builder/
RUN chmod +x /builder/build-firmware.sh

ENTRYPOINT ["/builder/build-firmware.sh"]
