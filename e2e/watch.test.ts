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
	rootDirs: ["src"],
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
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "Workspace" },
			})
		);

		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
		expect(await tree()).not.toContain("ServerScriptService");
		expect(session?.output).toContain("default.rogen.json changed");
	}, 30_000);

	it("should keep building from the last valid config while the config is invalid", async () => {
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
			"default.rogen.json",
			JSON.stringify({ rootDirs: ["src"], routes: { "*": "Workspace" } })
		);
		await eventually(async () => {
			expect(await tree()).toContain("  Workspace: Workspace");
		});
	}, 30_000);

	it("should keep command line overrides across a config reload", async () => {
		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "ReplicatedStorage" },
				variants: ["mock"],
			})
		);
		writeProjectFile(project.dir, "src/Analytics.luau");
		writeProjectFile(project.dir, "src/Analytics.mock.luau");
		start(["--variant", "mock"]);
		await eventually(async () => {
			expect(await tree()).toContain("<- src/Analytics.mock.luau");
		});

		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "ReplicatedStorage" },
				variants: ["mock", "dev"],
			})
		);

		await eventually(() => {
			expect(session?.output).toContain("default.rogen.json changed");
		});
		writeProjectFile(project.dir, "src/Other.luau");
		await eventually(async () => {
			const built = await tree();
			expect(built).toContain("<- src/Other.luau");
			expect(built).toContain("<- src/Analytics.mock.luau");
		});
	}, 30_000);

	it("should watch several configs", async () => {
		writeProjectFile(
			project.dir,
			"source.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "Workspace" },
			})
		);
		start(["default", "source"]);
		await eventually(async () => {
			expect(await tree("default.project.json")).toContain(
				"<- src/A.server.luau"
			);
			expect(await tree("source.project.json")).toContain(
				"<- src/A.server.luau"
			);
		});

		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree("default.project.json")).toContain(
				"<- src/B.luau"
			);
			expect(await tree("source.project.json")).toContain(
				"<- src/B.luau"
			);
		});
	}, 30_000);

	it("should build a config added while it runs, and stop building one that is deleted", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		writeProjectFile(
			project.dir,
			"lobby.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "Workspace" },
			})
		);
		await eventually(async () => {
			expect(await tree("lobby.project.json")).toContain(
				"<- src/A.server.luau"
			);
		});
		expect(running.output).toContain("lobby.rogen.json added");

		fs.rmSync(path.join(project.dir, "lobby.rogen.json"));
		await eventually(() => {
			expect(running.output).toContain("lobby.rogen.json removed");
		});
		fs.rmSync(path.join(project.dir, "lobby.project.json"));
		writeProjectFile(project.dir, "src/B.luau");
		await eventually(async () => {
			expect(await tree()).toContain("<- src/B.luau");
		});
		expect(
			fs.existsSync(path.join(project.dir, "lobby.project.json"))
		).toBe(false);
	}, 30_000);

	it("should watch the configs of the folder above, and pick up a config added there", async () => {
		const running = start([], path.join(project.dir, "src"));
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});
		expect(running.output).toContain("rogen watch · default · in ..");

		writeProjectFile(
			project.dir,
			"lobby.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "Workspace" },
			})
		);

		await eventually(async () => {
			expect(await tree("lobby.project.json")).toContain(
				"<- src/A.server.luau"
			);
		});
	}, 30_000);

	it("should pick up a root dir that appears later", async () => {
		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src", "later"],
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

	it("should exit cleanly when interrupted", async () => {
		const running = start();
		await eventually(() => {
			expect(running.output).toContain("default.project.json · ");
		});

		expect(await running.stop()).toBe(0);
	}, 30_000);
});
