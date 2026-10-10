import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { configSchema } from "../src/domain/config/config-schema.js";
import { schemaChannels } from "./schema-channels.js";

/** Writes the config schema under `outDir/<channel>/rogen.json` for every channel `version` publishes to. */
export function generateSchema(
	outDir: string,
	version: string,
	published: readonly string[]
): readonly string[] {
	const content = JSON.stringify(configSchema, null, "\t");
	const channels = schemaChannels(version, published);
	for (const channel of channels) {
		const dir = path.join(outDir, channel);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "rogen.json"), content);
	}
	return channels;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { version } = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
		version: string;
	};

	const publishedDir = process.argv[2];
	const published =
		publishedDir && fs.existsSync(publishedDir)
			? fs
					.readdirSync(publishedDir)
					.filter((entry) => /^\d+\.\d+\.\d+(-.+)?$/.test(entry))
			: [];

	const outDir = path.resolve("public", "schema");
	for (const channel of generateSchema(outDir, version, published))
		console.log(`Generated schema/${channel}/rogen.json`);
}
