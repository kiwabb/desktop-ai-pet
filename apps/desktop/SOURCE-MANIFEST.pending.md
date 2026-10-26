# Pending Cindy source manifest

The implementation task selects Cindy repository `makecindy/cindy` at commit
`ae50e8e1afd9b95e51801085d1a2ed9dfe8b16af` as the read-only source reference. A
sparse, detached checkout is now available outside this repository at
`/Users/zhoujiaangyao/zhoujiangyao/AI/cindy-reference`. The historical audit path
was `D:\atcs\cindy`; it is not used as a runtime dependency.

The local reference checkout includes the source needed for the next import review:
`apps/desktop` without large renderer assets/tests, `packages/maker-core` Pi/types
paths, and `docs/dev-rules`. One low-coupling renderer component has now been
copied as a separate partial slice; the full renderer closure is not copied.

The pre-copy entry/host inventory is recorded in
[`SOURCE-IMPORT-INVENTORY.md`](./SOURCE-IMPORT-INVENTORY.md). It confirms that
Cindy's renderer entry, preload, and Electron bootstrap have a broad dependency
closure; the inventory is not a copied-file manifest and does not claim UI parity.

The current partial copied-file record is
[`CINDY-SOURCE-MANIFEST.json`](./CINDY-SOURCE-MANIFEST.json). The following must
be recorded before copying additional Cindy code:

- source commit and repository identity;
- source path and destination path for every copied file;
- license/notice ownership and file checksums;
- dependency and native-module closure;
- adaptation reason for every changed copied file;
- excluded accounts, endpoints, telemetry, credentials, caches and private data.

The Electron main page now has a product-owned, source-backed shell using the
copied `FadeSwitcher` primitive and the typed Pi bridge. Until the full manifest,
dependency closure, and copied-file diff are reviewed, it must not be described as
Cindy UI parity; the full Cindy renderer remains an explicit deferred boundary.
