# Cloud Shell image for the "Launch Alfred Setup" button.
# Build from the repository root:
#   docker build -f .cloudshell/Dockerfile -t ghcr.io/<owner>/alfred-setup .
# Cloud Shell requires custom images to extend its base image and be public.

FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY crates/setup-core crates/setup-core
COPY crates/alfred-setup crates/alfred-setup
# Static musl binary: runs on the Debian-based Cloud Shell image without glibc concerns.
RUN cargo build --release --locked --manifest-path crates/alfred-setup/Cargo.toml

FROM gcr.io/cloudshell-images/cloudshell:latest
COPY --from=build /src/crates/alfred-setup/target/release/alfred-setup /usr/local/bin/alfred-setup
COPY .cloudshell/cloudshell_open /bin/cloudshell_open
RUN chmod 755 /usr/local/bin/alfred-setup /bin/cloudshell_open
