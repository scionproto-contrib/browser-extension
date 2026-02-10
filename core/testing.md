# Testing the Extension

Several aspects and behaviour need to be tested to ensure proper functionality of the extension.
Both for the Chromium and Firefox implementation, the same aspects need to be tested, hence the
subsequent list applies to both.

Testing is currently only done manually, but automation of this process is to be considered in the future.

Any examples that are listed below reflect their SCION-capability at the time of writing (10.2.26).

## Tests to conduct
- Browsing without any strict modes enabled
  - All websites should be accessible
  - The popup should reflect the resources loaded by that website
- Browsing with global strict mode enabled
  - All websites that are SCION-capable (e.g. `ethz.ch`, `ovgu.de`) should be accessible
    - The popup should display the resources that were allowed (whose hosts are SCION-capable) and
      the resources that were blocked (whose hosts are not SCION-capable)
    - Any sub-resources whose hosts are not SCION-capable of such websites (e.g. `www.googletagmanager.com`)
      should be blocked (in case of `ethz.ch`, this results in the Cookie-banner not being loaded)
  - All websites that are not SCION-capable (e.g. `example.com`, `google.com`) should be blocked
    - The checking-page should indicate that the page was blocked
    - The popup should also indicate, that the host of the website was blocked
- Browsing with per-site strict mode set for some page(s) with global strict mode enabled
  - Should result in the same behaviour as if no per-site strict mode was enabled
- Browsing with per-site strict mode set for some page(s) with global strict mode disabled
  - All websites (except the ones set to strict) should be accessible
  - Those set to strict should behave the same way, as if global strict mode was set
- Verify that the connection is performed via SCION by checking if `http://gazelle.scionapps.com`
  shows a dancing gazelle

### Example Testing-workflow
Important to note again, that these examples are based on the SCION-capability of those hosts at the
time of writing.

Additionally, for each of the following pages that are accessed, the popup should also be verified to
show the resources that were loaded/blocked. Note that this list may differ from the list observed
when no strict mode is enabled, since without strict mode, a resource that would otherwise be blocked
may request further resources (e.g. browsing `ethz.ch` without strict mode will not only show `ethz.ch` and
`www.googletagmanager.com`, but also `geolocation.onetrust.com` and `cdn.cookielaw.org` - both of which are
requested by `www.googletagmanager.com` and therefore do not show up in strict mode at all).

- No strict modes enabled
  - Verify accessibility of:
    - `example.com`
    - `ethz.ch`
    - `ovgu.de`
- Global strict mode enabled (without any per-site strict mode)
  - Verify blocking of:
    - `example.com`
  - Verify accessibility of:
    - `ethz.ch` (ensure the Cookie-banner is blocked)
    - `ovgu.de`
- Per-site strict mode enabled for `ethz.ch` and `google.com` (with global strict mode enabled)
  - Verify same behaviour as if exclusively global strict mode was enabled
- Per-site strict mode enabled for `ethz.ch` and `google.com` (with global strict mode disabled)
  - Verify blocking of:
    - `google.com`
  - Verify accessibility of:
    - `example.com`
    - `ovgu.de`
    - `ethz.ch` (but ensure the Cookie-banner is blocked)
- Verify SCION-usage by checking if `http://gazelle.scionapps.com` shows a dancing gazelle