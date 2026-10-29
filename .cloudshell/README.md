# Cloud Shell launch

How the README's **Launch Alfred Setup** button starts the setup wizard with one click.

## The link

```text
https://ssh.cloud.google.com/cloudshell/editor
  ?cloudshell_git_repo=https://github.com/<owner>/<repo>
  &cloudshell_image=ghcr.io/<owner>/alfred-setup
  &shellonly=true
```

- `cloudshell_image` makes Cloud Shell start a session from our image. Cloud Shell requires custom images to extend `gcr.io/cloudshell-images/cloudshell` and to be publicly accessible ([Open in Cloud Shell](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell)).
- With a custom image, Cloud Shell does not clone the repository itself: it runs `/bin/cloudshell_open --repo_url=… [--git_branch=…]` from the image. This is not described in the Cloud Shell documentation; it is how Google's [Cloud Run Button](https://github.com/GoogleCloudPlatform/cloud-run-button) works (its redirector sets `cloudshell_image` and `shellonly=true`, and its image only adds `/bin/cloudshell_open`). Verify it in a real session before relying on it.
- `shellonly=true` opens just the terminal, which is where the wizard runs.
- `cloudshell_tutorial=.cloudshell/tutorial.md` can be added as a fallback: if the image cannot be used, the tutorial explains how to start the wizard by hand.

## The image

`.cloudshell/Dockerfile` builds `crates/alfred-setup` as a static musl binary and adds it, together with `.cloudshell/cloudshell_open`, to the Cloud Shell base image.

`.github/workflows/setup-image.yml` builds and pushes it to `ghcr.io/<owner>/alfred-setup` on every push to `main` that touches `crates/` or `.cloudshell/`. After the first run, make the package public once: GitHub → Packages → `alfred-setup` → Package settings → Change visibility → Public.

Open question to check in a real session: whether Cloud Shell pulls images from `ghcr.io`. If it does not, push the same image to a public Artifact Registry repository (`<region>-docker.pkg.dev/<project>/<repo>/alfred-setup`, with `allUsers` granted `roles/artifactregistry.reader`) and use that address in the link.

## The session is temporary

Cloud Shell opens repositories not owned by Google, and any `cloudshell_image`, in a temporary environment whose home directory is deleted when the session ends ([Open in Cloud Shell](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell)). For a custom image it first asks the user to **Trust** it; only a trusted session gets the user's credentials (the Cloud Run Button checks `TRUSTED_ENVIRONMENT=true` and then polls the metadata server until a service account appears). Consequences:

- The install itself works: everything that matters is created in the user's GCP project.
- Files the wizard writes locally (`.env`, `functions/.env.<project>`, `apps/web/.env.production.local`, `users/*.md`, the deploy log) are gone after the session. A later update must restore them from the user's project, not from Cloud Shell.

## What `cloudshell_open` does

1. Stops with an explanation when the session was opened as "Do not trust", then waits up to two minutes for Cloud Shell's credentials (the user may have to click **Authorize**).
2. Accepts only `https://github.com/<owner>/<repo>` URLs and rejects branch names that start with `-`.
3. Clones into `~/cloudshell_open/<repo>`, or fast-forwards an existing clone of the same repository.
4. Exports `ALFRED_SOURCE_REPO` and starts `alfred-setup`.

## Security

The image is public, so anyone can build a link that uses it with a different `cloudshell_git_repo`. The wizard therefore shows the source repository on its review screen and, when it is not `github.com/barissalihbabacan/Alfred`, warns in red that the code will run in the user's Google account and should be deployed only if trusted. Template copies trigger the same warning by design.

The wizard never writes API keys into the provisioning script: it passes them to the script's process as environment variables, and the script stores them in Secret Manager. The script itself runs from a private temporary directory (`0700`) that is deleted afterwards.

## Running the wizard elsewhere

On any machine with `gcloud` authenticated, Node.js 22 and Rust:

```bash
cargo run --release --manifest-path crates/alfred-setup/Cargo.toml
```

`--demo` walks through every screen with fake billing accounts and a harmless script, without calling `gcloud` or deploying anything; `--lang en|tr` picks the language (default: from `LANG`).
