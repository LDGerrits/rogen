import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { decode } from "@msgpack/msgpack";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	createProject,
	eventually,
	invocation,
	outputProblem,
	writeProjectFile,
} from "./harness.js";
import {
	config,
	projectFiles,
	rojoProjectFile,
	useServeProject,
} from "./serve-fixtures.js";

async function rojoProject(port: number): Promise<string | undefined> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/rojo`, {
			signal: AbortSignal.timeout(1_000),
		});
		const info = decode(new Uint8Array(await response.arrayBuffer())) as {
			projectName: string;
		};
		return info.projectName;
	} catch {
		return undefined;
	}
}

async function served(port: number): Promise<Record<string, unknown>> {
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
	return read.instances;
}

async function servedNames(port: number): Promise<string[]> {
	return Object.values(await served(port)).map(
		(instance) => (instance as { Name: string }).Name
	);
}

describeWithRojo("end to end serve", () => {
	const serve = useServeProject(35000);

	it("should build, start the pinned Rojo on the project file, and stop it on Ctrl+C", async () => {
		const serving = serve.start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving Game with Rojo 7.7.1 at 127.0.0.1:${serve.port}.`
			);
		}, 20_000);
		expect(await rojoProject(serve.port)).toBe("Game");
		await eventually(() => {
			expect(serving.stdout).toContain("Rojo server listening:");
		}, 20_000);

		expect(serving.stdout).toContain(`Port:    ${serve.port}`);
		expect(serving.stdout).not.toContain("Serving Game");
		expect(await serving.stop()).toBe(130);
		expect(await rojoProject(serve.port)).toBeUndefined();
	}, 40_000);

	it("should end the Rojo with it when the terminal closes", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving Game");
		}, 20_000);

		await serving.kill("SIGHUP");

		await eventually(async () => {
			expect(await rojoProject(serve.port)).toBeUndefined();
		}, 10_000);
	}, 40_000);

	it("should end the Rojo a killed serve left, and serve again so a new file reaches it", async () => {
		const first = serve.start();
		await eventually(() => {
			expect(first.output).toContain("Serving Game");
		}, 20_000);
		await first.kill("SIGKILL");
		expect(await rojoProject(serve.port)).toBe("Game");

		const second = serve.start();
		await eventually(() => {
			expect(second.output).toContain("that a rogen serve (process");
			expect(second.output).toContain("Serving Game");
		}, 30_000);
		writeProjectFile(serve.dir, "src/Fresh.luau");

		await eventually(async () => {
			expect(await servedNames(serve.port)).toContain("Fresh");
		}, 20_000);
		expect(await second.stop()).toBe(130);
		expect(await rojoProject(serve.port)).toBeUndefined();
	}, 60_000);

	it("should serve a meta file created beside a script", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving Game");
		}, 20_000);

		writeProjectFile(
			serve.dir,
			"src/A.meta.json",
			JSON.stringify({ attributes: { Level: 7 } })
		);

		await eventually(async () => {
			expect(JSON.stringify(await served(serve.port))).toContain("Level");
		}, 20_000);
	}, 40_000);

	it("should keep building while it serves", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving Game");
		}, 20_000);

		writeProjectFile(serve.dir, "src/B.luau");

		await eventually(() => {
			expect(serving.output).toContain("1 file changed");
		});
	}, 40_000);

	it("should show Rojo's errors as its own lines, and nothing else Rojo prints", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving Game");
		}, 20_000);

		writeProjectFile(serve.dir, "src/Bad.model.json", "{ nope");

		await eventually(() => {
			expect(serving.output).toMatch(/Rojo: .*src[\\/]Bad\.model\.json/);
		});
		expect(serving.output).not.toContain("Caused by");
		expect(serving.output).not.toContain("librojo");
		expect(serving.output).not.toContain(serve.dir);
	}, 40_000);

	it("should stop the server when the config is deleted, and start it again when it returns", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving Game");
		}, 20_000);

		fs.rmSync(path.join(serve.dir, "default.rogen.json"));

		await eventually(() => {
			expect(serving.output).toContain(
				"Stopped serving Game: its config is gone."
			);
		}, 20_000);
		expect(await rojoProject(serve.port)).toBeUndefined();

		writeProjectFile(serve.dir, "default.rogen.json", config(serve.port));

		await eventually(async () => {
			expect(await rojoProject(serve.port)).toBe("Game");
		}, 20_000);
		expect(serving.output).toContain("default.rogen.json added");
	}, 60_000);

	it("should serve two places from two terminals, the second on --port", async () => {
		for (const folder of ["lobby", "arena"]) {
			writeProjectFile(
				serve.dir,
				`places/${folder}/default.rogen.json`,
				JSON.stringify({
					name: folder,
					tree: { $className: "DataModel" },
					rogen: {
						sourcePaths: ["../shared/src", "src"],
						routes: { "*": "Workspace" },
					},
				})
			);
			writeProjectFile(serve.dir, `places/${folder}/src/A.luau`);
		}
		writeProjectFile(serve.dir, "places/shared/src/Shared.luau");

		const first = serve.start(["places/lobby", "--port", `${serve.port}`]);
		await eventually(() => {
			expect(first.output).toContain(
				`Serving lobby with Rojo 7.7.1 at 127.0.0.1:${serve.port}.`
			);
		}, 30_000);
		const second = serve.start([
			"places/arena",
			"--port",
			`${serve.port + 1}`,
		]);
		await eventually(() => {
			expect(second.output).toContain(
				`Serving arena with Rojo 7.7.1 at 127.0.0.1:${serve.port + 1}.`
			);
		}, 30_000);

		expect(await rojoProject(serve.port)).toBe("lobby");
		expect(await rojoProject(serve.port + 1)).toBe("arena");
		expect(await servedNames(serve.port)).toContain("Shared");
		expect(await first.stop()).toBe(130);
		expect(await rojoProject(serve.port + 1)).toBe("arena");
		expect(await second.stop()).toBe(130);
	}, 90_000);

	it("should refuse a second project, as Rojo does, and start nothing", async () => {
		writeProjectFile(
			serve.dir,
			"lobby/default.rogen.json",
			config(serve.port + 1, { name: "Lobby" })
		);

		const refused = serve.start([".", "lobby"]);

		expect(await refused.exited).toBe(2);
		expect(refused.output).toContain("unexpected argument 'lobby'");
		expect(await rojoProject(serve.port)).toBeUndefined();
		expect(await rojoProject(serve.port + 1)).toBeUndefined();
	}, 40_000);

	it("should serve the place it is run in", async () => {
		writeProjectFile(
			serve.dir,
			"places/lobby/default.rogen.json",
			config(serve.port + 1, { name: "Lobby" })
		);
		writeProjectFile(serve.dir, "places/lobby/src/A.luau");

		const serving = serve.start([], path.join(serve.dir, "places/lobby"));

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving Lobby with Rojo 7.7.1 at 127.0.0.1:${serve.port + 1}.`
			);
		}, 30_000);
		expect(await serving.stop()).toBe(130);
	}, 60_000);

	it("should find no config for a bare serve at the root of several places", async () => {
		fs.rmSync(path.join(serve.dir, "default.rogen.json"));
		writeProjectFile(
			serve.dir,
			"places/lobby/default.rogen.json",
			config(serve.port + 1, { name: "Lobby" })
		);

		const refused = serve.start();

		expect(await refused.exited).toBe(1);
		expect(refused.output).toContain(
			"No default.rogen.json or default.project.json in this folder"
		);
	}, 40_000);

	it("should serve only the project in the folder it is given", async () => {
		writeProjectFile(
			serve.dir,
			"lobby/default.rogen.json",
			config(serve.port + 1, { name: "Lobby" })
		);
		writeProjectFile(serve.dir, "lobby/src/A.luau");

		const serving = serve.start(["lobby"]);

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving Lobby with Rojo 7.7.1 at 127.0.0.1:${serve.port + 1}.`
			);
		}, 20_000);
		expect(await rojoProject(serve.port)).toBeUndefined();
		expect(await serving.stop()).toBe(130);
	}, 40_000);

	it("should name the project after its folder when default.rogen.json sets no name", async () => {
		writeProjectFile(
			serve.dir,
			"default.rogen.json",
			JSON.stringify({
				servePort: serve.port,
				tree: { $className: "DataModel" },
				rogen: { routes: { "*": "ReplicatedStorage" } },
			})
		);

		const serving = serve.start();

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving project with Rojo 7.7.1 at 127.0.0.1:${serve.port}.`
			);
		}, 20_000);
		expect(await rojoProject(serve.port)).toBe("project");
	}, 40_000);

	it("should serve a project on the port given by --port", async () => {
		writeProjectFile(
			serve.dir,
			"lobby/default.rogen.json",
			config(serve.port + 1, { name: "Lobby" })
		);
		writeProjectFile(serve.dir, "lobby/src/A.luau");

		const serving = serve.start(["lobby", "--port", `${serve.port + 2}`]);

		await eventually(() => {
			expect(serving.output).toContain(
				`Serving Lobby with Rojo 7.7.1 at 127.0.0.1:${serve.port + 2}.`
			);
		}, 30_000);
		expect(await rojoProject(serve.port + 2)).toBe("Lobby");
		expect(await rojoProject(serve.port + 1)).toBeUndefined();
	}, 60_000);

	it("should restart the server where its servePort moves it", async () => {
		const serving = serve.start();
		await eventually(() => {
			expect(serving.output).toContain("Serving Game");
		}, 20_000);

		writeProjectFile(
			serve.dir,
			"default.rogen.json",
			config(serve.port + 2)
		);

		await eventually(async () => {
			expect(await rojoProject(serve.port + 2)).toBe("Game");
		}, 20_000);
		expect(await rojoProject(serve.port)).toBeUndefined();
		expect(serving.output).toContain(
			`Stopped serving Game at 127.0.0.1:${serve.port}: its address changed.`
		);
		expect(await serving.stop()).toBe(130);
	}, 60_000);

	it("should keep the server where it is when servePort moves to a port another Rojo holds", async () => {
		const other = createProject({
			"other.project.json": rojoProjectFile(serve.port + 1, "Other"),
		});
		const rojo = spawn("rojo", ["serve", "other.project.json"], {
			cwd: other.dir,
			stdio: "ignore",
		});
		try {
			await eventually(async () => {
				expect(await rojoProject(serve.port + 1)).toBe("Other");
			}, 20_000);
			const serving = serve.start();
			await eventually(() => {
				expect(serving.output).toContain("Serving Game");
			}, 20_000);

			writeProjectFile(
				serve.dir,
				"default.rogen.json",
				config(serve.port + 1)
			);

			await eventually(() => {
				expect(serving.output).toContain(
					`Port ${serve.port + 1} is taken by Rojo serving Other, so default.rogen.json can't be served there.`
				);
			}, 20_000);
			expect(await rojoProject(serve.port)).toBe("Game");
			expect(await rojoProject(serve.port + 1)).toBe("Other");
		} finally {
			rojo.kill("SIGINT");
			other.dispose();
		}
	}, 60_000);

	it("should print only JSON lines on stdout, the build and then the server", async () => {
		const serving = serve.start(["--json"]);

		await eventually(() => {
			expect(serving.stdout).toContain('"serving"');
		}, 20_000);

		const lines = serving.stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines.map((line) => Object.keys(line)[0])).toEqual([
			"build",
			"serving",
		]);
		expect(lines[1].serving).toEqual(
			expect.objectContaining({
				config: "Game",
				server: "rojo",
				version: "7.7.1",
				project: "Game",
				port: serve.port,
			})
		);
		expect(serving.output).not.toContain("Rojo server listening");
		expect(
			outputProblem(["serve", "--json"], serving.stdout)
		).toBeUndefined();
	}, 40_000);

	it("should exit 0 at once when another serve already serves the project", async () => {
		const first = serve.start();
		await eventually(() => {
			expect(first.output).toContain("Serving Game");
		}, 20_000);

		const second = serve.start(["--json"]);

		expect(await second.exited).toBe(0);
		expect(JSON.parse(second.stdout.trim()).serving).toEqual(
			expect.objectContaining({ port: serve.port, alreadyRunning: true })
		);
		expect(
			outputProblem(["serve", "--json"], second.stdout)
		).toBeUndefined();
	}, 40_000);

	it("should build for a Rojo it didn't start, and stop once that Rojo stops", async () => {
		const [build, buildArgs] = invocation(serve.cli, ["build"]);
		expect(spawnSync(build, buildArgs, { cwd: serve.dir }).status).toBe(0);
		const rojo = spawn("rojo", ["serve", "default.project.json"], {
			cwd: serve.dir,
			stdio: "ignore",
		});
		try {
			await eventually(async () => {
				expect(await rojoProject(serve.port)).toBe("Game");
			}, 20_000);

			const serving = serve.start(["--json", "--adopt"]);
			await eventually(() => {
				expect(serving.stdout).toContain('"adopted":true');
			}, 20_000);
			writeProjectFile(serve.dir, "src/B.luau");
			await eventually(() => {
				expect(
					fs.readFileSync(
						path.join(serve.dir, "default.project.json"),
						"utf8"
					)
				).toContain("src/B.luau");
			});
			rojo.kill("SIGINT");

			expect(await serving.exited).toBe(0);
			expect(serving.stdout).toContain(
				'{"stopped":{"config":"Game","server":"rojo","reason":"exited","adopted":true}}'
			);
			expect(
				outputProblem(["serve", "--json"], serving.stdout)
			).toBeUndefined();
		} finally {
			rojo.kill("SIGINT");
		}
	}, 40_000);

	it("should refuse a Rojo it didn't start that serves another folder's project of the same name", async () => {
		const other = createProject(projectFiles(serve.port));
		const [build, buildArgs] = invocation(serve.cli, ["build"]);
		expect(spawnSync(build, buildArgs, { cwd: other.dir }).status).toBe(0);
		const rojo = spawn("rojo", ["serve", "default.project.json"], {
			cwd: other.dir,
			stdio: "ignore",
		});
		try {
			await eventually(async () => {
				expect(await rojoProject(serve.port)).toBe("Game");
			}, 20_000);

			const refused = serve.start();

			expect(await refused.exited).toBe(1);
			expect(refused.output).toContain(
				`Port ${serve.port} is taken by Rojo serving Game, which no rogen serve started`
			);
			expect(refused.output).toContain("--adopt");
		} finally {
			rojo.kill("SIGINT");
			other.dispose();
		}
	}, 40_000);

	it("should refuse a server that another checkout of the project started", async () => {
		const first = serve.start();
		await eventually(() => {
			expect(first.output).toContain("Serving Game");
		}, 20_000);
		const checkout = createProject(projectFiles(serve.port));
		try {
			const second = serve.start([], checkout.dir);

			expect(await second.exited).toBe(1);
			expect(second.output).toContain(
				`Port ${serve.port} is taken by Rojo serving Game, which rogen serve started for ${serve.dir}/default.rogen.json`
			);
		} finally {
			checkout.dispose();
		}
	}, 40_000);

	it("should serve the default when a sibling config sits beside it, and refuse the sibling on the same port, naming the file", async () => {
		writeProjectFile(
			serve.dir,
			"dist.rogen.json",
			config(serve.port, { rogen: { compiledPath: "dist" } })
		);
		const first = serve.start();
		await eventually(() => {
			expect(first.output).toContain("Serving Game");
		}, 20_000);

		const second = serve.start(["dist"]);

		expect(await second.exited).toBe(1);
		expect(second.output).toContain(
			`Port ${serve.port} is taken by Rojo serving Game, which rogen serve started for default.rogen.json, so dist.rogen.json can't be served there. Stop it, set a servePort in dist.rogen.json, or run 'rogen serve dist.rogen.json --port`
		);
		expect(second.output).not.toContain("--adopt");
		expect(await rojoProject(serve.port)).toBe("Game");
	}, 40_000);

	it("should refuse a port another project's server holds", async () => {
		const other = createProject({
			"other.project.json": rojoProjectFile(serve.port, "Other"),
		});
		const rojo = spawn("rojo", ["serve", "other.project.json"], {
			cwd: other.dir,
			stdio: "ignore",
		});
		try {
			await eventually(async () => {
				expect(await rojoProject(serve.port)).toBe("Other");
			}, 20_000);

			const serving = serve.start();

			expect(await serving.exited).toBe(1);
			expect(serving.output).toContain(
				`Port ${serve.port} is taken by Rojo serving Other, so default.rogen.json can't be served there.`
			);
		} finally {
			rojo.kill("SIGINT");
			other.dispose();
		}
	}, 40_000);

	it("should exit with Rojo's code when Rojo stops on its own", async () => {
		const serving = serve.start(["--", "--no-such-flag"]);

		expect(await serving.exited).toBe(2);
		expect(serving.output).toContain(
			"Rojo stopped serving Game with exit code 2; see what it said above. (serve.serverExited)"
		);
		expect(serving.output).toContain(
			"Rojo: Found argument '--no-such-flag'"
		);
	}, 40_000);
	describe("as Studio connects", () => {
		it("should tell when a plugin connects and when it goes away, and show it in list", async () => {
			const serving = serve.start(["--json"]);
			await eventually(() => {
				expect(serving.stdout).toContain('"serving"');
			}, 20_000);
			expect(
				JSON.parse(serving.stdout.trim().split("\n").at(-1)!).serving
			).toMatchObject({ reportsConnections: true });

			const studio = spawn(
				process.execPath,
				[
					"-e",
					`new WebSocket("ws://127.0.0.1:${serve.port}/api/socket/0"); setInterval(() => {}, 1000)`,
				],
				{ stdio: "ignore" }
			);
			try {
				await eventually(() => {
					expect(serving.stdout).toContain(
						`{"connected":{"config":"Game","server":"rojo","project":"Game","port":${serve.port},"clients":1}}`
					);
				}, 20_000);
				const listed = () => {
					const [list, listArgs] = invocation(serve.cli, [
						"list",
						"--json",
					]);
					return JSON.parse(
						spawnSync(list, listArgs, {
							cwd: serve.dir,
							encoding: "utf8",
						}).stdout
					).configs[0].serving;
				};
				await eventually(() => {
					expect(listed()).toEqual({
						server: "rojo",
						host: "127.0.0.1",
						port: serve.port,
						clients: 1,
					});
				}, 20_000);
			} finally {
				studio.kill("SIGKILL");
			}

			await eventually(() => {
				expect(serving.stdout).toContain(
					`{"disconnected":{"config":"Game","server":"rojo","project":"Game","port":${serve.port},"clients":0}}`
				);
			}, 20_000);
		}, 60_000);
	});
});
