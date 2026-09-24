import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import "../build-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { configRefsFromArgs } from "../../../domain/config/config-refs.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import "../../../domain/config/config.js";
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

interface SourcemapNode {
	readonly name: string;
	readonly className: string;
	readonly children?: readonly SourcemapNode[];
}

const MANIFEST = path.resolve("rokit.toml");

function runRojo(cwd: string, args: string[]) {
	return spawnSync("rojo", args, {
		cwd,
		encoding: "utf8",
		timeout: 20_000,
	});
}

function rojoAvailable(): boolean {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-rojo-probe-"));
	try {
		fs.copyFileSync(MANIFEST, path.join(dir, "rokit.toml"));
		return runRojo(dir, ["sourcemap", "--help"]).status === 0;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function classes(node: SourcemapNode, prefix = ""): string[] {
	const here = prefix ? `${prefix}/${node.name}` : node.name;
	return [
		`${here}: ${node.className}`,
		...(node.children ?? []).flatMap((child) => classes(child, here)),
	];
}

const describeWithRojo = rojoAvailable() ? describe : describe.skip;

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
			new CoreConfigService(fileSystem, environment, logService)
		);
		const refs = configRefsFromArgs(args).unwrap();
		(await configService.initialize(refs)).unwrap();

		const services = new ServiceCollection();
		services.set(ConfigService, configService);
		services.set(EnvironmentService, environment);
		services.set(FileSystemService, fileSystem);
		services.set(IndexService, store.add(new CoreIndexService(fileSystem)));
		services.set(LogService, logService);
		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("build", args);
	};

	const sourcemap = (projectFile: string): SourcemapNode => {
		const result = runRojo(dir, ["sourcemap", projectFile]);
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		return JSON.parse(result.stdout);
	};

	beforeEach(() => {
		store = new DisposableStore();
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-rojo-"));
		fs.copyFileSync(MANIFEST, path.join(dir, "rokit.toml"));
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
		expect(classes(sourcemap("default.project.json"))).toEqual(
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
		expect(classes(sourcemap("default.project.json"))).toEqual(
			classes(sourcemap("source.project.json"))
		);
	});
});
