import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { bundleCli, createProject, invocation } from "./harness.js";

describe("end to end project files edited by hand", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let project: ReturnType<typeof createProject>;
	let cache: string;

	const rogen = (...args: string[]) => {
		const [command, rest] = invocation(bundle.cli, args);
		return spawnSync(command, rest, {
			cwd: project.dir,
			encoding: "utf8",
			env: { ...process.env, XDG_CACHE_HOME: cache, NO_COLOR: "1" },
		});
	};

	const projectFile = () => path.join(project.dir, "default.project.json");

	const editByHand = () => {
		const file = JSON.parse(fs.readFileSync(projectFile(), "utf8"));
		file.tree.ServerStorage = { Assets: { $className: "Folder" } };
		fs.writeFileSync(projectFile(), JSON.stringify(file, null, 2));
	};

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		cache = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-hand-edits-"));
		project = createProject({
			"default.rogen.json": JSON.stringify({
				sourcePaths: ["src"],
				routes: { Server: "ServerScriptService" },
			}),
			"src/Server/Main.server.luau": "",
		});
	});

	afterEach(() => {
		project.dispose();
		fs.rmSync(cache, { recursive: true, force: true });
	});

	it("should refuse to lose an edit, say where it belongs, and write it once it is in default.rogen.json", () => {
		expect(rogen("build").status).toBe(0);
		editByHand();

		const checked = rogen("check", "--json");
		expect(checked.status).toBe(1);
		expect(JSON.parse(checked.stdout).diagnostics[0]).toMatchObject({
			code: "output.editedByHand",
		});

		const refused = rogen("build");
		expect(refused.status).toBe(1);
		expect(refused.stderr).toContain("output.editedByHand");
		expect(refused.stderr).toContain("would lose ServerStorage.");
		expect(
			JSON.parse(fs.readFileSync(projectFile(), "utf8")).tree
		).toHaveProperty("ServerStorage");

		fs.writeFileSync(
			path.join(project.dir, "default.rogen.json"),
			JSON.stringify({
				sourcePaths: ["src"],
				routes: { Server: "ServerScriptService" },
				tree: {
					$className: "DataModel",
					ServerStorage: { Assets: { $className: "Folder" } },
				},
			})
		);
		expect(rogen("build").status).toBe(0);
		expect(rogen("check").status).toBe(0);
	}, 60_000);

	it("should write over the edit with --force", () => {
		rogen("build");
		editByHand();

		expect(rogen("build", "--force").status).toBe(0);

		expect(
			JSON.parse(fs.readFileSync(projectFile(), "utf8")).tree
		).not.toHaveProperty("ServerStorage");
	}, 60_000);

	it("should not call a stale file an edit", () => {
		rogen("build");
		fs.writeFileSync(
			path.join(project.dir, "src/Server/Other.server.luau"),
			""
		);
		fs.writeFileSync(
			path.join(project.dir, "default.rogen.json"),
			JSON.stringify({
				sourcePaths: ["src"],
				routes: { Server: "ServerScriptService" },
				globIgnorePaths: ["**/Ignored/**"],
			})
		);

		const checked = rogen("check", "--json");

		expect(
			JSON.parse(checked.stdout).diagnostics.map(
				({ code }: { code: string }) => code
			)
		).toContain("output.differs");
		expect(rogen("build").status).toBe(0);
	}, 60_000);

	it("should leave a file that rojo fmt-project formatted alone", () => {
		rogen("build");
		const file = JSON.parse(fs.readFileSync(projectFile(), "utf8"));
		fs.writeFileSync(
			projectFile(),
			JSON.stringify({ name: "project", ...file }, null, 4)
		);

		expect(rogen("build").status).toBe(0);
	}, 60_000);
});
