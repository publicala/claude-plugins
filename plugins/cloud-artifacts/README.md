# cloud-artifacts

A Claude Code cloud session can't download a private repository's releases: the GitHub proxy only serves the repositories attached to the session. This plugin installs private skills and CLIs at session start from an artifact store you host, and the cloud environment's network secret carries the store's token, so the token never enters the session.

## What it does

The SessionStart hook reads the latest release of each package in `CLOUD_ARTIFACTS_PACKAGES`, downloads the archive for the session's platform, checks its SHA-256 against the manifest and unpacks it under `~/.local/share/cloud-artifacts/{package}/{version}`. A version already there skips the download. Then it links:

- **Skill**: the package directory into `~/.claude/skills/{package}`, when it has a `SKILL.md`
- **Executables**: each file of its `bin/` into `~/.local/bin`

An upgrade removes the links the previous version created, so an executable a release drops stops resolving. When `~/.local/bin` isn't on `PATH`, the hook adds it for the session's commands.

The hook reports one line per package as session context, asks Claude Code to scan for skills again so a skill it linked works from the first prompt, and exits 0 even when the store is down. The installs share a 100-second budget, inside the hook's 120-second timeout, and a package that doesn't fit is reported as skipped. A real directory or file already at a link's path stays untouched.

## Set up a cloud environment

1. **Setup script**: install the plugin.

   ```bash
   claude plugin marketplace add publicala/claude-plugins
   claude plugin install cloud-artifacts@publicala
   ```

2. **Environment variables**:

   ```text
   CLOUD_ARTIFACTS_URL=https://artifacts.acme-books.example
   CLOUD_ARTIFACTS_PACKAGES=report-cli,catalog-skill
   ```

3. **Network secrets**: one secret for the store's host, with the `Authorization` header, the `Bearer` prefix and the store's read token as the value.

The setup script can't do the install itself, because the agent proxy adds network secrets only to requests made after Claude Code starts. Set `CLOUD_ARTIFACTS_TOKEN` to send a token directly, outside a cloud session.

## The store

The store answers three reads, each with `Authorization: Bearer <token>`:

| Request                                   | Answer                        |
| ----------------------------------------- | ----------------------------- |
| `GET {url}/v1/{package}/latest`           | The latest release's manifest |
| `GET {url}/v1/{package}/{version}/{file}` | A file the manifest lists     |

A manifest lists one archive per platform (`linux-x86_64`, `linux-arm64`, `macos-arm64`):

```json
{
  "package": "report-cli",
  "version": "1.4.0",
  "files": [
    {
      "name": "report-cli-v1.4.0-linux-x86_64.tar.gz",
      "platform": "linux-x86_64",
      "sha256": "<64 hex characters>",
      "size": 4194304
    }
  ]
}
```

Each archive holds one top-level directory named after the package. Package names use lowercase letters, digits and hyphens.

## Requirements

`curl`, `jq`, `tar` and `sha256sum` (or `shasum`) on `PATH`. A cloud session has all four.
