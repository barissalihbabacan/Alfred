# Cloud Shell launch

How the README's **Launch Alfred Setup** button starts the setup wizard.

## The link

```text
https://ssh.cloud.google.com/cloudshell/editor
  ?cloudshell_git_repo=https://github.com/<owner>/<repo>
  &cloudshell_tutorial=.cloudshell/tutorial.md
```

Cloud Shell clones the repository and opens `.cloudshell/tutorial.md` next to the terminal ([Open in Cloud Shell](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell)). Its first step is one command, `bash .cloudshell/start.sh`, which the user clicks into the terminal and runs.

Cloud Shell opens repositories not owned by Google in a temporary environment whose home directory is deleted when the session ends, without the user's credentials until they sign in. Everything that matters is created in the user's own Google Cloud project, so the install itself does not depend on the session; files the wizard writes locally (`.env`, `functions/.env.<project>`, `apps/web/.env.production.local`, `users/*.md`, the deploy log) are lost afterwards.

## What `start.sh` does

1. In Cloud Shell (Linux x86_64): downloads `alfred-setup-x86_64-unknown-linux-musl` and `SHA256SUMS` from the latest GitHub release, refuses to run on a checksum mismatch, and runs the binary from a private temp directory that is removed afterwards.
2. Signs gcloud in when no account is active (`gcloud auth login --update-adc`, which also gives `firebase-tools` application-default credentials).
3. Exports `ALFRED_SOURCE_REPO` (the clone's `origin`); the wizard warns on its review screen when it is not `github.com/barissalihbabacan/Alfred`, since the code will run in the user's Google account.
4. Elsewhere, or when the download fails, builds the wizard with `cargo run --release`.

The binary comes from `.github/workflows/release-binaries.yml`, which builds it at the release tag and uploads it with its checksum whenever a release is published (or by hand: Actions → Release binaries → Run workflow, with the tag). The cloned repository may be ahead of the latest release; the wizard only drives the provisioning script it generates itself, so this is safe as long as the script's `[Alfred Setup]` markers stay compatible.

## History

An earlier version opened Cloud Shell with a custom image (`cloudshell_image`) that started the wizard by itself. The image extends Cloud Shell's ~5.6 GB base image; pulled from GitHub Container Registry, Cloud Shell failed to provision the VM, and refreshing opened a plain session without the repository. The tutorial costs one extra click but needs no image.

## Running the wizard elsewhere

On any machine with `gcloud` authenticated, Node.js 22 and Rust: `npm run setup` (`-- --demo` walks every screen without calling `gcloud` or deploying; `-- --lang en|tr` picks the language).
