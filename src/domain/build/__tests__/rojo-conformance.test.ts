import fs from "fs";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { DiskFileSystemService } from "../../../platform/fs/disk-file-system-service.js";
import {
	ResolvedConfigSpec,
	mockConfig,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import {
	SourcemapNode,
	describeWithRojo,
	makeRojoDir,
	sourcemap,
	sourcemapError,
} from "../../rojo/__tests__/rojo-cli.js";
import { buildServiceOf } from "./fixtures.js";

const FILES: Record<string, string> = {
	"A.luau": "",
	"B.lua": "",
	"C.server.luau": "",
	"D.client.luau": "",
	"E.server.lua": "",
	"F.plugin.luau": "",
	"G.plugin.server.luau": "",
	"H.mock.luau": "",
	"I.server.mock.luau": "",
	"J.mock.server.luau": "",
	"K.Server.luau": "",
	"L.SERVER.luau": "",
	"M.LUAU": "",
	"N.local.luau": "",
	"O.json": "{}",
	"P.toml": "",
	"Q.yaml": "a: 1",
	"R.yml": "a: 1",
	"S.csv": "Key,Source",
	"T.txt": "text",
	"U.luau.txt": "text",
	"V.model.json": '{"className":"Folder"}',
	"W.project.json": '{"name":"W","tree":{"$className":"Folder"}}',
	"X.md": "# notes",
	"Y.msgpack": "",
	".hidden.luau": "",
	".hidden2.server.luau": "",
	".eslintrc.json": "{}",
	".gitkeep": "",
	"@server": "",
	"Dir/@client": "",
	"Foo.luau": "",
	"Foo.meta.json": '{"attributes":{"a":1}}',
	"Dir/A.luau": "",
	"Init1/init.luau": "",
	"Init1/B.luau": "",
	"Init2/init.server.luau": "",
	"Init3/init.client.luau": "",
	"Init4/init.lua": "",
};

const placed = (node: SourcemapNode): string[] =>
	(node.children ?? [])
		.flatMap((child) => [
			`${child.name}: ${child.className}`,
			...placed(child).map((line) => `${child.name}/${line}`),
		])
		.sort();

const metaApplied = (node: SourcemapNode, prefix = ""): string[] =>
	(node.children ?? [])
		.flatMap((child) => {
			const here = prefix ? `${prefix}/${child.name}` : child.name;
			return [
				...(child.filePaths ?? [])
					.filter((file) => file.endsWith(".meta.json"))
					.map((file) => `${here} <- ${file}`),
				...metaApplied(child, here),
			];
		})
		.sort();

describeWithRojo("build against Rojo reading the same directory", () => {
	let store: DisposableStore;
	let dir: string;

	beforeEach(() => {
		store = new DisposableStore();
		dir = makeRojoDir("rogen-conformance-");
	});

	afterEach(() => {
		store[Symbol.dispose]();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const writeFiles = (files: Record<string, string>) => {
		for (const [file, content] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(dir, "src", file)), {
				recursive: true,
			});
			fs.writeFileSync(path.join(dir, "src", file), content);
		}
	};

	const rogenTree = async (
		overrides: Pick<ResolvedConfigSpec, "routes" | "variants"> = {}
	) => {
		const fileSystem = new DiskFileSystemService();
		const index = new CoreIndexService(fileSystem);
		const config = mockConfig({
			file: path.join(dir, "ours.rogen.json"),
			name: "t",
			rootDirs: [path.join(dir, "src")],
			routes: { "*": "ReplicatedStorage" },
			variants: {},
			exclude: [],
			outFile: path.join(dir, "ours.project.json"),
			...overrides,
		});
		const build = (
			await buildServiceOf(fileSystem, index).build(selectionOf(config))
		).unwrap().builds[0];
		expect(build.outcome).toBe("wrote");
	};

	it("should place every Rojo-native file as Rojo would", async () => {
		writeFiles(FILES);
		fs.writeFileSync(
			path.join(dir, "rojo.project.json"),
			JSON.stringify({ name: "t", tree: { $path: "src" } })
		);
		await rogenTree();

		const rojo = placed(sourcemap(dir, "rojo.project.json"));
		const storage = sourcemap(dir, "ours.project.json").children?.find(
			(child) => child.name === "ReplicatedStorage"
		);

		expect(placed(storage!)).toEqual(rojo);
	});

	it("should name a data file or model with .server or .client as Rojo does, since only a script has a class", async () => {
		writeFiles({
			"Data.server.json": "{}",
			"Notes.client.txt": "text",
			"Gun.server.model.json": '{"className":"Folder"}',
			"Boot.server.luau": "",
		});
		fs.writeFileSync(
			path.join(dir, "rojo.project.json"),
			JSON.stringify({ name: "t", tree: { $path: "src" } })
		);
		await rogenTree({
			routes: {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			},
		});

		const rojo = placed(sourcemap(dir, "rojo.project.json")).filter(
			(line) => !line.startsWith("Boot")
		);
		const storage = sourcemap(dir, "ours.project.json").children?.find(
			(child) => child.name === "ReplicatedStorage"
		);

		expect(placed(storage!)).toEqual(rojo);
	});

	it("should give a hoisted file the class and meta Rojo gives it in its own folder", async () => {
		writeFiles({
			"Inv/^Animate.client.luau": "",
			"Inv/^Animate.meta.json": '{"attributes":{"a":1}}',
			"Inv/Other.luau": "",
		});
		fs.writeFileSync(
			path.join(dir, "rojo.project.json"),
			JSON.stringify({ name: "t", tree: { $path: "src/Inv" } })
		);
		await rogenTree();

		const classOf = (node: SourcemapNode | undefined, name: string) =>
			node?.children?.find((child) => child.name === name)?.className;
		const storage = sourcemap(dir, "ours.project.json").children?.find(
			(child) => child.name === "ReplicatedStorage"
		);

		expect(classOf(storage, "Animate")).toBe(
			classOf(sourcemap(dir, "rojo.project.json"), "^Animate")
		);
		expect(metaApplied(storage!)).toContain(
			"Animate <- src/Inv/^Animate.meta.json"
		);
	});

	it("should keep each file's meta under every name Rogen gives it", async () => {
		const meta = '{"attributes":{"a":1}}';
		writeFiles({
			"Inv/Plain.luau": "",
			"Inv/Plain.meta.json": meta,
			"Inv/Save.server.luau": "",
			"Inv/Save.meta.json": meta,
			"Inv/Foo.mock.server.luau": "",
			"Inv/Foo.mock.meta.json": meta,
			"Inv/Combat@server.luau": "",
			"Inv/Combat@server.meta.json": meta,
			"Inv/Analytics.mock.luau": "",
			"Inv/Analytics.mock.meta.json": meta,
			"Inv/Tool.plugin.luau": "",
			"Inv/Tool.meta.json": meta,
			"Inv/Stats.server.json": "{}",
			"Inv/Stats.server.meta.json": meta,
			"Inv/Gun@server.json": "{}",
			"Inv/Gun@server.meta.json": meta,
			"Inv/Notes.txt": "text",
			"Inv/Notes.meta.json": meta,
			"Inv/Items.csv": "Key,Source",
			"Inv/Items.meta.json": meta,
		});
		await rogenTree({
			routes: { server: "ServerScriptService", "*": "ReplicatedStorage" },
			variants: { mock: true },
		});

		expect(metaApplied(sourcemap(dir, "ours.project.json"))).toEqual([
			"ReplicatedStorage/Inv/Analytics <- src/Inv/Analytics.mock.meta.json",
			"ReplicatedStorage/Inv/Items <- src/Inv/Items.meta.json",
			"ReplicatedStorage/Inv/Notes <- src/Inv/Notes.meta.json",
			"ReplicatedStorage/Inv/Plain <- src/Inv/Plain.meta.json",
			"ReplicatedStorage/Inv/Stats.server <- src/Inv/Stats.server.meta.json",
			"ReplicatedStorage/Inv/Tool <- src/Inv/Tool.meta.json",
			"ServerScriptService/Inv/Combat <- src/Inv/Combat@server.meta.json",
			"ServerScriptService/Inv/Foo <- src/Inv/Foo.mock.meta.json",
			"ServerScriptService/Inv/Gun <- src/Inv/Gun@server.meta.json",
			"ServerScriptService/Inv/Save <- src/Inv/Save.meta.json",
		]);
	});

	it("should make an init script every node its folder becomes, alone or through its directory", async () => {
		const meta = '{"attributes":{"a":1}}';
		writeFiles({
			"Net/init.luau": "",
			"Net/init.meta.json": meta,
			"Net/Types.luau": "",
			"Net/server/Remote.luau": "",
			"Net/client/Listener.luau": "",
			"Bots/init.luau": "",
			"Bots/init.mock.server.luau": "",
			"Bots/init.meta.json": meta,
			"Bots/Brain.luau": "",
		});
		await rogenTree({
			routes: {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			},
			variants: { mock: true },
		});

		const tree = sourcemap(dir, "ours.project.json");
		expect(placed(tree)).toEqual(
			[
				"ReplicatedStorage: ReplicatedStorage",
				"ReplicatedStorage/Net: ModuleScript",
				"ReplicatedStorage/Net/Types: ModuleScript",
				"ServerScriptService: ServerScriptService",
				"ServerScriptService/Bots: Script",
				"ServerScriptService/Bots/Brain: ModuleScript",
				"ServerScriptService/Net: ModuleScript",
				"ServerScriptService/Net/Remote: ModuleScript",
				"StarterPlayer: StarterPlayer",
				"StarterPlayer/StarterPlayerScripts: StarterPlayerScripts",
				"StarterPlayer/StarterPlayerScripts/Net: ModuleScript",
				"StarterPlayer/StarterPlayerScripts/Net/Listener: ModuleScript",
			].sort()
		);
		expect(metaApplied(tree)).toEqual([
			"ReplicatedStorage/Net <- src/Net/init.meta.json",
			"ServerScriptService/Net <- src/Net/init.meta.json",
			"StarterPlayer/StarterPlayerScripts/Net <- src/Net/init.meta.json",
		]);
	});

	it("should refuse a RunContext in the meta of an init.luau, so no meta makes a copied init script run", () => {
		writeFiles({
			"Net/init.luau": "",
			"Net/init.meta.json": '{"properties":{"RunContext":"Server"}}',
		});
		fs.writeFileSync(
			path.join(dir, "rojo.project.json"),
			JSON.stringify({ name: "t", tree: { $path: "src/Net" } })
		);

		expect(sourcemapError(dir, "rojo.project.json")).toContain(
			"Unknown property ModuleScript.RunContext"
		);
	});
});
