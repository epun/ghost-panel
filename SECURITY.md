# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via one of:

1. [GitHub Security Advisories](https://github.com/epun/ghost-panel/security/advisories/new) (preferred)
2. Email: **evanmpun@gmail.com** with subject `Ghost Panel security`

Include:

- A description of the issue and its impact
- Steps to reproduce
- Affected version(s)
- Any suggested fix, if you have one

You should receive an acknowledgment within 72 hours. We will work with you on a
fix and coordinated disclosure timeline.

## Scope notes

Ghost Panel is a **client-side inspector panel** intended for development workflows. It
is not hardened for untrusted end-user input in production. Do not expose the panel
to untrusted users without reviewing your integration (e.g. `visible: false` in
production, custom `augment` / `learning` settings).
