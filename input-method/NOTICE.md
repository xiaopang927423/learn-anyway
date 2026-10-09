# WordMate input method provenance

The input-method Rust engine and macOS adapter are derived from Qingjian, local reference commit c08ae57, https://github.com/qingjian-team/qingjian. Original crate names identify provenance. This component and modifications are licensed GPL-3.0-or-later; see LICENSE. WordMate desktop's existing MIT notice does not override this component's license. No Qingjian logo or brand assets are included.

WordMate changes: distinct bundle identity and data paths, English-only learning, desktop RPC and fragment assistance, confirmed adoption events, no raw input logs, disabled upstream auto-update endpoint. Source for the modified component is kept here with the product project, not distributed as an opaque closed-source native binary.

Local dictionary assets and their hashes are recorded in resource-manifest.json. Resource files have separate licenses and attribution under licenses/ and UPSTREAM-DATA-SOURCES.md. Some upstream transcriptions have no explicit redistribution license; local development use does not establish public redistribution rights. This build must not be published as a completed release until the data source/release checklist is resolved. No claim that IPC resolves copyleft obligations is made.
