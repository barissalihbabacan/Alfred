# Alfred Setup

The **Launch Alfred Setup** button in the README opens Cloud Shell with Alfred's own image, and the setup wizard starts in the terminal by itself. If you are reading this tutorial instead, Cloud Shell opened without that image. You can still start the wizard yourself.

## Start the wizard

The wizard is a Rust program in this repository. Build and start it:

```bash
cargo run --release --manifest-path crates/alfred-setup/Cargo.toml
```

If Cloud Shell says `cargo: command not found`, install Rust first and run the command again:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && . "$HOME/.cargo/env"
```

## In the wizard

1. **Project:** type a project ID or press **Ctrl+G** for a new one, choose a billing account and the Firestore region.
2. **Account:** the Google e-mail that will be the only one allowed to sign in.
3. **API keys:** EVREN, Groq, Gemini and Tavily, all optional and stored in Secret Manager.
4. **Review:** press **Enter**; the live log shows every step up to the deploy.
5. **Done:** enable Google sign-in with the link the wizard shows, then open `https://<project-id>.web.app`.

Press **F2** at any time to switch between English and Turkish.
