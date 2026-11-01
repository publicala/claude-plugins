#!/usr/bin/env bash
# The shared fixture: the Acme Books inventory repository and a fake gh.
exec bash "$(dirname "${BASH_SOURCE[0]}")/../fixture/setup.sh"
