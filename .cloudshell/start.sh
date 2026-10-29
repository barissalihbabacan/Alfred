#!/usr/bin/env bash
# Starts the Alfred setup wizard. In Cloud Shell it downloads the prebuilt
# alfred-setup binary from the latest GitHub release, checks its SHA-256,
# makes sure gcloud is signed in, and runs it from the repository root.
# Anywhere else (or if the download fails) it builds the wizard with cargo.
set -euo pipefail

REPO="barissalihbabacan/Alfred"
ASSET="alfred-setup-x86_64-unknown-linux-musl"
BASE_URL="https://github.com/$REPO/releases/latest/download"

cd "$(dirname "$0")/.."

ensure_gcloud_login() {
  command -v gcloud >/dev/null || return 0
  if [ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]; then
    echo "Alfred Setup needs your Google Cloud account. Follow the sign-in link below."
    gcloud auth login --update-adc
  fi
}

run_from_source() {
  if command -v cargo >/dev/null; then
    echo "Building the wizard from source (first run takes a few minutes)…"
    exec cargo run --release --manifest-path crates/alfred-setup/Cargo.toml -- "$@"
  fi
  echo "Alfred Setup: could not download the wizard and Rust is not installed." >&2
  echo "Install Rust (https://rustup.rs) and run this script again." >&2
  exit 1
}

ALFRED_SOURCE_REPO="$(git remote get-url origin 2>/dev/null || true)"
export ALFRED_SOURCE_REPO

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  ensure_gcloud_login
  run_from_source "$@"
fi

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
echo "Downloading the Alfred setup wizard…"
if ! curl -fsSL --retry 2 "$BASE_URL/$ASSET" -o "$dir/$ASSET" ||
   ! curl -fsSL --retry 2 "$BASE_URL/SHA256SUMS" -o "$dir/SHA256SUMS"; then
  echo "Download failed; falling back to building from source."
  ensure_gcloud_login
  run_from_source "$@"
fi
if ! (cd "$dir" && sha256sum --check --status SHA256SUMS); then
  echo "Alfred Setup: the downloaded wizard does not match its checksum; not running it." >&2
  exit 1
fi
chmod 700 "$dir/$ASSET"

ensure_gcloud_login
"$dir/$ASSET" "$@"
