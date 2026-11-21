import { buildSync } from "esbuild";
import fs from "fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
	version: string;
};

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
