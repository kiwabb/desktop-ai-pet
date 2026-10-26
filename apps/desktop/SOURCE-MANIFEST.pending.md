# Pending Cindy source manifest

The implementation task selects Cindy commit `ae50e8e1afd9b95e51801085d1a2ed9dfe8b16af`
as the read-only source reference. The audited checkout was recorded at
`D:\atcs\cindy`, but that path is not available in the current macOS workspace.

The following must be recorded before copying any Cindy code:

- source commit and repository identity;
- source path and destination path for every copied file;
- license/notice ownership and file checksums;
- dependency and native-module closure;
- adaptation reason for every changed copied file;
- excluded accounts, endpoints, telemetry, credentials, caches and private data.

Until this manifest is completed, the Electron pages in this slice are explicit
migration-boundary placeholders. They must not be described as Cindy UI parity.
