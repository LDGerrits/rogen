import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	WatchSession,
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
	let session: WatchSession | undefined;

	const tree = (file = "default.project.json") =>
		sourcemapTree(project.dir, file);

	const start = (args: readonly string[] = []) => {
		session = new WatchSession(bundle.cli, project.dir, args);
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
		expect(session?.output).toContain("Config change detected");
	}, 30_000);

	it("should keep building from the last valid config while the config is invalid", async () => {
		const running = start();
		await eventually(async () => {
			expect(await tree()).toContain("<- src/A.server.luau");
		});

		writeProjectFile(project.dir, "default.rogen.json", "{ bad");
		await eventually(() => {
			expect(running.output).toContain(
				"Still building from the last valid"
			);
		});

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
				tags: { mock: false },
			})
		);
		writeProjectFile(project.dir, "src/Analytics.luau");
		writeProjectFile(project.dir, "src/Analytics.mock.luau");
		start(["--tag", "mock"]);
		await eventually(async () => {
			expect(await tree()).toContain("<- src/Analytics.mock.luau");
		});

		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "ReplicatedStorage" },
				tags: { mock: false, dev: false },
			})
		);

		await eventually(() => {
			expect(session?.output).toContain("Config change detected");
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
			expect(running.output).toContain("Wrote default.project.json");
		});

		expect(await running.stop()).toBe(0);
	}, 30_000);
});
