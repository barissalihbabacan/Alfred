#!/usr/bin/env bash
# Creates (or updates) Alfred's production alerting in Cloud Monitoring:
#   1. an email notification channel,
#   2. the log-based counter metrics in metrics/*.json,
#   3. the alert policies in policies/*.json, wired to that channel.
#
# Idempotent: re-running updates the metrics and policies in place (policies
# are matched by display name + the managed_by=alfred-setup-alerts label) and
# reuses an existing email channel for the same address.
#
# Dry-run by default: it only runs read-only lookups and prints what it would
# create or update. Pass --apply to make changes.
#
#   ./scripts/monitoring/setup-alerts.sh --project <your-project-id> --email you@example.com
#   ./scripts/monitoring/setup-alerts.sh --project <your-project-id> --email you@example.com --apply
#
# See docs/OPERATIONS.md for what each alert means and what to do about it.
set -euo pipefail

# shellcheck source=scripts/monitoring/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

PROJECT=""
EMAIL=""
APPLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --email=*) EMAIL="${1#*=}"; shift ;;
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    -h|--help) usage 0 ;;
    *) log "Unknown argument: $1"; usage 1 ;;
  esac
done
[[ -n "$PROJECT" ]] || { log "--project is required"; usage 1; }
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { log "--email must be an email address"; usage 1; }
export APPLY

require_tools
validate_definitions

if [[ "$APPLY" == "1" ]]; then
  log "== Applying alerting setup to project '$PROJECT' =="
else
  log "== DRY RUN for project '$PROJECT' (nothing is changed; add --apply to create) =="
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# --- 1. Email notification channel -----------------------------------------
log ""
log "-- Notification channel (email: $EMAIL)"
if ! channels_json="$(monitoring_api GET "projects/$PROJECT/notificationChannels?pageSize=200")"; then
  [[ "$APPLY" == "1" ]] && die "could not list notification channels (is the Monitoring API enabled, do you have access?)"
  log "  WARNING: could not list notification channels; assuming none exist"
  channels_json='{}'
fi
CHANNEL="$(jq -r --arg e "$EMAIL" \
  '[.notificationChannels[]? | select(.type == "email" and .labels.email_address == $e)][0].name // empty' \
  <<<"$channels_json")"
if [[ -n "$CHANNEL" ]]; then
  log "  reuse existing channel $CHANNEL"
else
  channel_body="$(jq -n --arg e "$EMAIL" --arg k "$MANAGED_LABEL_KEY" --arg v "$MANAGED_LABEL_VALUE" '{
    type: "email",
    displayName: ("Alfred alerts (" + $e + ")"),
    description: "Created by scripts/monitoring/setup-alerts.sh",
    labels: { email_address: $e },
    userLabels: { ($k): $v },
    enabled: true
  }')"
  if [[ "$APPLY" == "1" ]]; then
    CHANNEL="$(monitoring_api POST "projects/$PROJECT/notificationChannels" "$channel_body" | jq -r .name)"
    [[ -n "$CHANNEL" && "$CHANNEL" != "null" ]] || die "could not create the notification channel"
    log "  created channel $CHANNEL"
  else
    log "  [dry-run] would create email channel: $(jq -c . <<<"$channel_body")"
    CHANNEL="projects/$PROJECT/notificationChannels/DRY_RUN_CHANNEL_ID"
  fi
fi

# --- 2. Log-based metrics ---------------------------------------------------
log ""
log "-- Log-based metrics (metrics/*.json)"
for f in "$METRICS_DIR"/*.json; do
  name="$(metric_name_of "$f")"
  if metric_exists "$PROJECT" "$name"; then
    log "  update $name"
    run "$GCLOUD" logging metrics update "$name" --project="$PROJECT" --config-from-file="$f" --quiet
  else
    log "  create $name"
    run "$GCLOUD" logging metrics create "$name" --project="$PROJECT" --config-from-file="$f" --quiet
  fi
done

# --- 3. Alert policies ------------------------------------------------------
log ""
log "-- Alert policies (policies/*.json) -> $CHANNEL"
for f in "$POLICIES_DIR"/*.json; do
  display="$(jq -r .displayName "$f")"
  rendered="$TMP_DIR/$(basename "$f")"
  jq --arg ch "$CHANNEL" '.notificationChannels = [$ch]' "$f" >"$rendered"
  existing="$(find_policy "$PROJECT" "$display")"
  if [[ -n "$existing" ]]; then
    log "  update '$display' ($existing)"
    run "$GCLOUD" monitoring policies update "$existing" --project="$PROJECT" --policy-from-file="$rendered" --quiet
  else
    log "  create '$display'"
    if [[ "$APPLY" == "1" ]]; then
      # A brand-new log-based metric can take a minute to become visible to
      # Monitoring; creating a policy on it before that fails, so retry.
      for attempt in 1 2 3 4 5 6; do
        if "$GCLOUD" monitoring policies create --project="$PROJECT" --policy-from-file="$rendered" --quiet; then
          break
        fi
        [[ "$attempt" == "6" ]] && die "could not create policy '$display'"
        log "    retrying in 20 s (metric may not be visible yet)…"
        sleep 20
      done
    else
      run "$GCLOUD" monitoring policies create --project="$PROJECT" --policy-from-file="$rendered" --quiet
    fi
  fi
done

log ""
if [[ "$APPLY" == "1" ]]; then
  log "Done. To check delivery: console -> Monitoring -> Alerting -> Edit notification channels -> Send test notification."
  log "Policies: https://console.cloud.google.com/monitoring/alerting/policies?project=$PROJECT"
else
  log "Dry run finished. Re-run with --apply to make these changes."
fi
