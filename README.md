# Top Tier Player

An installable black-and-blue IPTV player foundation for **licensed content only**. It supports Xtream Codes and M3U connections, live channels, an EPG field, VOD/series catalogs, favorites, recent channels, catch-up detection, parental PINs, and account expiration display.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder run `npm start`.
3. Open `http://localhost:8080`.

No content or provider credentials are included. Customers enter their own authorized connection details in the player.

## Deploy on Badboyztv.org

Point `Badboyztv.org` to a Node-capable host and set `PORT` if the host requires it. For production, set `ALLOWED_STREAM_HOSTS` to a comma-separated list of approved provider hostnames. Example:

```bash
ALLOWED_STREAM_HOSTS=licensed-provider.example,epg.example npm start
```

HTTPS is required for installation as a PWA. Do not put usernames or passwords into source code.

## Platform packaging

- Android phones, Android TV, Google TV, and Fire TV: wrap the hosted app as a signed Android WebView/TWA package or migrate the shared interface into the native shell.
- iPhone/iPad: install from Safari as a PWA or package a signed iOS shell.
- Apple TV: requires a separate signed tvOS client because tvOS does not provide Safari/PWA installation.

## Remaining production work

- Replace the text crown with the final Top Tier logo and app icons.
- Connect the exact public domain and approved provider hosts.
- Add full XMLTV timeline parsing and Xtream episode/catch-up playback parameters.
- Add a secure account/backend service if customer logins will be centrally managed.
- Test codecs, remote-control focus, and stream failover on each physical device.
- Produce signed APK/AAB, iOS, and tvOS builds using the owner's developer certificates.
