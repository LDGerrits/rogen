import "../list-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { Result, ResultError } from "../../../base/result.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import {
	CommandRegistry,
	Extensions,
	ReportedError,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";
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
		await write("rogen.json", {
			sourcePaths: ["src", "lobby"],
			syncPath: "out",
			routes: { Server: "ServerScriptService", "*": "ReplicatedStorage" },
		});

		const result = await run();

		expect(result.isOk()).toBe(true);
		expect(steps()).toEqual(["rogen.json"]);
		expect(under("rogen.json")).toEqual([
			[
				"source paths: src, lobby",
				"routes:",
				"  Server -> ServerScriptService",
				"  * -> ReplicatedStorage",
				"sync path: out",
				"project file: default.project.json",
			].join("\n"),
		]);
	});

	it("should list the projects with their files in place of the one project file, and mark the one that is served", async () => {
		await write("rogen.json", {
			routes: { "*": "ReplicatedStorage" },
			serveProject: "dist",
			projects: { dist: { syncPath: "dist" } },
		});

		await run();

		expect(under("rogen.json")[0]).toBe(
			[
				"source paths: src",
				"routes:",
				"  * -> ReplicatedStorage",
				"sync path: (none)",
				"projects:",
				"  default: default.project.json",
				"  dist: dist.project.json (served)",
			].join("\n")
		);
	});

	it("should say a name that is both a folder and a project is the folder", async () => {
		await write("rogen.json", { projects: { lobby: {} } });
		await write("lobby/rogen.json", {});

		await run({ _: ["lobby"] });

		expect(logService.texts("warn")).toEqual([
			'"lobby" is a folder with a rogen.json and also a project of rogen.json: using the folder. To use the project, name its file, lobby.project.json.',
		]);
	});

	it("should print no extends, extended by or template line", async () => {
		await write("rogen.json", {
			routes: { "*": "Workspace" },
			tree: { $className: "DataModel" },
		});

		await run();

		expect(under("rogen.json")[0]).not.toMatch(
			/extends|extended by|template/
		);
	});

	describe("routes", () => {
		const routes = { Server: "ServerScriptService", "*": "Workspace" };

		it("should say 'same as' for a config whose routes equal those of an earlier one", async () => {
			await write("lobby/rogen.json", { routes });
			await write("arena/rogen.json", { routes });

			await run({ _: ["lobby", "arena"] });

			expect(under("lobby/rogen.json")[0]).toContain(
				"routes:\n  Server -> ServerScriptService\n  * -> Workspace"
			);
			expect(under("arena/rogen.json").at(-1)).toContain(
				"routes: same as lobby"
			);
		});

		it("should print the routes of a config that differs in one", async () => {
			await write("lobby/rogen.json", { routes });
			await write("arena/rogen.json", {
				routes: { ...routes, Server: "Workspace" },
			});

			await run({ _: ["lobby", "arena"] });

			const details = under("arena/rogen.json").at(-1)!;
			expect(details).not.toContain("same as");
			expect(details).toContain("  Server -> Workspace");
		});

		it("should not call routes the same when only their order differs", async () => {
			await write("a/rogen.json", {
				routes: { Server: "Workspace", Client: "Workspace" },
			});
			await write("b/rogen.json", {
				routes: { Client: "Workspace", Server: "Workspace" },
			});

			await run({ _: ["a", "b"] });

			expect(under("b/rogen.json")[0]).not.toContain("same as");
		});

		it("should print none for a broken config", async () => {
			await write("a/rogen.json", { routes });
			await write("b/rogen.json", `{\n\t"extends": "a"\n}`);

			await run({ _: ["a", "b"] });

			expect(under("b/rogen.json").join("\n")).not.toContain("routes");
		});
	});

	it("should say so when there is no sync path", async () => {
		await write("rogen.json", {});

		await run();

		const [details] = under("rogen.json");
		expect(details).toContain("sync path: (none)");
	});

	it("should list the config here, and not those in other folders", async () => {
		await write("rogen.json", {});
		await write("lobby/rogen.json", {});
		await write("notes.json", {});

		await run();

		expect(steps()).toEqual(["rogen.json"]);
	});

	it("should report a broken config in place, print the rest and fail", async () => {
		await write("a/rogen.json", {});
		await write("b/rogen.json", `{\n\t"extends": "a"\n}`);
		await write("c/rogen.json", {});

		const result = await run({ _: ["a", "b", "c"] });

		expect(steps()).toEqual([
			"a/rogen.json",
			"b/rogen.json",
			"c/rogen.json",
		]);
		expect(under("b/rogen.json")).toEqual([
			expect.stringContaining("/repo/b/rogen.json:2:2 - error:"),
		]);
		expect(result.isErr()).toBe(true);
	});

	it("should count every broken config when none loads", async () => {
		await write("a/rogen.json", `{\n\t"extends": "a"\n}`);
		await write("b/rogen.json", `{\n\t"extends": "a"\n}`);

		const result = await run({ _: ["a", "b"] });

		expect((result as ResultError<Error>).error.message).toBe(
			"2 configs have errors."
		);
	});

	it("should say how many of the configs are broken when some load", async () => {
		await write("a/rogen.json", {});
		await write("b/rogen.json", `{\n\t"extends": "a"\n}`);

		const result = await run({ _: ["a", "b"] });

		expect((result as ResultError<Error>).error.message).toBe(
			"1 of 2 configs has errors."
		);
	});

	it("should fail when there is no config here", async () => {
		const result = await run();

		expect((result as ResultError<Error>).error.message).toContain(
			"No rogen.json found"
		);
	});

	it("should list only the named projects", async () => {
		await write("rogen.json", {});
		await write("lobby/rogen.json", {});
		await write("match/rogen.json", {});

		await run({ _: ["lobby", "match"] });

		expect(steps()).toEqual(["lobby/rogen.json", "match/rogen.json"]);
	});

	it("should list the project of a default.project.json path", async () => {
		await write("rogen.json", {});
		await write("places/lobby/rogen.json", {});

		await run({ _: ["places/lobby/default.project.json"] });

		expect(steps()).toEqual(["places/lobby/rogen.json"]);
	});

	describe("with --json", () => {
		const document = () =>
			logService.json<{ configs: Record<string, unknown>[] }>();

		const entry = (config: string) =>
			document().configs.find((candidate) => candidate.config === config);

		it("should print each config's resolved fields, identity first", async () => {
			await write("rogen.json", {
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
						file: "/repo/rogen.json",
						status: "valid",
						served: true,
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
						projects: [
							{
								name: "default",
								file: "/repo/default.project.json",
								served: true,
								serving: null,
							},
						],
						diagnostics: [],
					},
				],
			});
		});

		it("should list each project with its file and say which one serve serves", async () => {
			await write("rogen.json", {
				routes: { "*": "ReplicatedStorage" },
				serveProject: "dist",
				projects: { dist: { syncPath: "dist" }, release: {} },
			});

			await run({ json: true });

			expect(entry("repo")).toMatchObject({
				projectFile: "/repo/default.project.json",
				projects: [
					{
						name: "default",
						file: "/repo/default.project.json",
						served: false,
					},
					{
						name: "dist",
						file: "/repo/dist.project.json",
						served: true,
					},
					{
						name: "release",
						file: "/repo/release.project.json",
						served: false,
					},
				],
			});
		});

		it("should say every config that loads is served", async () => {
			await write("lobby/rogen.json", {});
			await write("arena/rogen.json", {});

			await run({ _: ["lobby", "arena"], json: true });

			expect(entry("lobby")).toMatchObject({ served: true });
			expect(entry("arena")).toMatchObject({ served: true });
		});

		it("should print the named projects in the order they are named", async () => {
			await write("lobby/rogen.json", {});
			await write("arena/rogen.json", {});

			await run({ _: ["lobby", "arena"], json: true });

			expect(document().configs.map(({ config }) => config)).toEqual([
				"lobby",
				"arena",
			]);
		});

		it("should print a broken config's diagnostics in place of its fields and fail without reporting again", async () => {
			await write("a/rogen.json", {});
			await write("b/rogen.json", `{\n\t"extends": "a"\n}`);

			const result = await run({ _: ["a", "b"], json: true });

			expect(entry("a")).toMatchObject({ status: "valid" });
			expect(entry("a")).toHaveProperty("sourcePaths");
			expect(entry("b")).toEqual({
				config: "b",
				file: "/repo/b/rogen.json",
				status: "broken",
				served: false,
				diagnostics: [
					expect.objectContaining({
						file: "/repo/b/rogen.json",
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
			await write("rogen.json", {});

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

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(argv, (command) => registry.getOptions(command), [
				...registry.getCommands().keys(),
			]);

		it("should accept projects and --json, but not the output overrides", () => {
			expect(
				parse("list", "lobby", "places/arena", "--json").isOk()
			).toBe(true);
			expect(parse("list", "--variant", "mock").isErr()).toBe(true);
			expect(parse("list", "-o", "out.project.json").isErr()).toBe(true);
			expect(
				parse("list", "--out-file", "out.project.json").isErr()
			).toBe(true);
			expect(parse("list", "--all").isErr()).toBe(true);
		});
	});

	it("should print the report although it is quiet", async () => {
		await write("rogen.json", { routes: { "*": "Workspace" } });
		logService.setLevel(LogLevel.Error);

		await run();

		expect(logService.texts("section")).toEqual(["rogen.json"]);
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
			await write("rogen.json", {
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

				const [details] = under("rogen.json");
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

			expect(under("rogen.json")[0]).not.toContain("serving:");
		});

		it("should print the serving server of each config, or null, with --json", async () => {
			await write("lobby/rogen.json", { routes: { "*": "Workspace" } });
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
	describe("places", () => {
		beforeEach(async () => {
			await write("rogen.json", {
				name: "Game",
				placePaths: ["places/*"],
				routes: {
					Server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
			});
			await write("places/lobby/rogen.json", { name: "Lobby" });
			await fs.createDirectory("/repo/places/arena");
		});

		it("should list the config, then each place with its folder and port", async () => {
			const result = await run();

			expect(result.isOk()).toBe(true);
			expect(steps()).toEqual([
				"rogen.json",
				"places/arena (place)",
				"places/lobby (place)",
			]);
			expect(under("rogen.json")).toEqual([
				[
					"source paths: src",
					"routes:\n  Server -> ServerScriptService\n  * -> ReplicatedStorage",
					"sync path: (none)",
					"places: arena, Lobby",
					"project file: default.project.json",
				].join("\n"),
			]);
			expect(under("places/arena (place)")).toEqual([
				[
					"source paths: src, places/arena/src",
					"routes: same as Game",
					"sync path: (none)",
					"project file: places/arena/default.project.json (port 34872)",
				].join("\n"),
			]);
			expect(under("places/lobby (place)")[0]).toContain("(port 34873)");
		});

		it("should say the config is not served when it has projects", async () => {
			await write("rogen.json", {
				placePaths: ["places/*"],
				routes: { "*": "ReplicatedStorage" },
				projects: { dist: {} },
			});

			await run();

			expect(under("rogen.json")[0]).toContain(
				"projects:\n  default: default.project.json\n  dist: dist.project.json"
			);
			expect(under("places/arena (place)")[0]).toContain(
				"default: places/arena/default.project.json (served, port 34872)"
			);
		});

		it("should close with the configs and the places", async () => {
			await run();

			expect(logService.texts("outro")).toEqual([
				"1 config and 2 places.",
			]);
		});

		it("should list each place with its port with --json", async () => {
			await run({ json: true });

			const { configs } = JSON.parse(logService.texts("print")[0]) as {
				configs: {
					served: boolean;
					projects: { served: boolean }[];
					places: {
						place: string;
						folder: string;
						projects: {
							name: string;
							served: boolean;
							port: number;
						}[];
					}[];
				}[];
			};
			expect(configs[0].served).toBe(false);
			expect(configs[0].projects.map(({ served }) => served)).toEqual([
				false,
			]);
			expect(
				configs[0].places.map(({ place, folder, projects }) => [
					place,
					folder,
					projects[0].served,
					projects[0].port,
				])
			).toEqual([
				["arena", "/repo/places/arena", true, 34872],
				["Lobby", "/repo/places/lobby", true, 34873],
			]);
		});
	});
});
