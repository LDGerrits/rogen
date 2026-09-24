import fs from "fs";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { DiskFileSystemService } from "../../../platform/fs/disk-file-system-service.js";
import { writeOutput } from "../../output/write-output.js";
import {
	SourcemapNode,
	describeWithRojo,
	makeRojoDir,
	sourcemap,
} from "../../rojo/__tests__/rojo-cli.js";
import { build } from "../build.js";

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
	"X.md": "# notes",
	"Y.msgpack": "",
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

	const rogenTree = async () => {
		const fileSystem = new DiskFileSystemService();
		const index = store.add(new CoreIndexService(fileSystem));
		const config = {
			name: "t",
			rootDirs: [path.join(dir, "src")],
			routes: { "*": "ReplicatedStorage" },
			tags: {},
			exclude: [],
			outFile: path.join(dir, "ours.project.json"),
		};
		await index.initialize(config.rootDirs);
		const built = build(config, index).unwrap();
		(await writeOutput(fileSystem, config, built.value)).unwrap();
	};

	it("should place every Rojo-native file as Rojo would", async () => {
		for (const [file, content] of Object.entries(FILES)) {
			fs.mkdirSync(path.dirname(path.join(dir, "src", file)), {
				recursive: true,
			});
			fs.writeFileSync(path.join(dir, "src", file), content);
		}
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
});
