import "../list-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { Result, ResultError } from "../../../base/result.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { ReportedError } from "../../../platform/commands/commands.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { recordFile } from "../../../domain/serve/__tests__/record-fixtures.js";

describe("list command", () => {
	let fs: MemoryFileSystemService;
	let logService: MockLogService;
	let run: (
		options?: CommandLine["options"] & { _?: string[] }
	) => Promise<Result<void, Error>>;

	const write = (file: string, config: Record<string, unknown> | string) =>
		fs.writeFile(
			`/repo/${file}`,
			typeof config === "string" ? config : JSON.stringify(config)
		);

	const steps = () => logService.texts("section");

	const under = (step: string) => {
		const entries = logService.entries;
		const start = entries.findIndex(
			({ kind, text }) => kind === "section" && text === step
		);
		const next = entries.findIndex(
			({ kind }, index) =>
				index > start && (kind === "section" || kind === "outro")
		);
		const end = next === -1 ? entries.length : next;
		return entries.slice(start + 1, end).map(({ text }) => text);
	};

	beforeEach(async () => {
		const harness = commandHarness();
		({ fs } = harness);
		logService = harness.log;
		run = ({ _ = [], ...options } = {}) =>
			harness.run("list", { positionals: _, options });
	});

	it("should show a config's source paths, routes, sync path and project file", async () => {
		await fs.createDirectory("/repo/src");
		await fs.createDirectory("/repo/lobby");
		await write("default.rogen.json", {
			sourcePaths: ["src", "lobby"],
			syncPath: "out",
			routes: { Server: "ServerScriptService", "*": "ReplicatedStorage" },
		});

		const result = await run();

		expect(result.isOk()).toBe(true);
		expect(steps()).toEqual(["default.rogen.json"]);
		expect(under("default.rogen.json")).toEqual([
			[
				"source paths: src, lobby",
				"routes:",
				"  Server -> ServerScriptService",
				"  * -> ReplicatedStorage",
				"sync path: out",
				"project file: default.project.json",
				"rojo: rojo serve default.project.json",
			].join("\n"),
		]);
	});

	describe("with several configs in a folder", () => {
		beforeEach(async () => {
			await fs.createDirectory("/repo/src");
			await write("default.rogen.json", {
				name: "Game",
				sourcePaths: ["src"],
				routes: { "*": "ReplicatedStorage" },
			});
			await write("dist.rogen.json", {
				name: "Game",
				sourcePaths: ["src"],
				routes: { "*": "ReplicatedStorage" },
				syncPath: "dist",
				servePort: 34900,
			});
		});

		it("should list every config file of the folder and what each differs from the default in", async () => {
			const result = await run();

			expect(result.isOk()).toBe(true);
			expect(steps()).toEqual(["default.rogen.json", "dist.rogen.json"]);
			expect(under("default.rogen.json")[0]).not.toContain(
				"differs from"
			);
			expect(under("dist.rogen.json")[0]).toContain(
				"project file: dist.project.json (port 34900)"
			);
			expect(under("dist.rogen.json")[0]).toContain(
				"differs from default.rogen.json: servePort, syncPath"
			);
		});

		it("should list only the file named", async () => {
			await run({ _: ["dist.rogen.json"] });

			expect(steps()).toEqual(["dist.rogen.json"]);
			expect(under("dist.rogen.json")[0]).not.toContain("differs from");
		});

		it("should list the files without a default beside them", async () => {
			await fs.delete("/repo/default.rogen.json");

			const result = await run();

			expect(result.isOk()).toBe(true);
			expect(steps()).toEqual(["dist.rogen.json"]);
			expect(under("dist.rogen.json")[0]).not.toContain("differs from");
		});

		it("should say what each file differs in with --json", async () => {
			await run({ json: true });

			const document = JSON.parse(logService.texts("print")[0]);
			expect(
				document.configs.map(
					(config: { differsFromDefault?: string[] }) =>
						config.differsFromDefault
				)
			).toEqual([undefined, ["servePort", "syncPath"]]);
		});

		it("should fail when a stem has both extensions", async () => {
			await write("dist.rogen.jsonc", {});

			const result = await run();

			expect((result as ResultError<Error>).error.message).toContain(
				"holds both dist.rogen.json and dist.rogen.jsonc; keep one."
			);
		});
	});

	it("should say which source paths are no folder, as an error when none is", async () => {
		await write("default.rogen.json", {
			sourcePaths: ["srcc"],
			routes: { "*": "ReplicatedStorage" },
		});

		await run();

		expect(under("default.rogen.json").at(-1)).toContain(
			"scan.missingSourcePath"
		);
		expect(under("default.rogen.json").at(-1)).toContain("error");
	});

	it("should say it as a warning when another source path is a folder", async () => {
		await fs.createDirectory("/repo/src");
		await write("default.rogen.json", {
			sourcePaths: ["src", "later"],
			routes: { "*": "ReplicatedStorage" },
		});

		await run();

		expect(under("default.rogen.json").at(-1)).toContain("warning");
		expect(under("default.rogen.json").at(-1)).toContain(
			"scan.missingSourcePath"
		);
	});

	it("should say when a project file on disk differs from what a build would write", async () => {
		await fs.createDirectory("/repo/src");
		await write("default.rogen.json", {
			routes: { "*": "ReplicatedStorage" },
		});
		await write("default.project.json", "{}");

		await run();

		expect(under("default.rogen.json").at(-1)).toContain("output.differs");
		expect(under("default.rogen.json").at(-1)).toContain("warning");
	});

	it("should show the port a config pins, though it is no place", async () => {
		await write("default.rogen.json", { servePort: 34900 });

		await run();

		expect(under("default.rogen.json")[0]).toContain(
			"project file: default.project.json (port 34900)"
		);
	});

	it("should quote a project file with a space in the Rojo command, and carry the pinned port", async () => {
		await write("my game/default.rogen.json", { servePort: 34900 });

		await run({ _: ["my game"] });

		expect(under("my game/default.rogen.json")[0]).toContain(
			"rojo: rojo serve 'my game/default.project.json' --port 34900"
		);
	});

	it("should print no extends, extended by or template line", async () => {
		await write("default.rogen.json", {
			routes: { "*": "Workspace" },
			tree: { $className: "DataModel" },
		});

		await run();

		expect(under("default.rogen.json")[0]).not.toMatch(
			/extends|extended by|template/
		);
	});

	describe("routes", () => {
		const routes = { Server: "ServerScriptService", "*": "Workspace" };

		it("should say 'same as' for a config whose routes equal those of an earlier one", async () => {
			await fs.createDirectory("/repo/lobby/src");
			await fs.createDirectory("/repo/arena/src");
			await write("lobby/default.rogen.json", { routes });
			await write("arena/default.rogen.json", { routes });

			await run({ _: ["lobby", "arena"] });

			expect(under("lobby/default.rogen.json")[0]).toContain(
				"routes:\n  Server -> ServerScriptService\n  * -> Workspace"
			);
			expect(under("arena/default.rogen.json").at(-1)).toContain(
				"routes: same as lobby"
			);
		});

		it("should print the routes of a config that differs in one", async () => {
			await fs.createDirectory("/repo/lobby/src");
			await fs.createDirectory("/repo/arena/src");
			await write("lobby/default.rogen.json", { routes });
			await write("arena/default.rogen.json", {
				routes: { ...routes, Server: "Workspace" },
			});

			await run({ _: ["lobby", "arena"] });

			const details = under("arena/default.rogen.json").at(-1)!;
			expect(details).not.toContain("same as");
			expect(details).toContain("  Server -> Workspace");
		});

		it("should not call routes the same when only their order differs", async () => {
			await write("a/default.rogen.json", {
				routes: { Server: "Workspace", Client: "Workspace" },
			});
			await write("b/default.rogen.json", {
				routes: { Client: "Workspace", Server: "Workspace" },
			});

			await run({ _: ["a", "b"] });

			expect(under("b/default.rogen.json")[0]).not.toContain("same as");
		});

		it("should print none for a broken config", async () => {
			await write("a/default.rogen.json", { routes });
			await write("b/default.rogen.json", `{\n\t"extends": "a"\n}`);

			await run({ _: ["a", "b"] });

			expect(under("b/default.rogen.json").join("\n")).not.toContain(
				"routes"
			);
		});
	});

	it("should say so when there is no sync path", async () => {
		await write("default.rogen.json", {});

		await run();

		const [details] = under("default.rogen.json");
		expect(details).toContain("sync path: (none)");
	});

	it("should list the config here, and not those in other folders", async () => {
		await write("default.rogen.json", {});
		await write("lobby/default.rogen.json", {});
		await write("notes.json", {});

		await run();

		expect(steps()).toEqual(["default.rogen.json"]);
	});

	it("should report a broken config in place, print the rest and fail", async () => {
		await write("a/default.rogen.json", {});
		await write("b/default.rogen.json", `{\n\t"extends": "a"\n}`);
		await write("c/default.rogen.json", {});

		const result = await run({ _: ["a", "b", "c"] });

		expect(steps()).toEqual([
			"a/default.rogen.json",
			"b/default.rogen.json",
			"c/default.rogen.json",
		]);
		expect(under("b/default.rogen.json")).toEqual([
			expect.stringContaining("/repo/b/default.rogen.json:2:2 - error:"),
		]);
		expect(result.isErr()).toBe(true);
	});

	it("should count every broken config when none loads", async () => {
		await write("a/default.rogen.json", `{\n\t"extends": "a"\n}`);
		await write("b/default.rogen.json", `{\n\t"extends": "a"\n}`);

		const result = await run({ _: ["a", "b"] });

		expect((result as ResultError<Error>).error.message).toBe(
			"2 configs have errors."
		);
	});

	it("should say how many of the configs are broken when some load", async () => {
		await write("a/default.rogen.json", {});
		await write("b/default.rogen.json", `{\n\t"extends": "a"\n}`);

		const result = await run({ _: ["a", "b"] });

		expect((result as ResultError<Error>).error.message).toBe(
			"1 of 2 configs has errors."
		);
	});

	it("should fail when there is no config here", async () => {
		const result = await run();

		expect((result as ResultError<Error>).error.message).toContain(
			"No default.rogen.json or default.project.json in this folder"
		);
	});

	it("should list only the named projects", async () => {
		await write("default.rogen.json", {});
		await write("lobby/default.rogen.json", {});
		await write("match/default.rogen.json", {});

		await run({ _: ["lobby", "match"] });

		expect(steps()).toEqual([
			"lobby/default.rogen.json",
			"match/default.rogen.json",
		]);
	});

	it("should list the project of a default.project.json path", async () => {
		await write("default.rogen.json", {});
		await write("places/lobby/default.rogen.json", {});

		await run({ _: ["places/lobby/default.project.json"] });

		expect(steps()).toEqual(["places/lobby/default.rogen.json"]);
	});

	describe("with --json", () => {
		const document = () =>
			logService.json<{ configs: Record<string, unknown>[] }>();

		const entry = (config: string) =>
			document().configs.find((candidate) => candidate.config === config);

		it("should print each config's resolved fields, identity first", async () => {
			await fs.createDirectory("/repo/src");
			await fs.createDirectory("/repo/lobby");
			await write("default.rogen.json", {
				name: "Game",
				sourcePaths: ["src", "lobby"],
				routes: {
					Server: "ServerScriptService",
					"*": "ReplicatedStorage/Shared",
				},
				globIgnorePaths: ["**/*.spec.luau"],
				syncPath: "out",
			});

			const result = await run({ json: true });

			expect(result.isOk()).toBe(true);
			expect(document()).toEqual({
				configs: [
					{
						config: "Game",
						file: "/repo/default.rogen.json",
						status: "valid",
						projectName: "Game",
						sourcePaths: ["/repo/src", "/repo/lobby"],
						commonRoot: "/repo",
						routes: {
							Server: "ServerScriptService",
							"*": "ReplicatedStorage/Shared",
						},
						globIgnorePaths: ["/repo/**/*.spec.luau"],
						syncPath: "/repo/out",
						projectFile: "/repo/default.project.json",
						serving: null,
						rojo: ["rojo", "serve", "/repo/default.project.json"],
						diagnostics: [],
					},
				],
			});
		});

		it("should carry the missing source paths as diagnostics of a valid config", async () => {
			await write("default.rogen.json", {
				sourcePaths: ["srcc"],
				routes: { "*": "ReplicatedStorage" },
			});

			await run({ json: true });

			expect(entry("repo")).toMatchObject({
				status: "valid",
				diagnostics: [
					{
						severity: "error",
						code: "scan.missingSourcePath",
					},
				],
			});
		});

		it("should print the named projects in the order they are named", async () => {
			await write("lobby/default.rogen.json", {});
			await write("arena/default.rogen.json", {});

			await run({ _: ["lobby", "arena"], json: true });

			expect(document().configs.map(({ config }) => config)).toEqual([
				"lobby",
				"arena",
			]);
		});

		it("should print a broken config's diagnostics in place of its fields and fail without reporting again", async () => {
			await write("a/default.rogen.json", {});
			await write("b/default.rogen.json", `{\n\t"extends": "a"\n}`);

			const result = await run({ _: ["a", "b"], json: true });

			expect(entry("a")).toMatchObject({ status: "valid" });
			expect(entry("a")).toHaveProperty("sourcePaths");
			expect(entry("b")).toEqual({
				config: "b",
				file: "/repo/b/default.rogen.json",
				status: "broken",
				diagnostics: [
					expect.objectContaining({
						file: "/repo/b/default.rogen.json",
						line: 2,
						column: 2,
						severity: "error",
						code: "config.removedField",
					}),
				],
			});
			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
		});

		it("should print nothing but the document", async () => {
			await write("default.rogen.json", {});

			await run({ json: true });

			expect(
				logService.entries.filter(({ kind }) => kind !== "print")
			).toEqual([]);
		});

		it("should fail without printing when no config is found, for the caller to report", async () => {
			const result = await run({ json: true });

			expect(result.isErr()).toBe(true);
			expect(logService.entries).toEqual([]);
		});
	});

	it("should print the report although it is quiet", async () => {
		await write("default.rogen.json", { routes: { "*": "Workspace" } });
		logService.setLevel(LogLevel.Error);

		await run();

		expect(logService.texts("section")).toEqual(["default.rogen.json"]);
		expect(logService.texts("intro")).toEqual([]);
	});

	describe("beside a running serve", () => {
		const ROJO_URL = "http://127.0.0.1:34872/api/rojo";
		let requests: MockRequestService;

		beforeEach(async () => {
			requests = new MockRequestService();
			const harness = commandHarness({ requests });
			({ fs } = harness);
			logService = harness.log;
			run = ({ _ = [], ...options } = {}) =>
				harness.run("list", { positionals: _, options });
			await write("default.rogen.json", {
				routes: { "*": "ReplicatedStorage" },
			});
		});

		const serve = async (clients?: number) => {
			await fs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					clients,
				})
			);
			requests.answer(ROJO_URL, {
				projectName: "repo",
				serverVersion: "7.7.1",
				sessionId: "s1",
			});
		};

		it.each([
			[0, "serving: Rojo at 127.0.0.1:34872, no Studio connected"],
			[1, "serving: Rojo at 127.0.0.1:34872, 1 Studio connected"],
			[2, "serving: Rojo at 127.0.0.1:34872, 2 Studio connected"],
			[undefined, "serving: Rojo at 127.0.0.1:34872"],
		])(
			"should say what serves a config, and who is connected (%s)",
			async (clients, line) => {
				await serve(clients);

				await run();

				const [details] = under("default.rogen.json");
				expect(details).toContain(`\n${line}`);
			}
		);

		it("should say nothing of a serve when the server no longer answers", async () => {
			await fs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					clients: 1,
				})
			);

			await run();

			expect(under("default.rogen.json")[0]).not.toContain("serving:");
		});

		it("should print the serving server of each config, or null, with --json", async () => {
			await write("lobby/default.rogen.json", {
				routes: { "*": "Workspace" },
			});
			await serve(1);

			await run({ _: [".", "lobby"], json: true });

			const { configs } = JSON.parse(logService.texts("print")[0]) as {
				configs: { config: string; serving: unknown }[];
			};
			expect(
				configs.map(({ config, serving }) => [config, serving])
			).toEqual([
				[
					"repo",
					{
						server: "rojo",
						host: "127.0.0.1",
						port: 34872,
						clients: 1,
					},
				],
				["lobby", null],
			]);
		});
	});
	describe("a place", () => {
		beforeEach(async () => {
			await fs.createDirectory("/repo/places/shared/src");
			await fs.createDirectory("/repo/places/lobby/src");
			await write("places/lobby/default.rogen.json", {
				name: "Lobby",
				sourcePaths: ["../shared/src", "src"],
				routes: {
					Server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
				servePort: 34873,
				servePlaceIds: [1818, 2020],
			});
		});

		it("should list its source paths in full, and the port and place IDs it pins", async () => {
			const result = await run({ _: ["places/lobby"] });

			expect(result.isOk()).toBe(true);
			expect(steps()).toEqual(["places/lobby/default.rogen.json"]);
			expect(under("places/lobby/default.rogen.json")).toEqual([
				[
					"source paths: places/shared/src, places/lobby/src",
					"routes:\n  Server -> ServerScriptService\n  * -> ReplicatedStorage",
					"sync path: (none)",
					"project file: places/lobby/default.project.json (port 34873, place IDs 1818, 2020)",
					"rojo: rojo serve places/lobby/default.project.json --port 34873",
				].join("\n"),
			]);
		});

		it("should give no port to a place that pins none", async () => {
			await write("places/arena/default.rogen.json", {
				name: "Arena",
				routes: { "*": "ReplicatedStorage" },
			});

			await run({ _: ["places/arena"] });

			expect(under("places/arena/default.rogen.json")[0]).toContain(
				"project file: places/arena/default.project.json\n"
			);
		});

		it("should list nothing for the folder of the shared code, which has no config", async () => {
			const result = await run({ _: ["places/shared"] });

			expect(result.isErr()).toBe(true);
			expect((result as { error: Error }).error.message).toContain(
				'No default.rogen.json or default.project.json in "places/shared"'
			);
		});

		it("should close with the configs", async () => {
			await run({ _: ["places/lobby"] });

			expect(logService.texts("outro")).toEqual(["1 config."]);
		});

		it("should give the Rojo command that serves it with --json", async () => {
			await run({ _: ["places/lobby"], json: true });

			const [config] = JSON.parse(logService.texts("print")[0])
				.configs as {
				port: number;
				placeIds: number[];
				rojo: string[];
			}[];
			expect(config).toMatchObject({
				port: 34873,
				placeIds: [1818, 2020],
				rojo: [
					"rojo",
					"serve",
					"/repo/places/lobby/default.project.json",
					"--port",
					"34873",
				],
			});
		});
	});
});
