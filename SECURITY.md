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

1. **Dual Whitelist Authorization**: Requests to Cloud Functions are strictly filtered by both `ALLOWED_EMAIL` and `ALLOWED_UID`. Unmatched callers are immediately rejected with HTTP 403.
2. **App Check Attestation**: Enforced at the gateway to guarantee requests originate from the genuine, unmodified web client.
3. **Secret Storage**: All production API keys live exclusively inside Google Secret Manager and are never baked into client bundles or repository files.
4. **Autonomous Secret Scrubbing**: All messages processed by the vector memory extraction pipeline are scrubbed with regex and heuristic privacy filters to prevent credentials, bearer tokens, and private keys from ever reaching Firestore.
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
