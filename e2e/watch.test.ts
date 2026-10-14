import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	RunningRogen,
	bundleCli,
	createProject,
	eventually,
	sourcemapTree,
	writeProjectFile,
} from "./harness.js";

const CONFIG = JSON.stringify({
	sourcePaths: ["src"],
	routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
});

describeWithRojo("end to end watch", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;
	let session: RunningRogen | undefined;

	const tree = (file = "default.project.json") =>
		sourcemapTree(project.dir, file);

	const start = (args: readonly string[] = [], cwd?: string) => {
		session = new RunningRogen(bundle.cli, project.dir, args, cwd);
		return session;
	};

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		project = createProject({
			"rogen.json": CONFIG,
			"src/A.server.luau": "",
		});
	});

	afterEach(async () => {
		await session?.stop();
		session = undefined;
		project.dispose();
	});

	it("should write the project file when it starts", async () => {
		start();

		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});
	}, 30_000);

	it("should rebuild when a source file is added and removed", async () => {
		start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.luau");
		});

		fs.rmSync(path.join(project.dir, "src/A.server.luau"));
		await eventually(async () => {
			expect(await tree()).not.toContain("<- src/A.server.luau");
		});
	}, 30_000);

	it("should build the place with Rojo after each write when given -o", async () => {
		const place = path.join(project.dir, "game.rbxlx");
		start(["-o", "game.rbxlx"]);
		await eventually(() => {
			expect(fs.existsSync(place)).toBe(true);
			expect(fs.readFileSync(place, "utf8")).toContain("A");
		});

		writeProjectFile(project.dir, "src/Added.luau");
		await eventually(() => {
			expect(fs.readFileSync(place, "utf8")).toContain("Added");
		});
	}, 30_000);

	it("should count the warnings a rebuild doesn't repeat", async () => {
		writeProjectFile(project.dir, "src/Save@sever.luau");
		const running = start();
		await eventually(() => {
			expect(running.output).toContain("did you mean");
		});

		writeProjectFile(project.dir, "src/B.luau");

		await eventually(() => {
			expect(running.output).toContain(
				"default.project.json · wrote · 1 warning as before"
			);
		});
		expect(running.output.split("did you mean").length).toBe(2);
	}, 30_000);

	it("should reload when the config changes", async () => {
		start();
		await eventually(async () => {
			expect(await tree()).toContain(
				"  ServerScriptService: ServerScriptService"
			);
		});

		writeProjectFile(
			project.dir,
			"rogen.json",
			JSON.stringify({
				routes: { "*": "Workspace" },
			})
		);

		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
		expect(await tree()).not.toContain("ServerScriptService");
		expect(session?.output).toContain("rogen.json changed");
	}, 30_000);

	it("should keep building from the last valid config while the config is invalid", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		writeProjectFile(
			project.dir,
			"rogen.json",
			'{ "routes": { "*": "ReplicatedStorage"'
		);
		await eventually(() => {
			expect(running.output).toContain(
				"Still building from the last valid"
			);
		});
		expect(
			running.output.split("invalid JSONC: expected '}'")
		).toHaveLength(2);

		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.luau");
		});
		expect(await tree()).toContain("A: Script");

		writeProjectFile(
			project.dir,
			"rogen.json",
			JSON.stringify({
				sourcePaths: ["src"],
				routes: { "*": "Workspace" },
			})
		);
		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
	}, 30_000);

	it("should keep watching the folders it was given across a config reload", async () => {
		writeProjectFile(
			project.dir,
			"lobby/rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);
		writeProjectFile(project.dir, "lobby/src/Analytics.luau");
		start(["lobby"]);
		await eventually(async () => {
			expect(await tree("lobby/default.project.json")).toContain(
				"<- src/Analytics.luau"
			);
		});

		writeProjectFile(
			project.dir,
			"lobby/rogen.json",
			JSON.stringify({
				routes: { "*": "Workspace" },
				globIgnorePaths: ["nothing/**"],
			})
		);
		await eventually(() => {
			expect(session?.output).toContain("lobby/rogen.json changed");
		});

		writeProjectFile(project.dir, "lobby/src/Other.luau");
		await eventually(async () => {
			const built = await tree("lobby/default.project.json");
			expect(built).toContain("<- src/Other.luau");
			expect(built).toContain("<- src/Analytics.luau");
		});
		expect(
			fs.existsSync(path.join(project.dir, "default.project.json"))
		).toBe(false);
	}, 30_000);

	it("should watch several projects", async () => {
		writeProjectFile(
			project.dir,
			"lobby/rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);
		writeProjectFile(project.dir, "lobby/src/L.luau");
		start([".", "lobby"]);
		await eventually(async () => {
			expect(await tree("default.project.json")).toContain(
				"<- src/A.server.luau"
			);
			expect(await tree("lobby/default.project.json")).toContain(
				"<- src/L.luau"
			);
		});

		writeProjectFile(project.dir, "src/B.luau");
		writeProjectFile(project.dir, "lobby/src/M.luau");
		await eventually(async () => {
			expect(await tree("default.project.json")).toContain(
				"<- src/B.luau"
			);
			expect(await tree("lobby/default.project.json")).toContain(
				"<- src/M.luau"
			);
		});
	}, 30_000);

	it("should stop building a config that is deleted, and build it again when it returns", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		fs.rmSync(path.join(project.dir, "rogen.json"));
		await eventually(() => {
			expect(running.output).toContain("rogen.json removed");
		});

		writeProjectFile(
			project.dir,
			"rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);
		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
		expect(running.output).toContain("rogen.json added");
	}, 30_000);

	it("should build from rogen.jsonc when the config is renamed to it", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		fs.renameSync(
			path.join(project.dir, "rogen.json"),
			path.join(project.dir, "rogen.jsonc")
		);
		await eventually(() => {
			expect(running.output).toContain("rogen.jsonc added");
		});

		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.luau");
		});
	}, 30_000);

	it("should watch the config of the folder above, and reload it when it changes", async () => {
		const running = start([], path.join(project.dir, "src"));
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});
		expect(running.output).toContain(
			"rogen build --watch · project · in .."
		);

		writeProjectFile(
			project.dir,
			"rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);

		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
	}, 30_000);

	it("should pick up a source path that appears later", async () => {
		writeProjectFile(
			project.dir,
			"rogen.json",
			JSON.stringify({
				sourcePaths: ["src", "later"],
				routes: { "*": "ReplicatedStorage" },
			})
		);
		start();
		await eventually(() => {
			expect(session?.output).toContain("does not exist");
		});

		writeProjectFile(project.dir, "later/Late.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- later/Late.luau");
		});
	}, 30_000);

	it("should print only JSON lines on stdout with --json, one per build", async () => {
		const watching = start(["--json"]);
		await eventually(() => {
			expect(watching.stdout).toContain('"build"');
		});

		writeProjectFile(project.dir, "src/B.luau");

		await eventually(() => {
			const lines = watching.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(lines.map((line) => line.build.outcome)).toEqual([
				"wrote",
				"wrote",
			]);
		});
	}, 30_000);

	it("should exit cleanly when interrupted", async () => {
		const running = start();
		await eventually(() => {
			expect(running.output).toContain("default.project.json · ");
		});

		expect(await running.stop()).toBe(0);
	}, 30_000);
});
