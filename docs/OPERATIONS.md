# Operations — alerting and runbook

Production (`butler-alfred`: Hosting + the `api` / `alfredCallable` Cloud Functions v2 on Cloud Run, us-central1) is watched by Cloud Monitoring alert policies that email the owner. Everything is defined in the repository and applied with one script:

```
scripts/monitoring/
  setup-alerts.sh      # create/update channel, metrics, policies (dry-run unless --apply)
  teardown-alerts.sh   # remove them again (dry-run unless --apply)
  common.sh            # shared helpers
  metrics/*.json       # log-based counter metrics (LogMetric JSON, file name = metric name)
  policies/*.json      # alert policies (AlertPolicy JSON; the script adds the notification channel)
```

`tests/unit/monitoring-config.test.ts` checks that every policy points at a defined metric, that every metric filters on an event the code really emits (`functions/index.js`, `functions/memory-persistence.js`, `src/ai/providers/chat-fallback/chat-turn.ts`), and that the outcome values the filters rely on are still logged. Renaming a log event or field therefore fails CI instead of silently disabling an alert.

## Alerts

| Policy (display name) | Severity | Fires when | Source |
| --- | --- | --- | --- |
| Alfred: chat turn failed (fallback exhausted) | CRITICAL | **any** `llm_request` with `outcome="error"` in 5 min | `alfred_chat_failures` |
| Alfred: 5xx responses from api / alfredCallable | CRITICAL | ≥ 3 responses with a 5xx code in 5 min | built-in `run.googleapis.com/request_count` |
| Alfred: function container failed to start | CRITICAL | **any** startup/crash signal in 5 min | `alfred_container_startup_failures` |
| Alfred: App Check rejecting requests | ERROR | ≥ 5 missing/invalid App Check tokens (probe paths excluded) in 10 min | `alfred_app_check_rejections` |
| Alfred: Cloud Functions deploy failed | ERROR | **any** failed Cloud Functions create/update/delete in 5 min | `alfred_function_deploy_failures` |
| Alfred: frequent chat provider fallbacks | WARNING | ≥ 3 `llm_provider_fallback` in 10 min | `alfred_provider_fallbacks` |
| Alfred: errors inside LLM response streams | WARNING | ≥ 3 `llm_stream_error` in 30 min | `alfred_llm_stream_errors` |
| Alfred: rate-limit give-ups | WARNING | ≥ 3 `llm_rate_limited` give-ups (`daily_limit` / `max_attempts` / `budget_exhausted`) in 30 min | `alfred_rate_limit_giveups` |
| Alfred: Gemini embedding errors | WARNING | ≥ 3 `embedding_error` in 30 min | `alfred_embedding_errors` |
| Alfred: memory extraction failing | WARNING | ≥ 3 `memory_extraction` with `outcome` `failed` / `timeout` in 1 h | `alfred_memory_extraction_failures` |

All policies use a sliding window (`ALIGN_SUM` over the window, `COMPARISON_GT`), fire on the first matching window (`duration: "0s"`), and auto-close after 30 min (deploy failures and memory extraction: 1 h). They set no `evaluationMissingData`: Cloud Monitoring rejects it on a zero-duration condition, so an incident stays open until the errors are gone for the auto-close period. Each email carries a short Turkish summary and the log query to start from (the `documentation` block of the policy).

### What the metrics count

| Metric | Log filter (all on `resource.type="cloud_run_revision"` unless noted) | Labels |
| --- | --- | --- |
| `alfred_chat_failures` | `jsonPayload.event="llm_request"`, `outcome="error"`. One per turn, written after the whole fallback chain (Groq → Gemini → OpenRouter), so this is "the user got an error". Fields to read: `provider`, `attempted_providers`, `fallback_from`, `skipped_providers`, `error`, `error_code`, `rate_limit_reason`, `rate_limit_type`. | `provider`, `error_code` |
| `alfred_provider_fallbacks` | `event="llm_provider_fallback"` (`from`, `from_model`, `to`, `to_model`, `reason`, `http_status`, `error`; `client_error` is logged at ERROR). | `from`, `to`, `reason` |
| `alfred_llm_stream_errors` | `event="llm_stream_error"` (`provider`, `model`, `round`, `code`, `detail`). | `provider`, `code` |
| `alfred_rate_limit_giveups` | `event="llm_rate_limited"` except `outcome="retry"` (a normal wait) and `outcome="fallback_preferred"` (deliberate skip to the next provider). | `provider`, `outcome`, `limit_type` |
| `alfred_app_check_rejections` | `event="app_check"`, `outcome` `missing` or `invalid`, `NOT exempt=true`. `missing` is only logged when enforcement rejects a non-exempt path; `invalid` is logged for every failed verification and now carries `path` / `exempt` so probes of `/`, `/api`, `/health` are ignored (older entries without the field are counted). | `outcome` |
| `alfred_embedding_errors` | `event="embedding_error"` (`model`, `http_status`). | `http_status` |
| `alfred_memory_extraction_failures` | `event="memory_extraction"`, `outcome` `failed` or `timeout`. The provider-level cause is in `memory_extraction_provider_error` / `memory_extraction_parse_error`. | `outcome` |
| `alfred_container_startup_failures` | services `api` / `alfredcallable`: `cloudaudit.googleapis.com/system_event` at ERROR (Ready condition False, e.g. "container failed to start and listen on the port"), `run.googleapis.com/varlog/system` at ERROR (failed startup probe), text "failed to start and listen on the port", or "Container called exit(N)" with N ≠ 0. | `service` |
| `alfred_function_deploy_failures` | `resource.type="cloud_function"`, `cloudaudit.googleapis.com/activity`, `protoPayload.serviceName="cloudfunctions.googleapis.com"`, severity ERROR. Catches manual `firebase deploy`s too, e.g. the 23 Sep 2026 "Secret environment variable overlaps non secret environment variable: GROQ_API_KEY". | `function` |

5xx uses Cloud Run's own `request_count` (`response_code_class="5xx"`, services `api` and `alfredcallable`) rather than a log metric: it is free and needs no filter maintenance. Note that `/chat` failures arrive inside a 200 SSE stream, so they show up in the chat-failure alert, not here; this one catches crashes, timeouts and platform errors (on 11 and 20 Sep 2026 `api` returned 500 "billing is disabled for this project").

### Baseline (logs of 10–24 Sep 2026)

Checked with read-only `gcloud logging read` before choosing thresholds: 4 final chat failures (all Groq TPD 429s on 24 Sep, before the Gemini/OpenRouter fallback was deployed — each would have fired the CRITICAL alert, correctly), 15 App Check rejections (13 `missing`, 2 `invalid`; a burst of 9 between 13:58 and 14:03 on 24 Sep would have fired the App Check alert), 1 memory extraction failure, 4 function deploy failures (23 Sep, secret overlap), 3 × 5xx (2 on 11 Sep, 1 on 20 Sep — below the ≥ 3 threshold), no fallbacks, stream errors, embedding errors or startup failures.

**Tuning.** Traffic is one person, so thresholds are low. If the 5xx alert should fire on a single 500 (the billing outages above would then have been caught), set `thresholdValue` to `0` in `policies/api_5xx.json` and re-run the setup script. Local `npm run dev:web` against production without a registered App Check debug token produces bursts of `missing` and can trigger the App Check alert; that is expected.

## Install, update, remove

Prerequisites: `gcloud` (GA components are enough; notification channels are created over the REST API), `jq`, `curl`, and an account with **Monitoring Editor** (`roles/monitoring.editor`) and **Logs Configuration Writer** (`roles/logging.configWriter`) on the project — the project owner has both.

```bash
# 1. Review what would happen (read-only lookups only, nothing is changed)
./scripts/monitoring/setup-alerts.sh --project butler-alfred --email <owner email>

# 2. Apply
./scripts/monitoring/setup-alerts.sh --project butler-alfred --email <owner email> --apply
```

The script is idempotent: it reuses an existing email channel for the same address, updates metrics that already exist (`gcloud logging metrics update --config-from-file`) and updates policies it finds by display name + the `managed_by=alfred-setup-alerts` label (`gcloud monitoring policies update --policy-from-file`). A policy on a brand-new log metric can be rejected for a minute until Monitoring sees the metric; the script retries creation up to 6 times, 20 s apart. After changing a JSON file, re-run step 2.

Check delivery once: console → Monitoring → Alerting → *Edit notification channels* → *Send test notification*.

Remove everything again (policies with the label, the metrics in `metrics/`, and with `--delete-channels` the channel the script created):

```bash
./scripts/monitoring/teardown-alerts.sh --project butler-alfred                       # dry run
./scripts/monitoring/teardown-alerts.sh --project butler-alfred --apply --delete-channels
```

## Cost

Figures as published on Google's pricing pages in Sep 2026 — check <https://cloud.google.com/products/observability/pricing> before relying on them.

- **Alerting policies**: charged since 2026 per *metric reference* (each condition is one): **$0.35 per condition per month**, plus **$0.50 per million points returned** by condition queries. These 10 single-condition policies cost about **$3.50/month**; the points returned by a handful of low-cardinality counters are a rounding error. To save money, drop the WARNING policies (delete their JSON files and run the teardown/setup pair, or delete them in the console): the five CRITICAL/ERROR policies alone are about $1.75/month.
- **Log-based metrics**: user-defined log metrics are chargeable Monitoring metrics, **$0.258/MiB** ingested after the **first 150 MiB per billing account per month**, which is free. These counters write a few points per minute only while errors happen; they stay far inside the free tier. Creating them does not add log volume (Cloud Logging ingestion is unchanged; its first 50 GiB/project/month are free).
- **`run.googleapis.com/request_count`** is a free system metric. Email notifications are free.

## Deploy failures and GitHub notifications

`deploy.yml` runs on pushes to `main` (in practice: merging a PR). When a workflow run fails, GitHub emails the **user who triggered it** — for a merge, the person who merged, i.e. the owner — as long as *Settings → Notifications → System → Actions* is set to email (default: "Only notify for failed workflows"). For a single-owner repository that is sufficient, so no notification step was added to the workflow (it would need a third-party secret such as an SMTP or Slack token). Two gaps it leaves, both covered here:

- a deploy that the Firebase CLI reports as failed only partially, or a manual `firebase deploy` from a laptop → **Alfred: Cloud Functions deploy failed** (activity audit log);
- a deploy that "succeeds" but whose new revision cannot start or crashes at runtime → **Alfred: function container failed to start** and **5xx**.

Keep the GitHub email notifications on; if someone else starts merging, they receive the failure email instead of the owner.

## Firestore backups

Firestore has no scheduled backup enabled (it is billed; this is the free alternative). `.github/workflows/backup.yml` runs every **Sunday 03:00 UTC** (and on demand: Actions → *Weekly Firestore backup* → *Run workflow*):

1. `npm run backup:firestore` (`scripts/backup-firestore.ts`) dumps every collection with its subcollections (`conversations/{id}/messages`, `memory_vectors`, …) to JSON. Timestamps, references, geopoints and bytes are tagged (`{"__type": "timestamp", …}`) so nothing is lost. The log shows document counts only.
2. The dump is encrypted with the `BACKUP_PASSPHRASE` secret (gpg, AES-256) and the plaintext is shredded.
3. Only the encrypted file is kept, as the artifact `firestore-backup-YYYY-MM-DD.json.gpg`, for **90 days** (about 13 weekly backups).

**One-time setup:** create the passphrase secret and keep the passphrase somewhere safe outside GitHub (a password manager). Without it the backups cannot be opened.

```bash
gh secret set BACKUP_PASSPHRASE
```

**Open a backup:** download the artifact from the workflow run (Actions → the run → *Artifacts*), unzip it, then:

```bash
gpg --decrypt firestore-backup-YYYY-MM-DD.json.gpg > firestore-backup.json
```

The JSON is `{ format: "alfred-firestore-backup/1", projectId, createdAt, collections: { name: [ { id, data, collections? } ] } }`. There is no automated restore yet: a lost document is written back by hand (or with a small script) from that file; the vector store is then rebuilt with `npm run memory:reindex`.

**Caveats:** artifacts are deleted after 90 days, so a backup older than that is gone. GitHub pauses scheduled workflows in a public repository after 60 days without repository activity; a push re-enables them (the run history shows when the last one ran).

## Preview channel

`.github/workflows/preview.yml` deploys the web app of every pull request that touches `apps/**` (or the package files / `firebase.json`) to the Hosting channel **`preview`** and comments its URL on the PR (`https://butler-alfred--preview-<hash>.web.app`). It is **UI only**: `/api/**` there still reaches the production `api` function and its data, so a preview shows real conversations. The channel is fixed so the URL stays the same; each deploy extends it by 30 days.

**One-time setup** (after the first preview deploy prints the URL), otherwise Google sign-in fails (`auth/unauthorized-domain`) and App Check rejects the requests:

1. Firebase console → Authentication → Settings → *Authorized domains* → add `butler-alfred--preview-<hash>.web.app`.
2. Google Cloud console → Security → reCAPTCHA → the key used by App Check → *Domains* → add the same domain.

Sign in once on the preview URL (sessions are per domain). If no PR deploys for 30 days the channel expires and the next one gets a new `<hash>`: repeat the two steps for the new URL.

## Runbook (Türkçe)

Her uyarı e-postası konuyu ve başlangıç log sorgusunu içerir. Loglar: Cloud Console → Logging → Logs Explorer, proje `butler-alfred`. Terminalden salt-okur sorgu:

```bash
gcloud logging read 'jsonPayload.event="llm_request" AND jsonPayload.outcome="error"' \
  --project=butler-alfred --freshness=1h --limit=20 --format=json
```

### Sohbet yanıtı verilemedi (CRITICAL)
Kullanıcı bir hata mesajı gördü; yedek zincir (Groq → Gemini → OpenRouter) tükendi ya da yedeğe geçilemeyen bir hata oldu.
1. `llm_request` kaydında `attempted_providers`, `fallback_from`, `skipped_providers`, `error_code`, `rate_limit_type` ve `error` alanlarına bakın.
2. `error_code="rate_limited"` ve `rate_limit_type="tpd"` ise Groq'un günlük kotası dolmuştur; `attempted_providers` içinde yalnızca `groq` varsa Gemini/OpenRouter anahtarları kullanılamıyor demektir (`skipped_providers`). Secret Manager'daki `GEMINI_API_KEY` / `OPENROUTER_API_KEY` değerlerini kontrol edin (`unset` ise o adım atlanır).
3. Aynı dakikalardaki `llm_provider_fallback` kayıtları her sağlayıcının neden düştüğünü (`reason`, `http_status`) gösterir. `client_error` (400/401/403/404) anahtar, model adı ya da istek gövdesi sorunudur; `server_error` / `network` sağlayıcı tarafındadır, genelde kendiliğinden düzelir.
4. Kullanıcı tarafında deneyin: uygulamadan kısa bir mesaj gönderin. Sorun sürüyorsa geçici olarak `CHAT_FALLBACK_ORDER` ile çalışan sağlayıcıyı öne alıp deploy edin.

### api 5xx hataları (CRITICAL)
1. `resource.type="cloud_run_revision" httpRequest.status>=500` ile hangi yol ve revizyon olduğunu bulun; aynı zaman aralığındaki `severity>=ERROR` loglarına bakın.
2. "billing is disabled for this project" → Faturalandırma hesabı devre dışı: Console → Billing'den projeyi yeniden bağlayın (11 ve 20 Eylül 2026'da oldu).
3. Zaman aşımı / bellek hatası → yeni bir deploy sonrası başladıysa önceki revizyona dönün: Console → Cloud Run → `api` → Revisions → önceki revizyona %100 trafik verin (`firebase hosting:rollback` yalnızca Hosting'i geri alır, fonksiyonları değil).
4. Kod hatasıysa düzeltmeyi PR ile gönderin; `main`'e birleşince deploy otomatik çalışır.

### Fonksiyon başlatılamadı / çöktü (CRITICAL)
1. Cloud Run → `api` (veya `alfredcallable`) → Revisions: en son revizyon "Ready" değilse mesajı okuyun ("failed to start and listen on the port" genelde modül yükleme hatasıdır).
2. `resource.labels.service_name="api" severity>=ERROR` ile konteyner stderr'indeki yığın izine bakın. Sık nedenler: paket `functions/package.json` `dependencies` içinde yok, `functions/lib/index.js` eski/bozuk, bağlı bir secret eksik.
3. Hemen düzelmeyecekse trafiği son sağlıklı revizyona verin (Cloud Run → Revisions → Manage traffic). Sonra `npm run build --prefix functions && npm run check:bundle --prefix functions` ile yerelde doğrulayıp düzeltmeyi gönderin.

### App Check istekleri reddediyor (ERROR)
1. `jsonPayload.event="app_check"` kayıtlarında `outcome` ve `path`'e bakın. Kendi yerel geliştirme oturumunuzsa (`npm run dev:web` üretim API'sine karşı, debug token kayıtlı değil) bekleneni budur, yok sayın.
2. Gerçek tarayıcıdan geliyorsa: reklam engelleyici reCAPTCHA'yı engelliyor olabilir; sayfayı yenileyin.
3. `invalid` çoğalıyorsa Firebase Console → App Check → reCAPTCHA Enterprise anahtarının ve alan adlarının (`butler-alfred.web.app`) hâlâ geçerli olduğunu kontrol edin.
4. Acil durumda korumayı geçici kapatmak mümkündür: `ENFORCE_APP_CHECK=false` ile deploy (ID token + UID kontrolü yine devrededir). Sorun giderilince geri açın.

### Cloud Functions deploy başarısız (ERROR)
1. `resource.type="cloud_function" severity>=ERROR` kaydındaki `protoPayload.status.message`'ı okuyun.
2. "Secret environment variable overlaps non secret environment variable" → `functions/.env` içinde `GROQ_API_KEY` / `GEMINI_API_KEY` gibi bir secret adı var ya da Cloud Run servisinde düz değişken olarak kalmış: dosyadan silin; gerekiyorsa Console → Cloud Run → `api` → Edit → Variables & Secrets'tan düz değişkeni kaldırıp yeniden deploy edin (bkz. CLAUDE.md **Secrets**).
3. "Secret … not found" → eksik secret'ı oluşturun (anahtar yoksa değer `unset`).
4. GitHub Actions'taki başarısız çalıştırmanın loguna da bakın; aynı hata orada da görünür.

### Sağlayıcı yedeğe sık geçiyor (WARNING)
Yanıtlar büyük ihtimalle yedek sağlayıcıdan geliyor. `llm_provider_fallback` kayıtlarında `from` ve `reason`'a bakın. `rate_limited` ise Groq kotası (dakikalık ya da günlük) doluyordur; `client_error` ise o sağlayıcının anahtarını/model adını düzeltin. Sürekli oluyorsa birincil sağlayıcıyı değiştirmeyi (`CHAT_FALLBACK_ORDER`) ya da Groq planını yükseltmeyi düşünün.

### LLM akışında hata (WARNING)
Sağlayıcı SSE akışı içinde hata nesnesi döndü. `llm_stream_error` kaydındaki `provider`, `code` ve `detail`'e bakın. Tek sağlayıcıda yoğunlaşıyorsa sağlayıcının durum sayfasını kontrol edin; yedek zincir bu turları genelde kurtarır.

### Hız sınırı: sunucu beklemeden vazgeçiyor (WARNING)
`llm_rate_limited` kayıtlarında `outcome` ve `limit_type`'a bakın. `daily_limit` / `tpd` ise Groq'un günlük token kotası (200.000) dolmuştur ve `retry_after_ms` sonra açılır; bu arada yedek sağlayıcılar devreye girer. Sık tekrarlanıyorsa sistem isteminin boyutunu (`tests/unit/system-prompt-budget.test.ts`) ve konuşma geçmişini gözden geçirin ya da ücretli plana geçin.

### Gemini embedding hataları (WARNING)
Uzun süreli hafıza okuması/yazması embedding olmadan çalışıyor. `embedding_error` kaydındaki `http_status`: 429 kota, 400/403 anahtar veya model (`gemini-embedding-001`) sorunudur. `GEMINI_API_KEY` secret'ını ve Google AI Studio kotasını kontrol edin. Üretimde embedding alınamayan turdan hafıza kaydı yazılmaz; düzeldikten sonra ek bir işlem gerekmez.

### Hafıza çıkarımı başarısız (WARNING)
Sohbet etkilenmez; yalnızca bu turlardan yeni hafıza yazılmaz. Aynı zamandaki `memory_extraction_provider_error` (sağlayıcı, `http_status`, `limit_type`) ve `memory_extraction_parse_error` kayıtlarına bakın. Genelde Groq 429'dur (`MEMORY_EXTRACTION_MODEL`, varsayılan `openai/gpt-oss-20b`) ve kendiliğinden düzelir; `timeout` ise çıkarım bütçesi aşılıyor demektir.
