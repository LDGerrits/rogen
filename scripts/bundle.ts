import { buildSync } from "esbuild";
import fs from "fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
	version: string;
};

// The bundle runs from `dist/`, where package.json is a folder up. A compiled binary has none, so it carries the version.
buildSync({
	entryPoints: ["bin/rogen.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["*.node"],
	mainFields: ["module", "main"],
	define: {
		"import.meta.dirname": "__dirname",
		ROGEN_VERSION: JSON.stringify(version),
	},
	outfile: "dist/bundle.cjs",
});
