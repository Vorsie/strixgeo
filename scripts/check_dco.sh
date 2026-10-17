#!/usr/bin/env bash
# Every commit in the range must carry a Signed-off-by trailer (DCO).
set -euo pipefail
range="${1:?usage: check_dco.sh <base>..<head>}"
# --no-merges: GitHub's "Update branch" merge commits carry no sign-off, and
# linear history is enforced at merge time anyway.
bad=0
while read -r sha; do
  if ! git log -1 --format=%B "$sha" | grep -qE '^Signed-off-by: .+ <.+@.+>$'; then
    echo "missing Signed-off-by: $(git log -1 --format='%h %s' "$sha")"
    bad=1
  fi
done < <(git rev-list --no-merges "$range")
exit $bad
