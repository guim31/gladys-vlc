# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds and where:

- **Secrets**: the password of each VLC's web interface, typed in the Gladys
  configuration (`secret` fields). It is only sent to the address typed for
  that VLC, as HTTP Basic authentication, never in a URL, never written to
  `/data`, never logged.
- **`/data`**: `vlc-state.json`, the volume each VLC had before a mute. No
  secret.
- **Network**: plain HTTP (or HTTPS if typed) requests from the integration's
  container to the addresses typed in the configuration, on the local
  network. Redirects are not followed. Nothing is sent to the internet by the
  integration itself; VLC may fetch the addresses a scene asks it to play,
  restricted to media schemes (no `vlc://` command, no screen or capture
  device).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
VLC media player and its web interface (report those to
[VideoLAN](https://www.videolan.org/security/)), and the third-party services
and devices the integration talks to.
