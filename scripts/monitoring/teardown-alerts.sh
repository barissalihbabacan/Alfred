#!/usr/bin/env bash
# Removes what setup-alerts.sh created: every alert policy labelled
# managed_by=alfred-setup-alerts and the log-based metrics in metrics/*.json.
# With --delete-channels it also deletes the email notification channels
# carrying that label (channels created by hand are never touched).
#
# Dry-run by default; pass --apply to delete.
#
#   ./scripts/monitoring/teardown-alerts.sh --project butler-alfred
#   ./scripts/monitoring/teardown-alerts.sh --project butler-alfred --apply [--delete-channels]
set -euo pipefail

# shellcheck source=scripts/monitoring/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

PROJECT=""
APPLY=0
DELETE_CHANNELS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    --delete-channels) DELETE_CHANNELS=1; shift ;;
    -h|--help) usage 0 ;;
    *) log "Unknown argument: $1"; usage 1 ;;
  esac
done
[[ -n "$PROJECT" ]] || { log "--project is required"; usage 1; }
export APPLY

require_tools

if [[ "$APPLY" == "1" ]]; then
  log "== Removing Alfred alerting from project '$PROJECT' =="
else
  log "== DRY RUN for project '$PROJECT' (nothing is deleted; add --apply to delete) =="
fi

# Policies first: a policy still referencing a metric blocks nothing, but
# deleting them first avoids a window of "metric not found" alerts.
log ""
log "-- Alert policies labelled ${MANAGED_LABEL_KEY}=${MANAGED_LABEL_VALUE}"
policies="$(list_managed_policies "$PROJECT" | jq -r '.[] | [.name, .displayName] | @tsv')"
if [[ -z "$policies" ]]; then
  log "  none"
else
  while IFS=$'\t' read -r name display; do
    log "  delete '$display' ($name)"
    run "$GCLOUD" monitoring policies delete "$name" --project="$PROJECT" --quiet
  done <<<"$policies"
fi

log ""
log "-- Log-based metrics (metrics/*.json)"
for f in "$METRICS_DIR"/*.json; do
  name="$(metric_name_of "$f")"
  if metric_exists "$PROJECT" "$name"; then
    log "  delete $name"
    run "$GCLOUD" logging metrics delete "$name" --project="$PROJECT" --quiet
  else
    log "  $name: not present"
  fi
done

log ""
if [[ "$DELETE_CHANNELS" == "1" ]]; then
  log "-- Notification channels labelled ${MANAGED_LABEL_KEY}=${MANAGED_LABEL_VALUE}"
  channels="$(monitoring_api GET "projects/$PROJECT/notificationChannels?pageSize=200" \
    | jq -r --arg k "$MANAGED_LABEL_KEY" --arg v "$MANAGED_LABEL_VALUE" \
      '.notificationChannels[]? | select(.userLabels[$k]? == $v) | [.name, .displayName] | @tsv')"
  if [[ -z "$channels" ]]; then
    log "  none"
  else
    while IFS=$'\t' read -r name display; do
      log "  delete '$display' ($name)"
      if [[ "$APPLY" == "1" ]]; then
        monitoring_api DELETE "$name?force=true" >/dev/null
      else
        log "  [dry-run] DELETE $MONITORING_API/$name?force=true"
      fi
    done <<<"$channels"
  fi
else
  log "-- Notification channels kept (pass --delete-channels to remove the ones setup-alerts.sh created)"
fi

log ""
if [[ "$APPLY" == "1" ]]; then log "Done."; else log "Dry run finished. Re-run with --apply to delete."; fi
