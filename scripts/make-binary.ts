import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Turns dist/bundle.cjs into a single executable: a Node binary with the bundle injected as a Node single-executable application.
 *
 *   node scripts/make-binary.ts <out-file> [--node <node binary>] [--platform darwin|linux|win32]
 *
 * Without `--node` it uses the Node that runs it, so build on the platform it targets, or pass the target's `node`.
 */

/** Marks a Node binary as carrying an injected blob; fixed by Node. */
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const POSTJECT = "postject@1.0.0-alpha.6";

const [requestedFile, ...flags] = process.argv.slice(2);
if (!requestedFile) {
	console.error(
		"Usage: node scripts/make-binary.ts <out-file> [--node <node binary>] [--platform darwin|linux|win32]"
	);
	process.exit(1);
}
const flag = (name: string): string | undefined => {
	const at = flags.indexOf(`--${name}`);
	return at >= 0 ? flags[at + 1] : undefined;
};
const nodeBinary = flag("node") ?? process.execPath;
const platform = flag("platform") ?? process.platform;
const outFile =
	platform === "win32" && !requestedFile.endsWith(".exe")
		? `${requestedFile}.exe`
		: requestedFile;
const bundle = path.resolve("dist", "bundle.cjs");
if (!fs.existsSync(bundle))
	throw new Error(`${bundle} is missing; run "npm run bundle" first.`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-sea-"));
try {
	const config = path.join(work, "sea-config.json");
	const blob = path.join(work, "sea.blob");
	fs.writeFileSync(
		config,
		JSON.stringify({
			main: bundle,
			output: blob,
			disableExperimentalSEAWarning: true,
		})
	);
	execFileSync(process.execPath, ["--experimental-sea-config", config], {
		stdio: "inherit",
	});

	fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
	fs.copyFileSync(nodeBinary, outFile);
	fs.chmodSync(outFile, 0o755);
	// A macOS binary must lose its signature to take the blob, and gets an ad-hoc one back to run.
	if (platform === "darwin")
		execFileSync("codesign", ["--remove-signature", outFile], {
			stdio: "inherit",
		});
	execFileSync(
		"npx",
		[
			"--yes",
			POSTJECT,
			outFile,
			"NODE_SEA_BLOB",
			blob,
			"--sentinel-fuse",
			SEA_FUSE,
			...(platform === "darwin"
				? ["--macho-segment-name", "NODE_SEA"]
				: []),
		],
		{ stdio: "inherit", shell: process.platform === "win32" }
	);
	if (platform === "darwin")
		execFileSync("codesign", ["--sign", "-", outFile], {
			stdio: "inherit",
		});
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
