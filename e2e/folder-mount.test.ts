import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	bundleCli,
	createProject,
	eventually,
	invocation,
	sourcemapTree,
	writeProjectFile,
} from "./harness.js";

describeWithRojo("end to end folder mounts", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		project = createProject({
			"default.rogen.json": JSON.stringify({
				sourcePaths: ["src"],
				routes: {
					Server: "ServerScriptService",
					Client: "StarterPlayer/StarterPlayerScripts",
				},
			}),
			"src/Inventory/Server/Save.luau": "",
			"src/Inventory/Client/Show.client.luau": "",
		});
	});

	afterEach(() => {
		project.dispose();
	});

	it("should let plain Rojo see a file added to a routing folder after the build", async () => {
		const [command, args] = invocation(bundle.cli, ["write"]);
		spawnSync(command, args, { cwd: project.dir });

		writeProjectFile(project.dir, "src/Inventory/Server/Load.luau");

		const tree = await sourcemapTree(project.dir, "default.project.json");
		expect(tree).toContain(
			"Load: ModuleScript  <- src/Inventory/Server/Load.luau"
		);
	}, 30_000);

	it("should let a watching Rojo see code compiled after the project file was written", async () => {
		writeProjectFile(
			project.dir,
			"default.rogen.json",
			JSON.stringify({
				sourcePaths: ["src"],
				compiledPath: "out",
				routes: { server: "ServerScriptService" },
			})
		);
		writeProjectFile(project.dir, "src/Coins/server/Pay.luau");
		const [command, args] = invocation(bundle.cli, ["write"]);
		spawnSync(command, args, { cwd: project.dir });
		const map = path.join(project.dir, "sourcemap.json");
		const rojo = spawn(
			"rojo",
			[
				"sourcemap",
				"default.project.json",
				"--watch",
				"-o",
				"sourcemap.json",
			],
			{ cwd: project.dir, detached: true, stdio: "ignore" }
		);
		try {
			await eventually(() => {
				expect(fs.existsSync(map)).toBe(true);
			});

			writeProjectFile(project.dir, "out/Coins/server/Pay.luau");
			await eventually(() => {
				expect(fs.readFileSync(map, "utf8")).toContain("Pay");
			});
		} finally {
			process.kill(-rojo.pid!, "SIGKILL");
		}
	}, 30_000);
});
