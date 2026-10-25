import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	RunningRogen,
	bundleCli,
	createProject,
	eventually,
	outputProblem,
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
		session = new RunningRogen(
			bundle.cli,
			project.dir,
			args,
			cwd,
			args.includes("-o") ? "build --watch" : "write --watch"
		);
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
			"default.rogen.json": CONFIG,
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

	it("should rewrite when a source file is added and removed", async () => {
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

	it("should keep the last project file while no source path exists, and write again once one does", async () => {
		const file = path.join(project.dir, "default.project.json");
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		fs.renameSync(
			path.join(project.dir, "src"),
			path.join(project.dir, "moved")
		);
		await eventually(() => {
			expect(running.output).toContain("scan.missingSourcePath");
		});
		expect(fs.readFileSync(file, "utf8")).toContain("src/A.server.luau");

		fs.renameSync(
			path.join(project.dir, "moved"),
			path.join(project.dir, "src")
		);
		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.luau");
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

	it("should write the sourcemap after each write when it is sourcemap --watch", async () => {
		const map = path.join(project.dir, "sourcemap.json");
		session = new RunningRogen(
			bundle.cli,
			project.dir,
			["-o", "sourcemap.json"],
			undefined,
			"sourcemap --watch"
		);
		await eventually(() => {
			expect(fs.readFileSync(map, "utf8")).toContain("A");
		});

		writeProjectFile(project.dir, "src/Added.luau");
		await eventually(() => {
			expect(fs.readFileSync(map, "utf8")).toContain("Added");
		});
	}, 30_000);

	it("should build the place again when a script is edited in place", async () => {
		const place = path.join(project.dir, "game.rbxlx");
		start(["-o", "game.rbxlx"]);
		await eventually(() => {
			expect(fs.readFileSync(place, "utf8")).toContain("A");
		});

		writeProjectFile(project.dir, "src/A.server.luau", "return 12345");
		await eventually(() => {
			expect(fs.readFileSync(place, "utf8")).toContain("12345");
		});
	}, 30_000);

	it("should write the sourcemap again when a model file is edited in place", async () => {
		const map = path.join(project.dir, "sourcemap.json");
		writeProjectFile(
			project.dir,
			"src/Thing.model.json",
			JSON.stringify({ ClassName: "Folder" })
		);
		session = new RunningRogen(
			bundle.cli,
			project.dir,
			["-o", "sourcemap.json", "--include-non-scripts"],
			undefined,
			"sourcemap --watch"
		);
		await eventually(() => {
			expect(fs.readFileSync(map, "utf8")).toContain('"Folder"');
		});

		writeProjectFile(
			project.dir,
			"src/Thing.model.json",
			JSON.stringify({ ClassName: "Configuration" })
		);
		await eventually(() => {
			expect(fs.readFileSync(map, "utf8")).toContain("Configuration");
		});
	}, 30_000);

	it("should print each sourcemap on stdout when sourcemap --watch has no -o", async () => {
		session = new RunningRogen(
			bundle.cli,
			project.dir,
			[],
			undefined,
			"sourcemap --watch"
		);
		await eventually(() => {
			expect(session?.stdout).toContain("A.server.luau");
		});

		writeProjectFile(project.dir, "src/Added.luau");
		await eventually(() => {
			expect(session?.stdout).toContain("Added.luau");
		});
		const documents = (session?.stdout ?? "")
			.split("\n")
			.filter((line) => line.trim() !== "");
		for (const document of documents)
			expect(() => JSON.parse(document)).not.toThrow();
	}, 30_000);

	it("should count the warnings a rewrite doesn't repeat", async () => {
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
			"default.rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);

		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
		expect(await tree()).not.toContain("ServerScriptService");
		expect(session?.output).toContain("default.rogen.json changed");
	}, 30_000);

	it("should keep writing from the last valid config while the config is invalid", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		writeProjectFile(
			project.dir,
			"default.rogen.json",
			'{ "routes": { "*": "ReplicatedStorage"'
		);
		await eventually(() => {
			expect(running.output).toContain(
				"Still writing from the last valid"
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
			"default.rogen.json",
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
			"lobby/default.rogen.json",
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
			"lobby/default.rogen.json",
			JSON.stringify({
				globIgnorePaths: ["nothing/**"],
				routes: { "*": "Workspace" },
			})
		);
		await eventually(() => {
			expect(session?.output).toContain(
				"lobby/default.rogen.json changed"
			);
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

	it("should watch the one project it is given, and build no other", async () => {
		writeProjectFile(
			project.dir,
			"lobby/default.rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);
		writeProjectFile(project.dir, "lobby/src/L.luau");
		start(["lobby"]);
		await eventually(async () => {
			expect(await tree("lobby/default.project.json")).toContain(
				"<- src/L.luau"
			);
		});

		writeProjectFile(project.dir, "src/B.luau");
		writeProjectFile(project.dir, "lobby/src/M.luau");
		await eventually(async () => {
			expect(await tree("lobby/default.project.json")).toContain(
				"<- src/M.luau"
			);
		});
		expect(
			fs.existsSync(path.join(project.dir, "default.project.json"))
		).toBe(false);
	}, 30_000);

	it("should stop building a config that is deleted, and build it again when it returns", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		fs.rmSync(path.join(project.dir, "default.rogen.json"));
		await eventually(() => {
			expect(running.output).toContain("default.rogen.json removed");
		});

		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);
		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
		expect(running.output).toContain("default.rogen.json added");
	}, 30_000);

	it("should build from default.rogen.jsonc when the config is renamed to it", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		fs.renameSync(
			path.join(project.dir, "default.rogen.json"),
			path.join(project.dir, "default.rogen.jsonc")
		);
		await eventually(() => {
			expect(running.output).toContain("default.rogen.jsonc added");
		});

		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.luau");
		});
	}, 30_000);

	it("should watch the config of a folder named from below, and reload it when it changes", async () => {
		const running = start([".."], path.join(project.dir, "src"));
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});
		expect(running.output).toContain(
			"rogen write --watch · ../default.rogen.json"
		);

		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({ routes: { "*": "Workspace" } })
		);

		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
	}, 30_000);

	it("should not mind a config of another name that comes to the folder", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		writeProjectFile(
			project.dir,
			"arena.rogen.json",
			JSON.stringify({
				name: "Arena",
				routes: { "*": "Workspace" },
			})
		);
		writeProjectFile(project.dir, "src/B.server.luau");

		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.server.luau");
		});
		expect(running.output).not.toContain("arena.rogen.json");
		expect(
			fs.existsSync(path.join(project.dir, "arena.project.json"))
		).toBe(false);
	}, 30_000);

	it("should pick up a source path that appears later", async () => {
		writeProjectFile(
			project.dir,
			"default.rogen.json",
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

	it("should print only JSON lines on stdout with --json, one per write", async () => {
		const watching = start(["--json"]);
		await eventually(() => {
			expect(watching.stdout).toContain('"write"');
		});

		writeProjectFile(project.dir, "src/B.luau");

		await eventually(() => {
			const lines = watching.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(lines.map((line) => line.write.outcome)).toEqual([
				"wrote",
				"wrote",
			]);
			expect(
				outputProblem(["write", "--watch", "--json"], watching.stdout)
			).toBeUndefined();
		});
	}, 30_000);

	it("should keep the project file of every config of the folder current when it is write --watch", async () => {
		fs.rmSync(path.join(project.dir, "default.rogen.json"));
		for (const name of ["game", "lobby"])
			writeProjectFile(
				project.dir,
				`${name}.rogen.json`,
				JSON.stringify({ name, ...JSON.parse(CONFIG) })
			);
		session = new RunningRogen(
			bundle.cli,
			project.dir,
			["--watch"],
			undefined,
			"write"
		);
		await eventually(async () => {
			expect(await tree("game.project.json")).toContain(
				"<- src/A.server.luau"
			);
			expect(await tree("lobby.project.json")).toContain(
				"<- src/A.server.luau"
			);
		});

		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree("game.project.json")).toContain("<- src/B.luau");
			expect(await tree("lobby.project.json")).toContain("<- src/B.luau");
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
