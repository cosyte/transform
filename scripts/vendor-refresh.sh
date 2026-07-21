#!/usr/bin/env bash
#
# vendor-refresh.sh — regenerate the vendored @cosyte sibling tarballs.
#
# @cosyte/transform depends on two UNPUBLISHED cosyte siblings — @cosyte/hl7 and
# @cosyte/fhir — that are not yet on npm. Exactly like @cosyte/mllp consumes
# @cosyte/hl7 today (umbrella ADR 0008), we consume them as vendored `pnpm pack`
# tarballs pinned to a known-good sibling commit, wired as `file:` devDependencies
# so transform's own tests build against them while third-party RUNTIME deps stay
# at zero (see documentation/decisions/0019). This is READ-ONLY on the sibling
# repos: it builds + packs them in place and copies the tarball here; it never
# commits, mutates source, or touches their git state.
#
# Usage (run from the transform repo root, with ../hl7 and ../fhir checked out):
#   pnpm vendor:refresh
#
# Pinned sibling commits (record every bump here AND in the CHANGELOG):
#   @cosyte/hl7  → 46d50eb775dc6576cec8ca5a2315720a65cb7418  (v0.0.1)
#   @cosyte/fhir → 7a099b24e399b91d780be8110c529bc570756cfe  (v0.0.0)
#
# After a refresh: `pnpm install`, then `pnpm test` + `pnpm build` to confirm the
# new sibling surface still satisfies transform. Bumping a pin is a deliberate act
# — a sibling API change can break the mappings; re-run the conformance gate.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vendor="${here}/vendor"
mkdir -p "${vendor}"

refresh() {
  local name="$1" repo="$2" out="$3"
  local repo_dir="${here}/../${repo}"
  if [[ ! -d "${repo_dir}" ]]; then
    echo "vendor-refresh: sibling repo not found: ${repo_dir}" >&2
    echo "  clone the ${name} repo next to transform/ and retry." >&2
    exit 1
  fi
  echo "vendor-refresh: building + packing ${name} from ${repo_dir}"
  pnpm -C "${repo_dir}" build
  # --out resolves relative to -C; use an absolute path so it lands here.
  pnpm -C "${repo_dir}" pack --out "${vendor}/${out}"
  echo "vendor-refresh: wrote ${vendor}/${out}"
}

refresh "@cosyte/hl7"  hl7  cosyte-hl7-0.0.0.tgz
refresh "@cosyte/fhir" fhir cosyte-fhir-0.0.0.tgz

echo "vendor-refresh: done. Now run: pnpm install && pnpm test && pnpm build"
