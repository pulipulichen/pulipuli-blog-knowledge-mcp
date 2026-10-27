#!/usr/bin/env bash
set -euo pipefail
: "${INGEST_URL:?Set the INGEST_URL repository secret}"
: "${INGEST_TOKEN:?Set the INGEST_TOKEN repository secret}"

request_body='{}'
if [[ "${RESET_BACKFILL:-false}" == "true" ]]; then request_body='{"reset":true}'; fi
max_error_attempts="${INGEST_MAX_ERROR_ATTEMPTS:-24}"
max_lock_wait="${INGEST_MAX_LOCK_WAIT_SECONDS:-1200}"
max_batches="${INGEST_MAX_BATCHES:-10000}"
response_file="$(mktemp)"
headers_file="$(mktemp)"
trap 'rm -f "${response_file}" "${headers_file}"' EXIT

done=false
total_scanned=0
total_inserted=0
total_updated=0
total_unchanged=0
total_failed=0

for ((batch_number=1; batch_number<=max_batches; batch_number++)); do
  error_attempts=0
  batch_started="$(date +%s)"
  while :; do
    curl_exit=0
    # Clear files so a failed connection cannot replay the previous result.
    : > "${response_file}"
    : > "${headers_file}"
    if http_status="$(curl --silent --show-error \
      --output "${response_file}" --dump-header "${headers_file}" --write-out '%{http_code}' \
      --connect-timeout 15 --max-time 120 \
      -X POST "${INGEST_URL}" \
      -H "Authorization: Bearer ${INGEST_TOKEN}" \
      -H "Content-Type: application/json" -d "${request_body}")"; then
      :
    else
      curl_exit=$?
    fi
    response="$(cat "${response_file}")"
    if [[ "${curl_exit}" -eq 0 && "${http_status}" == "200" ]]; then
      if ! jq -e '(.done | type) == "boolean" and (.scanned | type) == "number" and (.failed | type) == "number"' <<< "${response}" >/dev/null; then
        echo "::error::Worker returned HTTP 200 without a valid ingestion result: ${response:0:500}" >&2
        exit 1
      fi
      break
    fi

    retry_after="$(awk 'tolower($1) == "retry-after:" {gsub("\r", "", $2); value=$2} END {print value}' "${headers_file}")"
    cf_ray="$(awk 'tolower($1) == "cf-ray:" {gsub("\r", "", $2); value=$2} END {print value}' "${headers_file}")"
    if [[ "${curl_exit}" -eq 0 && "${http_status}" == "409" ]] && \
      jq -e '.error.code == "ingestion_already_running"' <<< "${response}" >/dev/null 2>&1; then
      # Lock polls do not consume the upstream-error retry budget. In particular,
      # an old deployment's 15-minute lease must be allowed to expire once.
      elapsed=$(( $(date +%s) - batch_started ))
      if (( elapsed >= max_lock_wait )); then
        echo "::error::Ingestion batch ${batch_number} remained locked for ${elapsed}s: ${response:0:800}" >&2
        exit 1
      fi
      echo "::notice::Batch ${batch_number} is waiting for the ingestion lease (${elapsed}s elapsed)."
      jq -r '"  Lock expires at: \(.progress.lockExpiresAt); remaining: \(.progress.remainingLockSeconds)s; phase: \(.progress.current.phase // "unavailable")", (.progress.current.articles[]? | "  Title: \(.title)\n  URL: \(.url)")' <<< "${response}"
      retry_delay=20
    else
      error_attempts=$((error_attempts + 1))
      # Preserve the original platform response. Previously a 503 was discarded,
      # leaving only its later 409 lock conflicts in the final error message.
      diagnostic="$(printf '%s' "${response}" | tr '\r\n' '  ')"
      resource_error="$(printf '%s' "${response}" | grep -Eio 'error( code:)? [0-9]{4}|Worker exceeded resource limits|Worker threw exception' | head -5 | tr '\r\n' '  ' || true)"
      echo "::warning::Batch ${batch_number}: HTTP ${http_status}, curl ${curl_exit}, CF-Ray ${cf_ray:-unavailable}; ${resource_error} response: ${diagnostic:0:1000}"
      retryable=false
      case "${http_status}" in
        409|408|425|429|500|502|503|504) retryable=true ;;
      esac
      if [[ "${curl_exit}" -ne 0 ]]; then retryable=true; fi
      if [[ "${retryable}" != "true" ]] || (( error_attempts >= max_error_attempts )); then
        echo "::error::Ingestion batch ${batch_number} failed after ${error_attempts} upstream error(s)." >&2
        exit 1
      fi
      if (( error_attempts < 5 )); then retry_delay=$((2 ** error_attempts)); else retry_delay=60; fi
    fi

    if [[ "${retry_after}" =~ ^[0-9]+$ ]] && (( retry_after > retry_delay )); then retry_delay="${retry_after}"; fi
    if (( retry_delay > 60 )); then retry_delay=60; fi
    echo "Retrying batch ${batch_number} in ${retry_delay}s (${error_attempts}/${max_error_attempts} upstream errors)."
    sleep "${retry_delay}"
  done
  request_body='{}'

  echo "::group::Batch ${batch_number}: article results"
  jq '{mode, done, scanned, inserted, updated, unchanged, failed, retrying, errors}' <<< "${response}"
  jq -r '.articles[]? | "[\(.status)] \(.title)\nURL: \(.url)\(if .error then "\nError: " + .error else "" end)"' <<< "${response}"
  echo "::endgroup::"
  total_scanned=$((total_scanned + $(jq -r '.scanned // 0' <<< "${response}")))
  total_inserted=$((total_inserted + $(jq -r '.inserted // 0' <<< "${response}")))
  total_updated=$((total_updated + $(jq -r '.updated // 0' <<< "${response}")))
  total_unchanged=$((total_unchanged + $(jq -r '.unchanged // 0' <<< "${response}")))
  total_failed=$((total_failed + $(jq -r '.failed // 0' <<< "${response}")))
  done="$(jq -r '.done // false' <<< "${response}")"
  if [[ "${done}" == "true" ]]; then break; fi
  sleep 1
done

if [[ "${done}" != "true" ]]; then
  echo "::error::Ingestion did not finish within ${max_batches} batches; resume from the saved Worker checkpoint." >&2
  exit 1
fi
echo "Completed: scanned=${total_scanned}, inserted=${total_inserted}, updated=${total_updated}, unchanged=${total_unchanged}, failed=${total_failed}"
if (( total_failed > 0 )); then
  echo "::warning::${total_failed} article attempt(s) failed; their details were saved in D1 for retry during later runs."
fi
