import { decode } from "@msgpack/msgpack";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
	ReflectionDatabase,
	renderServicesModule,
	selectServices,
} from "../src/domain/roblox/select-services.js";

const OUTPUT = path.resolve("src/domain/roblox/services.ts");

async function fetchOk(url: string): Promise<Response> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response;
}

function pinnedRojoVersion(): string {
	const match = /rojo-rbx\/rojo@(\S+?)"/.exec(
		fs.readFileSync("rokit.toml", "utf8")
	);
	if (!match) throw new Error("rokit.toml does not pin Rojo.");
	return match[1];
}

interface PinnedCrate {
	readonly version: string;
	readonly checksum: string;
}

async function bundledDatabase(rojoVersion: string): Promise<PinnedCrate> {
	const lock = await (
		await fetchOk(
			`https://raw.githubusercontent.com/rojo-rbx/rojo/v${rojoVersion}/Cargo.lock`
		)
	).text();
	const match =
		/name = "rbx_reflection_database"\nversion = "([^"]+)"\n(?:.*\n)*?checksum = "([0-9a-f]+)"/.exec(
			lock
		);
	if (!match) throw new Error("Cargo.lock does not list the database.");
	return { version: match[1], checksum: match[2] };
}

async function readDatabase(pinned: PinnedCrate): Promise<ReflectionDatabase> {
	const crate = `rbx_reflection_database-${pinned.version}`;
	const response = await fetchOk(
		`https://static.crates.io/crates/rbx_reflection_database/${encodeURIComponent(crate)}.crate`
	);
	const bytes = Buffer.from(await response.arrayBuffer());
	const checksum = createHash("sha256").update(bytes).digest("hex");
	if (checksum !== pinned.checksum) {
		throw new Error(
			`${crate} does not match the checksum in Rojo's Cargo.lock.`
		);
	}
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-services-"));
	try {
		const archive = path.join(dir, "crate.tar.gz");
		fs.writeFileSync(archive, bytes);
		const untar = spawnSync("tar", ["-xzf", archive, "-C", dir]);
		if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
		return decode(
			fs.readFileSync(path.join(dir, crate, "database.msgpack"))
		) as ReflectionDatabase;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const rojoVersion = pinnedRojoVersion();
const database = await bundledDatabase(rojoVersion);
const services = selectServices(await readDatabase(database));
fs.writeFileSync(OUTPUT, renderServicesModule(services, rojoVersion));
console.log(
	`Wrote ${services.length} services from Rojo ${rojoVersion} (database ${database.version}) to ${OUTPUT}`
);
