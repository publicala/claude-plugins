#!/bin/sh
# Installs each package in CLOUD_ARTIFACTS_PACKAGES from the artifact store
# at CLOUD_ARTIFACTS_URL. Reports one line per package as session context, and
# always exits 0 so a store outage never blocks a session.

[ -n "${CLOUD_ARTIFACTS_URL:-}" ] || exit 0
[ -n "${CLOUD_ARTIFACTS_PACKAGES:-}" ] || exit 0

# The environment's network secret replaces this placeholder on the way out,
# so the real token never enters the session.
token="${CLOUD_ARTIFACTS_TOKEN:-network-secret}"
store="${CLOUD_ARTIFACTS_URL%/}"
install_root="${CLOUD_ARTIFACTS_HOME:-$HOME/.local/share/cloud-artifacts}"
skills_directory="$HOME/.claude/skills"
# Stays under the hook's 120 s timeout, which discards all output when it fires.
deadline=$(($(date +%s) + ${CLOUD_ARTIFACTS_BUDGET_SECONDS:-100}))
bin_directory="$HOME/.local/bin"

report_file=$(mktemp) || exit 0
trap 'rm -f "$report_file"' EXIT
skills_changed=false

report() {
  printf 'cloud-artifacts: %s\n' "$*" >>"$report_file"
}

# Skill discovery runs before SessionStart hooks finish, so a hook that links
# a skill asks Claude Code to scan again.
print_hook_output() {
  if ! command -v jq >/dev/null 2>&1; then
    cat "$report_file"
    return
  fi

  [ -s "$report_file" ] || [ "$skills_changed" = true ] || return 0

  jq --null-input --rawfile context "$report_file" --argjson reload "$skills_changed" \
    '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $context, reloadSkills: $reload}}'
}

add_bin_directory_to_path() {
  [ -n "${CLAUDE_ENV_FILE:-}" ] || return 0

  case ":$PATH:" in
    *":$bin_directory:"*) return 0 ;;
  esac

  # $PATH expands when the session sources the file.
  # shellcheck disable=SC2016
  printf 'export PATH="%s:$PATH"\n' "$bin_directory" >>"$CLAUDE_ENV_FILE"
}

detect_platform() {
  case "$(uname -s)" in
    Linux) system=linux ;;
    Darwin) system=macos ;;
    *) return 1 ;;
  esac

  case "$(uname -m)" in
    x86_64 | amd64) machine=x86_64 ;;
    aarch64 | arm64) machine=arm64 ;;
    *) return 1 ;;
  esac

  printf '%s-%s\n' "$system" "$machine"
}

seconds_left() {
  echo $((deadline - $(date +%s)))
}

fetch() {
  curl --fail --silent --show-error --location --max-time "$(seconds_left)" \
    --header "Authorization: Bearer $token" "$@"
}

file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Links the package's skill and executables. A real directory or file
# someone put there stays untouched.
link_package() {
  package=$1
  destination=$2

  if [ -f "$destination/SKILL.md" ]; then
    mkdir -p "$skills_directory"

    if [ -e "$skills_directory/$package" ] && [ ! -L "$skills_directory/$package" ]; then
      report "$package: $skills_directory/$package exists and is not a link, so the skill was not linked"
    else
      ln -sfn "$destination" "$skills_directory/$package"
      skills_changed=true
    fi
  fi

  unlink_previous_executables "$package"

  [ -d "$destination/bin" ] || return 0
  mkdir -p "$bin_directory"

  for executable in "$destination"/bin/*; do
    [ -f "$executable" ] && [ -x "$executable" ] || continue
    target="$bin_directory/$(basename "$executable")"

    if [ -e "$target" ] && [ ! -L "$target" ]; then
      report "$package: $target exists and is not a link, so it was not replaced"
    else
      ln -sfn "$executable" "$target"
    fi
  done
}

# Removes the links an earlier version of the package created, so an
# executable a release drops stops resolving.
unlink_previous_executables() {
  for link in "$bin_directory"/*; do
    [ -L "$link" ] || continue

    case "$(readlink "$link")" in
      "$install_root/$1/"*) rm -f "$link" ;;
    esac
  done
}

install_package() {
  package=$1

  case "$package" in
    '' | *[!a-z0-9-]* | -*)
      report "skipped '$package': a package name uses lowercase letters, digits and hyphens"
      return 0
      ;;
  esac

  if ! manifest=$(fetch "$store/v1/$package/latest" 2>&1); then
    report "$package: unable to read the latest release from the store: $manifest"
    return 0
  fi

  version=$(printf '%s' "$manifest" | jq -r '.version // empty')
  entry=$(printf '%s' "$manifest" | jq -c --arg platform "$platform" \
    'first(.files[]? | select(.platform == $platform)) // empty')

  if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    report "$package: the store's manifest has no valid version"
    return 0
  fi

  if [ -z "$entry" ]; then
    report "$package $version: no build for $platform"
    return 0
  fi

  name=$(printf '%s' "$entry" | jq -r '.name')
  sha256=$(printf '%s' "$entry" | jq -r '.sha256')
  destination="$install_root/$package/$version"

  case "$name" in
    '' | */* | .*)
      report "$package $version: the manifest names an invalid file '$name'"
      return 0
      ;;
  esac

  if [ -d "$destination" ]; then
    link_package "$package" "$destination"
    report "$package $version ready at $destination"
    return 0
  fi

  work=$(mktemp -d) || return 0
  archive="$work/$name"

  if ! error=$(fetch --output "$archive" "$store/v1/$package/$version/$name" 2>&1); then
    report "$package $version: download failed: $error"
    rm -rf "$work"
    return 0
  fi

  if [ "$(file_sha256 "$archive")" != "$sha256" ]; then
    report "$package $version: $name does not match the manifest's sha256, so it was not installed"
    rm -rf "$work"
    return 0
  fi

  mkdir -p "$work/extract"

  if ! tar -xzf "$archive" -C "$work/extract" || [ ! -d "$work/extract/$package" ]; then
    report "$package $version: $name has no top-level $package directory"
    rm -rf "$work"
    return 0
  fi

  if ! mkdir -p "$install_root/$package" || ! mv "$work/extract/$package" "$destination"; then
    report "$package $version: unable to move the package into $destination"
    rm -rf "$work"
    return 0
  fi

  rm -rf "$work"

  link_package "$package" "$destination"
  report "$package $version installed at $destination"
}

install_packages() {
  if ! command -v jq >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    report "curl and jq are required, so nothing was installed"
    return 0
  fi

  if ! platform=$(detect_platform); then
    report "unsupported platform $(uname -s) $(uname -m), so nothing was installed"
    return 0
  fi

  for package in $(printf '%s' "$CLOUD_ARTIFACTS_PACKAGES" | tr ',' ' '); do
    if [ "$(seconds_left)" -lt 5 ]; then
      report "$package: skipped, the install ran out of its time budget"
      continue
    fi

    install_package "$package"
  done

  add_bin_directory_to_path
}

install_packages
print_hook_output
exit 0
