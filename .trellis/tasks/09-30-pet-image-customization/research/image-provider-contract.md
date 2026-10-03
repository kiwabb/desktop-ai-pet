# Image provider contract research

Read-only documentation evidence, 2026-09-30. No image generation request was made and no credential was inspected.

Source: https://developers.openai.com/api/docs/guides/image-generation

The official guide documents reference-image edits, transparent PNG/WebP output, base64 image output, and separate image-generation models. It warns that recurring-character consistency can fail and complex requests can take minutes. A configured Chat Completions endpoint is not evidence of these image capabilities. Exact model capabilities must be checked at integration time.

Proposed application contract (our design, not provider guarantees): configurable image endpoint/model/key; multipart edits adapter; one master pose then derived states anchored to that master; PNG with real alpha required. Parse bounded base64 output, validate decoded dimensions and alpha before accepting. Do not treat a URL-only response or opaque checkerboard output as a usable asset. Return an actionable compatibility error.

Use cancellation tokens and generation IDs locally. Cancelling stops local work and rejects late results; it does not prove the provider stopped billing. Do not automatically retry ambiguous generation requests. Preserve successful stages and let the user explicitly retry failed stages. No published price is hard-coded; show provider/model and the intended request count before generation. Live endpoint availability and output quality remain runtime acceptance requirements.
