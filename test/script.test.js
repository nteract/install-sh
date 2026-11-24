import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { installerScript } from "../lib/script.js";

const tag = "v2.10.1-stable.202611161848";
const baseUrl = `https://github.com/nteract/nteract/releases/download/${tag}`;

test("bootstrap downloads the release installer and forwards args", () => {
  const script = installerScript(tag);

  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /set -eu/);
  assert.match(script, /Linux:x86_64\|Linux:amd64/);
  assert.match(script, /Darwin:arm64\|Darwin:x86_64/);
  assert.match(script, /curl --proto '=https' --tlsv1\.2 -fsSL/);
  assert.match(script, /wget -O "\$dest" "\$url"/);
  assert.match(script, /curl or wget is required to install nteract/);
  assert.doesNotMatch(script, /curl is required to install nteract/);
  assert.ok(script.includes(baseUrl));
  assert.match(script, /exec "\$tmp\/install-linux-release" "\$@"/);
});

test("wget bootstrap runs the signed installer and rejects unverifiable downloads", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nteract-install-sh-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));

  const binDir = join(dir, "bin");
  const scriptPath = join(dir, "install.sh");
  const downloadedLog = join(dir, "downloaded.log");
  const execLog = join(dir, "exec.log");
  const fakeInstaller = join(dir, "install-linux-release");

  mkdirSync(binDir);

  const linkCommand = (name) => {
    for (const prefix of process.env.PATH.split(":")) {
      const candidate = join(prefix, name);
      if (existsSync(candidate)) {
        symlinkSync(candidate, join(binDir, name));
        return;
      }
    }
    throw new Error(`missing test command: ${name}`);
  };

  const original = `#!/bin/sh\necho "fake installer $*" > "${execLog}"\n`;
  writeFileSync(fakeInstaller, original);
  const manifest = join(dir, "SHA256SUMS");
  const key = join(dir, "key");
  execFileSync("minisign", ["-G", "-W", "-s", key, "-p", key + ".pub"]);
  const pubkey = readFileSync(key + ".pub", "utf8").trim().split("\n")[1];
  writeFileSync(scriptPath, installerScript(tag).replace(/-P '[^']+'/, `-P '${pubkey}'`));
  const digest = createHash("sha256").update(original).digest("hex");
  const sign = (tag, name = "install-linux-release") => {
    writeFileSync(manifest, `# ${tag}\n${digest}  ${name}\n`);
    execFileSync("minisign", ["-S", "-s", key, "-m", manifest]);
  };
  sign(tag);

  writeFileSync(
    join(dir, "uname"),
    `#!/bin/sh\ncase "\${1:-}" in\n  -s) echo Linux ;;\n  -m) echo aarch64 ;;\n  *) echo Linux ;;\nesac\n`,
  );
  chmodSync(join(dir, "uname"), 0o755);

  writeFileSync(
    join(dir, "wget"),
    `#!/bin/sh\nset -eu\nout=""\nurl=""\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    -O) out="$2"; shift 2 ;;\n    *) url="$1"; shift ;;\n  esac\ndone\necho "$url" >> "${downloadedLog}"\ncat "${dir}/\${url##*/}" > "$out"\n`,
  );
  chmodSync(join(dir, "wget"), 0o755);

  for (const command of ["chmod", "cat", "mktemp", "rm", "minisign", "shasum", "grep"]) {
    linkCommand(command);
  }
  symlinkSync(join(dir, "uname"), join(binDir, "uname"));
  symlinkSync(join(dir, "wget"), join(binDir, "wget"));

  const run = () => spawnSync("/bin/sh", [scriptPath, "--headless"], {
    env: { HOME: dir, PATH: binDir, TMPDIR: dir },
    encoding: "utf8",
  });

  const result = run();
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal(
    readFileSync(downloadedLog, "utf8").trim(),
    ["install-linux-release", "SHA256SUMS", "SHA256SUMS.minisig"].map(name => `${baseUrl}/${name}`).join("\n"),
  );
  assert.equal(readFileSync(execLog, "utf8").trim(), "fake installer --headless");
  rmSync(execLog);
  const reject = () => {
    assert.notEqual(run().status, 0);
    assert.ok(!existsSync(execLog), "unverified installer executed");
  };
  sign("v2.0.0-stable.202501010000");
  reject();
  sign(tag, "other-file");
  reject();
  sign(tag);
  writeFileSync(fakeInstaller, original + "# tampered\n");
  reject();
  writeFileSync(fakeInstaller, original);
  writeFileSync(manifest, readFileSync(manifest, "utf8") + "# tampered\n");
  reject();
  sign(tag);
  rmSync(manifest + ".minisig");
  reject();
  sign(tag);
  writeFileSync(scriptPath, installerScript(tag));
  reject(); // The fixture key is not the publisher.
});

test("bootstrap rejects missing or malformed release tags", () => {
  assert.throws(() => installerScript());
  assert.throws(() => installerScript(tag + "'"));
});

test("unsupported platforms get guidance, not a bare failure", () => {
  const script = installerScript(tag);

  assert.match(script, /Linux x64\/ARM64 and macOS \(Apple silicon, Intel\)/);
  assert.match(script, /github\.com\/nteract\/nteract\/releases/);
});

test("bootstrap does not install agent integrations", () => {
  const script = installerScript(tag);

  assert.doesNotMatch(script, /npm:@nteract\/pi/);
  assert.doesNotMatch(script, /\bpi install\b/);
  assert.doesNotMatch(script, /claude|cursor|windsurf/i);
});
