# Security Policy

## Supported Versions

We provide security updates and patches for the current release on the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 0.1   | :x:                |

---

## Security Architecture Highlights

Alfred is designed with defense-in-depth principles:

1. **Single-User Authorization**: Every Cloud Functions request needs a valid Firebase ID token whose UID matches `ALLOWED_UID` and whose verified Google e-mail matches `ALLOWED_EMAIL`, for whichever of the two is set (setup sets the e-mail). Anyone else is rejected with HTTP 401/403, and with neither set the API refuses every request (503); there is no hardcoded fallback user.
2. **App Check Attestation**: Enforced at the gateway once it is set up. A fresh install starts with `ENFORCE_APP_CHECK=false`, because the web app has no reCAPTCHA key yet; turning it on is the last, optional step of setup (`docs/OPERATIONS.md`).
3. **Secret Storage**: All production API keys live exclusively inside Google Secret Manager and are never baked into client bundles or repository files.
4. **Privacy Filter for Long-Term Memory**: Facts extracted for long-term memory are checked by a regex and heuristic privacy filter, and candidates containing credentials, bearer tokens or private keys are rejected before they are stored. Conversation history itself is stored verbatim in Firestore.
5. **Zero-Trust Firestore Rules**: Client SDK direct reads and writes are blocked (`allow read, write: if false;`). All mutations strictly pass through Cloud Functions.
6. **Automated CI Security Scans**: Every commit and pull request is scanned with:
   - **Gitleaks**: Detects accidental secret, API key, and credential leaks.
   - **GitHub CodeQL**: Deep AST static analysis (SAST) for TypeScript and JavaScript vulnerabilities.
   - **Dependabot**: Automated weekly scanning and patching of dependency CVEs.

---

## Reporting a Vulnerability

If you discover a security vulnerability in Alfred, please **do not** open a public issue.

Instead, please report the vulnerability confidentially via:

- **GitHub Private Vulnerability Reporting**: [Report a vulnerability](https://github.com/barissalihbabacan/Alfred/security/advisories/new)

Please include:
- A description of the vulnerability.
- Steps to reproduce or proof-of-concept.
- Potential impact and affected components.

We will acknowledge your report within 48 hours and work with you to patch and disclose the issue responsibly.
