# CEF crash repro (macOS)

## Summary
- Project: `lilto`
- Runtime: `electrobun@1.14.4`
- OS: macOS (arm64)
- Scenario: Run app E2E with CEF enabled
- Result: crash during CEF profile creation / browser creation

## Reproduction steps
```bash
cd /Users/hide/dev/lilto
pkill -f 'electrobun|lilt-o-dev.app/Contents/MacOS|Resources/main.js' || true
rm -rf "$HOME/Library/Application Support/sh.hide212131.lilto/dev/CEF"
LILTO_E2E_USE_CEF=1 npm run e2e:electrobun
```

## Actual result
- Process exits with code `1`
- Fatal error appears during CEF initialization:
  - `Cannot create profile at path .../CEF/Partitions/default`
  - `FATAL: ... cef_scoped_refptr.h:329 Check failed: ptr_`

## Expected result
- CEF-enabled run should start window and complete E2E (or at least stay alive without fatal crash).

## Log excerpt
Source log file: `/tmp/lilto-cef-crash.log`

```log
2026-03-06 00:32:04.471 ... DEBUG CEF: CreateRequestContextForPartition called for webview 1, partition: persist:default
... ERROR ... Cannot create profile at path /Users/hide/Library/Application Support/sh.hide212131.lilto/dev/CEF/Partitions/default
... DEBUG CEF: Creating browser, OSR mode: NO, view size: 980x720, sandbox: NO
... FATAL:ors/cef/include/base/cef_scoped_refptr.h:329] Check failed: ptr_.
Child process terminated by signal: 5
```

## Notes
- CEF binary download and startup complete (`DevTools listening ...` is shown).
- Non-CEF path (`npm run e2e:electrobun`) succeeds.
- Staged probe modes were added in `src/bun/index.ts`:
  - `LILTO_CEF_PROBE_MODE=minimal`
  - `LILTO_CEF_PROBE_MODE=views-no-rpc`
  - `LILTO_CEF_PROBE_MODE=views-rpc`
