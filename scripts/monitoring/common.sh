# shellcheck shell=bash
# Shared helpers for setup-alerts.sh / teardown-alerts.sh. Sourced, not run.

MONITORING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METRICS_DIR="$MONITORING_DIR/metrics"
POLICIES_DIR="$MONITORING_DIR/policies"
# Every resource these scripts create carries this user label, so teardown
# and re-runs only ever touch what the scripts own.
MANAGED_LABEL_KEY="managed_by"
MANAGED_LABEL_VALUE="alfred-setup-alerts"
MONITORING_API="https://monitoring.googleapis.com/v3"

GCLOUD="${GCLOUD:-gcloud}"
if ! command -v "$GCLOUD" >/dev/null 2>&1 && [[ -x "$HOME/google-cloud-sdk/bin/gcloud" ]]; then
  GCLOUD="$HOME/google-cloud-sdk/bin/gcloud"
fi

log() { printf '%s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Prints the command instead of running it unless APPLY=1.
run() {
  if [[ "${APPLY:-0}" == "1" ]]; then
    "$@"
  else
    printf '  [dry-run] %s\n' "$(printf '%q ' "$@")" >&2
  fi
}

require_tools() {
  local t
  for t in "$GCLOUD" jq curl; do
    command -v "$t" >/dev/null 2>&1 || die "'$t' is required but not installed."
  done
}

# Checks that every definition file is valid JSON with the fields the scripts use.
validate_definitions() {
  local f
  for f in "$METRICS_DIR"/*.json; do
    jq -e '.filter and .metricDescriptor.metricKind == "DELTA"' "$f" >/dev/null \
      || die "invalid metric definition: $f"
  done
  for f in "$POLICIES_DIR"/*.json; do
    jq -e --arg k "$MANAGED_LABEL_KEY" --arg v "$MANAGED_LABEL_VALUE" \
      '.displayName and (.conditions | length > 0) and .alertStrategy.autoClose and .userLabels[$k] == $v' \
      "$f" >/dev/null || die "invalid policy definition: $f"
  done
}

access_token() {
  "$GCLOUD" auth print-access-token 2>/dev/null
}

# Authenticated Monitoring REST call: monitoring_api METHOD PATH [JSON_BODY].
# Notification channels are managed over REST because `gcloud monitoring
# channels` only exists in the alpha/beta gcloud components.
monitoring_api() {
  local method="$1" path="$2" body="${3:-}" token
  token="$(access_token)" || die "gcloud is not authenticated (run: gcloud auth login)."
  local args=(-sS --fail-with-body -X "$method" -H "Authorization: Bearer $token" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}" "$MONITORING_API/$path"
}

metric_name_of() { basename "$1" .json; }

# Name (projects/…/alertPolicies/…) of the managed policy with this display
# name, or empty.
find_policy() {
  local project="$1" display="$2"
  list_managed_policies "$project" \
    | jq -r --arg d "$display" '[.[] | select(.displayName == $d)][0].name // empty'
}

# JSON array of the alert policies carrying the managed_by label. Filtered
# with jq rather than --filter, which warns when no policy has the label.
list_managed_policies() {
  "$GCLOUD" monitoring policies list --project="$1" --format=json \
    | jq --arg k "$MANAGED_LABEL_KEY" --arg v "$MANAGED_LABEL_VALUE" \
      '[.[] | select(.userLabels[$k]? == $v)]'
}

metric_exists() {
  "$GCLOUD" logging metrics describe "$2" --project="$1" >/dev/null 2>&1
}
