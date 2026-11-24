export async function getLatestStableTag() {
  const res = await fetch("https://api.github.com/repos/nteract/nteract/releases/latest", {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub release lookup failed (HTTP ${res.status})`);
  return (await res.json()).tag_name;
}

export function installerScript(tag) {
  if (!/^v\d+\.\d+\.\d+-stable\.\d{12}$/.test(tag)) throw new Error("Invalid stable release tag");
  return `#!/bin/sh
set -eu

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64|Linux:aarch64|Linux:arm64|Darwin:arm64|Darwin:x86_64) ;;
  *)
    echo "nteract installer supports Linux x64/ARM64 and macOS (Apple silicon, Intel)." >&2
    echo "Windows users: download the installer from https://github.com/nteract/nteract/releases" >&2
    exit 1
    ;;
esac

download_url() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$dest" "$url"
  else
    echo "curl or wget is required to install nteract." >&2
    exit 1
  fi
}

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

for asset in install-linux-release SHA256SUMS SHA256SUMS.minisig; do
  download_url "https://github.com/nteract/nteract/releases/download/${tag}/$asset" "$tmp/$asset"
done
# Updater public key from nteract/nteract crates/notebook/tauri.conf.json.
minisign -Vm "$tmp/SHA256SUMS" -P 'RWQ8MUSfTZ0g5J1X+iGMaR2GTZgLOuDUnTSGHNW5B/wktOQYuOwbH4RP'
IFS= read -r release < "$tmp/SHA256SUMS"
digest=$(sha256sum < "$tmp/install-linux-release" 2>/dev/null || shasum -a 256 < "$tmp/install-linux-release")
if [ "$release" != '# ${tag}' ] || ! grep -Fxq "\${digest%% *}  install-linux-release" "$tmp/SHA256SUMS"; then
  echo "Installer checksum or release tag mismatch." >&2
  exit 1
fi

chmod 0755 "$tmp/install-linux-release"
exec "$tmp/install-linux-release" "$@"
`;
}
