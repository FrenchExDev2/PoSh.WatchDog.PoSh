# Changelog

## 0.3.0

- Add **Open Visual Diagnostics (HTML)** to export this window's retained journals and open an offline graphical report externally.
- Show process memory curves, historical thresholds, observed peak rankings, recorded events, current inventory and environment information.
- Preserve PID/creation-time identities, measurement gaps and explicit partial history; merge bounded disk and memory evidence without duplicate collections.
- Keep dated exports in extension storage and expose the saved location if external opening fails. No runtime npm dependency or report network request is required.

## 0.2.0

- Monitor ordinary pwsh terminals and their children per VS Code window, independently of Microsoft PowerShell activation.
- Display process count, total private memory, readable states and explicit partial measurements.
- Evaluate thresholds and warning episodes independently for each process; keep ordinary processes alert-only.
- Preserve verified Editor Services restart, debugger deferral, cooldown and quota protections.
- Qualify nested process ownership, process exit/removal and peer-window exclusion in installed-VSIX scenarios.

## 0.1.0

- Initial Windows Desktop memory watchdog with window-specific session association.
- External bounded collection, configurable restart policy, machine settings and diagnostics.
- Independent policy tests and installed-VSIX sandbox integration harness.
