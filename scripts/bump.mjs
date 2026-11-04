// Usage: npm run bump -- 0.2.0
// Sets the version in package.json, manifest.json and versions.json.
// BRAT needs the git tag to equal manifest.json's version (no "v" prefix).
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Give a version like 0.2.0");
  process.exit(1);
}
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const write = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + "\n");

const pkg = read("package.json");
pkg.version = version;
write("package.json", pkg);

const manifest = read("manifest.json");
manifest.version = version;
write("manifest.json", manifest);

const versions = read("versions.json");
versions[version] = manifest.minAppVersion;
write("versions.json", versions);

console.log(`Bumped to ${version}. Next: git commit -am "Release ${version}" && git tag ${version} && git push && git push --tags`);
