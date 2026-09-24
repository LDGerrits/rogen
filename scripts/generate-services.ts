import { decode } from "@msgpack/msgpack";
import { spawnSync } from "child_process";
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

async function bundledDatabaseVersion(rojoVersion: string): Promise<string> {
	const lock = await (
		await fetchOk(
			`https://raw.githubusercontent.com/rojo-rbx/rojo/v${rojoVersion}/Cargo.lock`
		)
	).text();
	const match = /name = "rbx_reflection_database"\nversion = "([^"]+)"/.exec(
		lock
	);
	if (!match) throw new Error("Cargo.lock does not list the database.");
	return match[1];
}

async function readDatabase(version: string): Promise<ReflectionDatabase> {
	const crate = `rbx_reflection_database-${version}`;
	const response = await fetchOk(
		`https://static.crates.io/crates/rbx_reflection_database/${encodeURIComponent(crate)}.crate`
	);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-services-"));
	try {
		const archive = path.join(dir, "crate.tar.gz");
		fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
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
const databaseVersion = await bundledDatabaseVersion(rojoVersion);
const services = selectServices(await readDatabase(databaseVersion));
fs.writeFileSync(OUTPUT, renderServicesModule(services));
console.log(
	`Wrote ${services.length} services from Rojo ${rojoVersion} (database ${databaseVersion}) to ${OUTPUT}`
);
