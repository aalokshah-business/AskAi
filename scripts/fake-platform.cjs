// Preview aid: makes Node report another OS (ASKAI_FAKE_PLATFORM=win32|darwin|linux) so the Windows and macOS code paths of
// askai and token-setup can be previewed on any machine. Only for dry-runs: nothing is executed on the simulated OS.
const p = process.env.ASKAI_FAKE_PLATFORM;
if (p) Object.defineProperty(process, 'platform', { value: p, configurable: true });
