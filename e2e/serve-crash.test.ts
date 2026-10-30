import { decode } from "@msgpack/msgpack";
import fs from "fs";
import os from "os";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	RunningRogen,
	bundleCli,
	createProject,
	eventually,
	writeProjectFile,
} from "./harness.js";
import { freePort, projectFiles, useServeProject } from "./serve-fixtures.js";

/** A Rojo that serves its project for a moment, then crashes as Rojo 7.7.1 does on a deleted folder. */
const CRASHING_ROJO = `#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const args = process.argv.slice(2);
if (args[0] === "--version") {
	console.log("Rojo 7.7.1");
	process.exit(0);
}
const port = Number(args[args.indexOf("--port") + 1]);
const project = JSON.parse(fs.readFileSync(args[1], "utf8")).name;
http
	.createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		response.end(JSON.stringify({ projectName: project, serverVersion: "7.7.1", sessionId: String(process.pid) }));
	})
	.listen(port, "127.0.0.1");
setTimeout(() => {
	for (const line of [
		"Rojo crashed! You are running Rojo 7.7.1.",
		"Details: called \`Result::unwrap()\` on an \`Err\` value",
		"in file src/change_processor.rs on line 179",
	])
		console.error("[ERROR rojo] " + line);
	process.exit(1);
}, 1500);
`;

async function servedNames(port: number): Promise<string[]> {
	const base = `http://127.0.0.1:${port}/api`;
	const info = decode(
		new Uint8Array(await (await fetch(`${base}/rojo`)).arrayBuffer())
	) as { rootInstanceId: string };
	const read = decode(
		new Uint8Array(
			await (
				await fetch(`${base}/read/${info.rootInstanceId}`)
			).arrayBuffer()
		)
	) as { instances: Record<string, { Name: string }> };
	return Object.values(read.instances).map(({ Name }) => Name);
}

const describeOnUnix = process.platform === "win32" ? describe.skip : describe;

describeOnUnix("end to end serve with a Rojo that keeps crashing", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;
	let bin: string;
	let serving: RunningRogen | undefined;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(async () => {
		project = createProject(projectFiles(await freePort(37000)));
		fs.rmSync(path.join(project.dir, "rokit.toml"));
		bin = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-e2e-bin-"));
		fs.writeFileSync(path.join(bin, "rojo"), CRASHING_ROJO, {
			mode: 0o755,
		});
	});

	afterEach(async () => {
		await serving?.stop();
		project.dispose();
		fs.rmSync(bin, { recursive: true, force: true });
	});

	it("should restart it once, then give up with its crash text and exit 1", async () => {
		serving = new RunningRogen(
			bundle.cli,
			project.dir,
			[],
			project.dir,
			"serve",
			{ PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` }
		);

		expect(await serving.exited).toBe(1);
		expect(serving.output).toContain(
			"Rojo crashed, so Rogen restarted it on 127.0.0.1:"
		);
		expect(serving.output).toContain(
			[
				"error: Rojo crashed again right after a restart, so Rogen stopped serving Game: (rojo.crashed)",
				"  Rojo crashed! You are running Rojo 7.7.1.",
				"  Details: called `Result::unwrap()` on an `Err` value",
				"  in file src/change_processor.rs on line 179",
			].join("\n")
		);
		expect(serving.output.match(/Rojo crashed!/g)).toHaveLength(1);
	}, 40_000);
});

describeWithRojo("end to end serve when Rojo crashes", () => {
	const serve = useServeProject(38000, { "src/Shop/Buy.luau": "" });

	it("should start Rojo again after it crashes on a deleted folder, and keep serving", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving default.rogen.json");
		}, 20_000);

		fs.rmSync(path.join(serve.dir, "src/Shop"), { recursive: true });

		await eventually(() => {
			expect(serving.output).toContain(
				`Rojo crashed, so Rogen restarted it on 127.0.0.1:${serve.port}.`
			);
		}, 20_000);
		writeProjectFile(serve.dir, "src/Fresh.luau");
		await eventually(async () => {
			expect(await servedNames(serve.port)).toContain("Fresh");
		}, 20_000);
		expect(serving.output).not.toContain("error");
		expect(await serving.stop()).toBe(130);
	}, 60_000);
});
