# Release Artifact Process

The `Release artifact` GitHub Actions workflow validates and packages one
exact repository ref. It runs the same Node 22 and Python 3.13 gates as CI,
then uploads only the validated ZIP and its checksum. It does not publish to
the Chrome Web Store and does not require Web Store API credentials.

## Owner steps

1. Choose the exact release commit or tag. For a tag-triggered run, push a
   `v*` tag that points at that commit. For a manual run, enter the exact
   branch, tag, or commit in the workflow's `ref` input.
2. Run or observe the `Release artifact` workflow and wait for every gate to
   pass.
3. Download both `leetyourbrain2code-v<version>.zip` and
   `leetyourbrain2code-v<version>.zip.sha256` from the workflow artifact.
4. Verify the checksum locally, for example:

   ```bash
   sha256sum -c leetyourbrain2code-v<version>.zip.sha256
   ```

   The checksum records the ZIP basename so this command works with the
   downloaded workflow artifact, where the ZIP and checksum sit side by side.

5. Run the final real-LeetCode smoke checklist in
   [`v0.1.1-smoke-checklist.md`](v0.1.1-smoke-checklist.md), or the matching
   versioned checklist for a later patch.
6. Upload that exact validated ZIP to the Chrome Web Store through the normal
   owner-controlled publishing flow.
7. Record the Store submission/publication state, source commit, ZIP name,
   and checksum next to the smoke evidence.

The checksum file is outside the extension ZIP. Do not edit, rezip, or rebuild
the downloaded artifact after checksum verification; if the artifact changes,
rerun the workflow from the intended exact ref.

## Gate order

```text
checkout exact ref
→ Node 22 + Python 3.13
→ npm ci
→ Python fixtures
→ full Vitest
→ compatibility contract
→ typecheck
→ build
→ release:check
→ release:zip
→ SHA-256
→ upload ZIP + checksum
```

The workflow prints the package version, full source commit SHA, ZIP path, and
SHA-256. Those values are release evidence only; they are not injected into
runtime extension files.
