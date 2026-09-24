import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
	renderServicesModule,
	selectServices,
} from "../src/domain/roblox/select-services.js";

const DUMP_URL =
	"https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json";
const OUTPUT = path.resolve("src/domain/roblox/services.ts");

async function readDump(file: string | undefined) {
	if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
	const response = await fetch(DUMP_URL);
	if (!response.ok) {
		throw new Error(`Could not fetch ${DUMP_URL}: ${response.status}`);
	}
	return response.json();
}

const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-services-"));
fs.copyFileSync("rokit.toml", path.join(probeDir, "rokit.toml"));

// Without a $className Rojo only accepts a DataModel child it knows as a service.
function isKnownToRojo(name: string): boolean {
	const project = path.join(probeDir, "default.project.json");
	fs.writeFileSync(
		project,
		JSON.stringify({
			name: "probe",
			tree: { $className: "DataModel", [name]: {} },
		})
	);
	const result = spawnSync("rojo", ["sourcemap", project], {
		cwd: probeDir,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	return result.status === 0;
}

try {
	const dump = await readDump(process.argv[2]);
	const services = selectServices(dump, isKnownToRojo);
	if (services.length === 0) {
		throw new Error(
			"Rojo accepted no service. Is the pinned Rojo installed?"
		);
	}
	fs.writeFileSync(OUTPUT, renderServicesModule(services));
	console.log(`Wrote ${services.length} services to ${OUTPUT}`);
} finally {
	fs.rmSync(probeDir, { recursive: true, force: true });
}
