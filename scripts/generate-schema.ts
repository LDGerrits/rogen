import fs from "fs";
import path from "path";
import { Registry } from "../src/platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
} from "../src/platform/config/config-registry.js";
import { schemaChannels } from "../src/domain/config/config.js";

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

const registry = Registry.as<ConfigRegistry>(Extensions.Config);
const content = JSON.stringify(registry.getJsonSchema(), null, "\t");

for (const channel of schemaChannels(version, published)) {
	const dir = path.resolve("public", "schema", channel);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "rogen.json"), content);
	console.log(`Generated schema/${channel}/rogen.json`);
}
