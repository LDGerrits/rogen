import fs from "fs";
import path from "path";
import { Registry } from "../src/platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
} from "../src/platform/config/config-registry.js";
import "../src/domain/config/config.js";

const registry = Registry.as<ConfigRegistry>(Extensions.Config);
const schema = registry.getJsonSchema();

const outDir = path.resolve(process.cwd(), "public");
if (!fs.existsSync(outDir)) {
	fs.mkdirSync(outDir);
}

fs.writeFileSync(
	path.join(outDir, "schema.json"),
	JSON.stringify(schema, null, "\t")
);

console.log("Successfully generated schema.json");
