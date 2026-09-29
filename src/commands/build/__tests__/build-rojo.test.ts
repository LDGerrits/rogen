import fs from "fs";
import path from "path";
import "../build-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { configRefsFromArgs } from "../../config-options.js";
import { BuildService } from "../../../domain/build/build-service.js";
import { CoreBuildService } from "../../../domain/build/core-build-service.js";
import { CoreOutputService } from "../../../domain/output/core-output-service.js";
import { OutputService } from "../../../domain/output/output-service.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import "../../../domain/config/config.js";
import {
	classes,
	describeWithRojo,
	makeRojoDir,
	sourcemap,
} from "../../../domain/rojo/__tests__/rojo-cli.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { NativeEnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { DiskFileSystemService } from "../../../platform/fs/disk-file-system-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

describeWithRojo("build command against Rojo", () => {
	let store: DisposableStore;
	let dir: string;

	const write = (file: string, content: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	};

	const build = async (names: string[]) => {
		const args = { _: ["build", ...names] };
		const environment = new NativeEnvironmentService(args, dir);
		const fileSystem = new DiskFileSystemService();
		const logService = new NullLogService();
		const configService = store.add(
			new CoreConfigService(fileSystem, environment)
		);
		const refs = configRefsFromArgs(args).unwrap();
		(await configService.initialize(refs)).unwrap();

		const services = new ServiceCollection();
		services.set(ConfigService, configService);
		services.set(EnvironmentService, environment);
		services.set(FileSystemService, fileSystem);
		const indexService = store.add(new CoreIndexService(fileSystem));
		services.set(IndexService, indexService);
		services.set(
			BuildService,
			new CoreBuildService(fileSystem, indexService)
		);
		services.set(OutputService, new CoreOutputService(fileSystem));
		services.set(LogService, logService);
		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("build", args);
	};

	beforeEach(() => {
		store = new DisposableStore();
		dir = makeRojoDir("rogen-rojo-");
	});

	afterEach(() => {
		store[Symbol.dispose]();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should write a project file that Rojo places as routed", async () => {
		write("src/Main.server.luau", "print('main')");
		write("src/shared/Util.luau", "return 1");
		write("src/client/Hud.client.luau", "print('hud')");
		write(
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
					"*": "ReplicatedStorage",
				},
			})
		);

		const result = await build([]);

		expect(result.isOk()).toBe(true);
		expect(classes(sourcemap(dir, "default.project.json"))).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/\/ServerScriptService\/Main: Script$/),
				expect.stringMatching(/\/ReplicatedStorage\/shared: Folder$/),
				expect.stringMatching(/\/shared\/Util: ModuleScript$/),
				expect.stringMatching(
					/\/StarterPlayerScripts\/Hud: LocalScript$/
				),
			])
		);
	});

	it("should write two project files that Rojo accepts from one build", async () => {
		write("src/Main.server.luau", "print('main')");
		const routes = { server: "ServerScriptService", "*": "Workspace" };
		write(
			"default.rogen.json",
			JSON.stringify({ rootDirs: ["src"], routes })
		);
		write(
			"source.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes,
				outFile: "source.project.json",
			})
		);

		const result = await build(["default", "source"]);

		expect(result.isOk()).toBe(true);
		expect(classes(sourcemap(dir, "default.project.json"))).toEqual(
			classes(sourcemap(dir, "source.project.json"))
		);
	});

	it("should write copied folder meta that Rojo accepts", async () => {
		write("src/Combat/server/Hit.server.luau", "print('hit')");
		write("src/Combat/server/Moves/Punch.luau", "return 1");
		write("src/Combat/Other.luau", "return 1");
		write(
			"src/Combat/init.meta.json",
			JSON.stringify({
				className: "Actor",
				properties: { Archivable: false },
				attributes: { Priority: 1 },
				id: "combat",
			})
		);
		write(
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: { server: "ServerScriptService", "*": "Workspace" },
				exclude: ["src/Combat/Other.luau"],
			})
		);

		const result = await build([]);

		expect(result.isOk()).toBe(true);
		const project = JSON.parse(
			fs.readFileSync(path.join(dir, "default.project.json"), "utf8")
		);
		expect(project.tree.ServerScriptService.Combat).toMatchObject({
			$className: "Actor",
			$properties: { Archivable: false },
			$attributes: { Priority: 1 },
			$id: "combat",
		});
		expect(classes(sourcemap(dir, "default.project.json"))).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/\/ServerScriptService\/Combat: Actor$/),
				expect.stringMatching(/\/Combat\/Hit: Script$/),
			])
		);
	});
});
