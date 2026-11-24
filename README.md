# nteract install shell endpoint

This repository serves `https://sh.nteract.io`, a tiny shell bootstrap for the
nteract installer (Linux x64/ARM64 and macOS Apple silicon/Intel).

The endpoint intentionally stays separate from the marketing site. It serves
plain shell, not HTML, and it does not install agent-specific integrations.

The bootstrap requires `minisign` on PATH. It checks the latest stable
installer’s SHA-256 against the release manifest signed by nteract’s updater key
before running it.

## Local development

```sh
npm test
npm run lint
vercel dev
```

## Production endpoint

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.nteract.io | sh
```

Nightly installs require an explicit channel and tag:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.nteract.io | \
  sh -s -- --channel nightly --tag v2.4.1-nightly.YYYYMMDDHHMM
```

## Vercel domain setup

`sh.nteract.io` is added to the `install-sh` Vercel project under the `nteract`
team. If it ever needs to be recreated, add the domain to the Vercel project,
then configure DNS for the `sh` subdomain using the CNAME target Vercel reports:

```sh
vercel domains add sh.nteract.io
vercel domains inspect sh.nteract.io
```

If DNS for `nteract.io` is managed outside Vercel, add the reported `CNAME`
record through that DNS provider. If Vercel manages DNS, add the record there.

The endpoint sets a short CDN cache on purpose so the bootstrap can be updated
quickly while still being cacheable at the edge.
