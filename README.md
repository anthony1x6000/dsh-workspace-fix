# dsh-workspace-fix

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **bundle
plugin** that repairs a workspace **“＋ / Add workspace”** (“New workspace”)
button that does nothing.

It pins the directory picker to the in-browser **browse** backend instead of a
**native** OS chooser that never returns. No build step, no dependencies —
plain ESM plus a Cordis patch layer.

## Symptom

Clicking the workspace add control does nothing: no dialog, no error. Clicking
it again does nothing either.

## Root cause

Adding a workspace is a two-part flow:

1. `@deepseek-ai/dsh-client-ui-workspace` renders the add affordance. It only
   offers the action while an occupant is registered in the
   `sidebar.workspaces.directoryFlow` / `conversation.hero.workspace.directoryFlow`
   slots, and it disables the action while a pick is in flight
   (`flowBusy = flowOpen || pickingFolder`).
2. An occupant plugin supplies the picking interaction. The shipped
   `@deepseek-ai/dsh-host-directory-picker-auto` row resolves one backend at
   boot: `native` when the operator is assumed to be at the host's display, and
   `browse` otherwise.

On an affected host the resolver picks **native** because the heuristic sees
Linux + a display variable (`DISPLAY` / `WAYLAND_DISPLAY`) + `zenity`/`kdialog`
on `PATH`. That assumption fails when the display is not actually
operator-visible (headless/remote session, forwarded GUI, frozen chooser), and
the host spawns:

```
kdialog --getexistingdirectory . --title "Select Workspace Directory"
```

The native **client** occupant is deliberately renderless: it calls the host,
awaits the OS dialog, and reports exactly one outcome. When the dialog never
presents or never returns, the promise never settles, so:

- the first press opens the flow and hangs on the invisible chooser;
- every later press is swallowed by `flowBusy`;
- the add action never re-arms — the button looks dead.

## The fix

Pin the interaction to the **browse** backend, which serves the listing over the
web connection and works wherever the web GUI works. This is exactly the
composition the product itself uses to pin the interaction in its own test
harness (`apps/web/tests/pin-browse-picker.overlay.yml` and
`apps/web/tests/scaffold.ts`).

`cordis.patch.yml` does it:

```yaml
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
    - id: workspace-fix
      name: 'dsh-workspace-fix'
```

`index.js` is a small self-report plugin: it logs which picker backend is live,
so a hot-applied pin is observable in the host log without restarting.

## Install

```sh
dsh plugin --profile web add github:anthony1x6000/dsh-workspace-fix
```

Or from a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-workspace-fix
```

A **live** profile (the default `dsh web` setup) applies the change immediately
through the host HMR service — no restart. Startup-only profiles need a restart.

## Verify

```sh
# Composed tree: the adaptive row disabled, the browse pair inserted.
dsh --profile web --dump-config | grep -A2 directory-picker
```

```sh
# Live host log after a hot apply.
journalctl --user -u dsh-web --since "5 minutes ago" | grep dsh-workspace-fix
```

```sh
# The running web shell must advertise the browse surface and no native one.
curl -sL "http://127.0.0.1:3080/?token=<web-token>" \
  | grep -o 'directory-picker[a-z-]*' | sort -u
# → directory-picker-browse
```

### End-to-end button check

`verify-button.mjs` drives a separate headless browser over the DevTools
Protocol, loads the authenticated GUI, clicks the add control, and asserts the
`Select Workspace Directory` dialog opens:

```sh
flatpak run com.brave.Browser --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/dsh-verify --remote-allow-origins='*' about:blank &
TOKEN=<web-token> node verify-button.mjs
```

Expected:

```json
{
  "shellReady": true,
  "clicked": true,
  "dialogLabel": "Select Workspace Directory",
  "text": "Select Workspace Directory… New folder … Open"
}
```

## Revert

```sh
dsh plugin --profile web remove dsh-workspace-fix
```

## Files

| File | Purpose |
| --- | --- |
| `cordis.patch.yml` | The fix: disable `-auto`, compose the browse pair |
| `index.js` | Self-report plugin that logs the live backend |
| `verify-button.mjs` | CDP end-to-end button check |
| `package.json` | `dsh.bundle.patch` manifest |

## License

MIT
