import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { stripVTControlCharacters } from "util";
import {
	describeWithRojo,
	makeRojoDir,
} from "../src/domain/rojo/__tests__/rojo-cli.js";
import { bundleCli, invocation } from "./harness.js";
import { PROJECTS_DIR, SYNCBACK_PROJECTS_DIR } from "./rojo-conformance.js";

const projects = fs
	.readdirSync(PROJECTS_DIR, { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() &&
			fs.existsSync(
				path.join(PROJECTS_DIR, entry.name, "default.project.json")
			)
	)
	.map((entry) => entry.name);

const FORMATS = ["rbxl", "rbxm", "rbxlx"];
const SOURCEMAP_FLAGS = [
	[],
	["--include-non-scripts"],
	["--absolute"],
	["--include-non-scripts", "--absolute"],
];

/** The files under `root`, by relative path, with what is in them; those `skip` names are left out. */
const snapshot = (
	root: string,
	skip: readonly string[] = []
): Record<string, string> => {
	const seen: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (skip.includes(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				seen[`${path.relative(root, full)}/`] = "";
				walk(full);
			} else
				seen[path.relative(root, full)] = fs
					.readFileSync(full)
					.toString("base64");
		}
	};
	walk(root);
	return seen;
};

interface Run {
	readonly status: number | null;
	readonly stdout: string;
}

describeWithRojo("Rogen and Rojo on the same project", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let parent: string;

	const rogen = (
		cwd: string,
		args: readonly string[],
		input?: string
	): Run => {
		const [command, rest] = invocation(bundle.cli, args);
		const result = spawnSync(command, [...rest], {
			cwd,
			encoding: "utf8",
			input,
			timeout: 60_000,
		});
		return { status: result.status, stdout: result.stdout };
	};

	const rojo = (cwd: string, args: string[], input?: string): Run => {
		const result = spawnSync("rojo", args, {
			cwd,
			encoding: "utf8",
			input,
			timeout: 60_000,
		});
		return { status: result.status, stdout: result.stdout };
	};

	beforeAll(() => {
		bundle = bundleCli();
		parent = makeRojoDir("rogen-parity-");
	});

	afterAll(() => {
		bundle.dispose();
		fs.rmSync(parent, { recursive: true, force: true });
	});

	const copies = (name: string) => {
		const dir = fs.mkdtempSync(path.join(parent, `${name}-`));
		const [byRojo, byRogen] = ["rojo", "rogen"].map((side) => {
			const copy = path.join(dir, side, "project");
			fs.cpSync(path.join(PROJECTS_DIR, name), copy, { recursive: true });
			return copy;
		});
		fs.renameSync(
			path.join(byRogen, "default.project.json"),
			path.join(byRogen, "default.rogen.json")
		);
		return { dir, byRojo, byRogen };
	};

	describe("a build test of Rojo's", () => {
		it.each(projects)(
			"should build %s into each format as Rojo does",
			(name) => {
				const { dir, byRojo, byRogen } = copies(name);
				const differing = FORMATS.filter((format) => {
					const expected = rojo(byRojo, [
						"build",
						"default.project.json",
						"-o",
						path.join(dir, `rojo.${format}`),
					]);
					const actual = rogen(byRogen, [
						"build",
						"-o",
						path.join(dir, `rogen.${format}`),
					]);
					return (
						expected.status !== 0 ||
						actual.status !== 0 ||
						!fs
							.readFileSync(path.join(dir, `rogen.${format}`))
							.equals(
								fs.readFileSync(
									path.join(dir, `rojo.${format}`)
								)
							)
					);
				});

				expect(differing).toEqual([]);
			},
			60_000
		);

		it.each(projects)(
			"should write the sourcemap of %s as Rojo does, with each flag",
			(name) => {
				const { byRojo, byRogen } = copies(name);
				const differing = SOURCEMAP_FLAGS.filter((flags) => {
					const expected = rojo(byRojo, [
						"sourcemap",
						...flags,
						"default.project.json",
					]);
					const actual = rogen(byRogen, ["sourcemap", ...flags]);
					return (
						expected.status !== 0 ||
						actual.status !== 0 ||
						actual.stdout.split(byRogen).join("") !==
							expected.stdout.split(byRojo).join("")
					);
				});

				expect(differing).toEqual([]);
			},
			60_000
		);
	});

	describe("a syncback test of Rojo's, as a default.rogen.json", () => {
		const cases = fs
			.readdirSync(SYNCBACK_PROJECTS_DIR, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		const PROJECT_FILES = ["default.project.json", "default.rogen.json"];

		const inputOf = (name: string) => {
			const dir = path.join(SYNCBACK_PROJECTS_DIR, name);
			return ["input.rbxl", "input.rbxm"]
				.map((file) => path.join(dir, file))
				.find((file) => fs.existsSync(file)) as string;
		};

		/** The tree of the project file a side keeps, which Rojo rewrites with what Studio changed on its nodes. */
		const treeOf = (dir: string, file: string): unknown =>
			(
				JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
					tree: unknown;
				}
			).tree;

		const copy = (name: string, side: string) => {
			const to = path.join(
				fs.mkdtempSync(path.join(parent, `syncback-${name}-`)),
				side
			);
			fs.cpSync(
				path.join(SYNCBACK_PROJECTS_DIR, name, "input-project"),
				to,
				{ recursive: true }
			);
			if (side === "rogen")
				fs.renameSync(
					path.join(to, "default.project.json"),
					path.join(to, "default.rogen.json")
				);
			return to;
		};

		it.each(cases)(
			"should write the sources of %s as Rojo does",
			(name) => {
				const byRojo = copy(name, "rojo");
				const byRogen = copy(name, "rogen");
				const expected = rojo(byRojo, [
					"syncback",
					"--input",
					inputOf(name),
					"--non-interactive",
				]);
				const actual = rogen(byRogen, [
					"syncback",
					"--input",
					inputOf(name),
					"-y",
				]);

				expect(actual.status).toBe(expected.status);
				expect(snapshot(byRogen, PROJECT_FILES)).toEqual(
					snapshot(byRojo, PROJECT_FILES)
				);
				expect(treeOf(byRogen, "default.rogen.json")).toEqual(
					treeOf(byRojo, "default.project.json")
				);
			},
			60_000
		);

		const LISTED_DIFFERENTLY = ["child_but_not", "ignore_paths_init"];

		it.each(cases.filter((name) => !LISTED_DIFFERENTLY.includes(name)))(
			"should list what %s would write on stdout as Rojo lists it",
			(name) => {
				const byRojo = copy(name, "rojo");
				const byRogen = copy(name, "rogen");
				const args = ["--input", inputOf(name), "--list", "--dry-run"];
				const expected = rojo(byRojo, ["syncback", ...args]);
				const actual = rogen(byRogen, ["syncback", ...args]);

				expect(actual.status).toBe(expected.status);
				expect(actual.stdout).toBe(
					stripVTControlCharacters(expected.stdout).replaceAll(
						"default.project.json",
						"default.rogen.json"
					)
				);
			},
			60_000
		);

		it.each(cases)(
			"should change no source of %s in a dry run",
			(name) => {
				const byRogen = copy(name, "rogen");
				const before = snapshot(byRogen, PROJECT_FILES);

				rogen(byRogen, ["syncback", "--input", inputOf(name), "-n"]);

				expect(snapshot(byRogen, PROJECT_FILES)).toEqual(before);
			},
			60_000
		);
	});

	describe("a plain Rojo project and an edit made in Studio", () => {
		const PROJECT = {
			name: "game",
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					Shared: { $path: "src/shared" },
				},
				ServerScriptService: {
					$className: "ServerScriptService",
					Server: { $path: "src/server" },
				},
				StarterPlayer: {
					$className: "StarterPlayer",
					StarterPlayerScripts: {
						$className: "StarterPlayerScripts",
						Client: { $path: "src/client" },
					},
				},
			},
		};
		const FILES: Record<string, string> = {
			"src/shared/Config.luau": "return {}",
			"src/shared/Gone.luau": "return {}",
			"src/shared/Util/init.luau": "return 1",
			"src/shared/Util/Math.luau": "return 2",
			"src/server/Main.server.luau": 'print("s")',
			"src/client/Main.client.luau": 'print("c")',
			"src/data/Data.json": '{"a":1}',
		};
		/** An edit no folder of the project can take, which neither tool writes. */
		const LEFT_ALONE = "add an instance outside the project";
		const SCENARIOS: Record<string, string> = {
			"edit a source":
				'game.ReplicatedStorage.Shared.Config.Source = "return {changed=true}"',
			"add a script":
				'local m = Instance.new("ModuleScript"); m.Name = "Added"; m.Source = "return 9"; m.Parent = game.ReplicatedStorage.Shared',
			"add a folder with a script":
				'local f = Instance.new("Folder"); f.Name = "Sub"; f.Parent = game.ReplicatedStorage.Shared; local m = Instance.new("ModuleScript"); m.Name = "Inner"; m.Source = "return 9"; m.Parent = f',
			"delete a script": "game.ReplicatedStorage.Shared.Gone:Destroy()",
			"add a child to an init script":
				'local m = Instance.new("ModuleScript"); m.Name = "Extra"; m.Source = "return 9"; m.Parent = game.ReplicatedStorage.Shared.Util',
			"add a server script":
				'local s = Instance.new("Script"); s.Name = "Second"; s.Source = "print(2)"; s.Parent = game.ServerScriptService.Server',
			"add a client script":
				'local s = Instance.new("LocalScript"); s.Name = "Second"; s.Source = "print(2)"; s.Parent = game.StarterPlayer.StarterPlayerScripts.Client',
			"set a property":
				"game.ServerScriptService.Server.Main.Disabled = true",
			"set an attribute":
				'game.ReplicatedStorage.Shared.Config:SetAttribute("k", 5)',
			"add a value":
				'local v = Instance.new("StringValue"); v.Name = "V"; v.Value = "hi"; v.Parent = game.ReplicatedStorage.Shared',
			"rename a script":
				'game.ReplicatedStorage.Shared.Config.Name = "Settings"',
			[LEFT_ALONE]:
				'local f = Instance.new("Folder"); f.Name = "Loose"; f.Parent = game.Workspace',
		};

		const write = (root: string) => {
			fs.writeFileSync(
				path.join(root, "default.project.json"),
				JSON.stringify(PROJECT)
			);
			for (const [file, text] of Object.entries(FILES)) {
				fs.mkdirSync(path.dirname(path.join(root, file)), {
					recursive: true,
				});
				fs.writeFileSync(path.join(root, file), text);
			}
		};

		it.each(Object.entries(SCENARIOS))(
			"should sync back %s as Rojo does",
			(name, edit) => {
				const dir = fs.mkdtempSync(
					path.join(parent, `syncback-${name.replace(/ /g, "-")}-`)
				);
				const base = path.join(dir, "base");
				fs.mkdirSync(base);
				write(base);
				expect(
					rojo(base, [
						"build",
						"default.project.json",
						"-o",
						path.join(dir, "base.rbxl"),
					]).status
				).toBe(0);
				fs.writeFileSync(path.join(dir, "edits.luau"), edit);
				const lune = spawnSync(
					"lune",
					[
						"run",
						path.resolve("e2e/place-edit.luau"),
						path.join(dir, "base.rbxl"),
						path.join(dir, "edited.rbxl"),
						path.join(dir, "edits.luau"),
					],
					{ cwd: path.resolve("."), encoding: "utf8" }
				);
				expect(lune.status).toBe(0);

				const [byRojo, byRogen] = ["rojo", "rogen"].map((side) => {
					const copy = path.join(dir, side, "project");
					fs.mkdirSync(copy, { recursive: true });
					write(copy);
					return copy;
				});
				const input = path.join(dir, "edited.rbxl");
				const expected = rojo(
					byRojo,
					["syncback", "--input", input],
					"y\n"
				);
				const actual = rogen(byRogen, [
					"syncback",
					"--input",
					input,
					"-y",
				]);

				const untouched = path.join(dir, "untouched", "project");
				fs.mkdirSync(untouched, { recursive: true });
				write(untouched);

				expect(actual.status).toBe(expected.status);
				expect(snapshot(byRogen)).toEqual(snapshot(byRojo));
				expect(
					JSON.stringify(snapshot(byRojo)) !==
						JSON.stringify(snapshot(untouched))
				).toBe(name !== LEFT_ALONE);
			},
			60_000
		);
	});
});
