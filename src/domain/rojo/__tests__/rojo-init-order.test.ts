import fs from "fs";
import path from "path";
import { RojoFile } from "../rojo.js";
import { SyncRule } from "../sync-rules.js";
import { built, describeWithRojo, makeRojoDir } from "./rojo-cli.js";

const INIT_FILES = [...RojoFile.INIT_FILES];

const FOLDERS: readonly (readonly string[])[] = [
	...INIT_FILES.map((_, at) => INIT_FILES.slice(at)),
	...INIT_FILES.flatMap((first, at) =>
		INIT_FILES.slice(at + 1).map((second) => [second, first])
	),
];

const contentOf = (name: string): string =>
	name.endsWith(".csv") ? `Key,Source\n${name},x` : `-- ${name}`;

const readFirst = (rbxmx: string): Map<string, string> =>
	new Map(
		[
			...rbxmx.matchAll(
				/<string name="Name">(F\d+)<\/string>([\s\S]*?)<\/Properties>/g
			),
		].map(([, folder, properties]) => [
			folder,
			/init\.[a-z.]+/.exec(properties)![0],
		])
	);

describeWithRojo("domain/rojo/rojo against Rojo's init files", () => {
	let dir: string;

	beforeEach(() => {
		dir = makeRojoDir("rogen-init-order-");
		FOLDERS.forEach((names, at) => {
			const folder = path.join(dir, "src", `F${at}`);
			fs.mkdirSync(folder, { recursive: true });
			for (const name of names)
				fs.writeFileSync(path.join(folder, name), contentOf(name));
		});
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const rojoReads = (syncRules?: readonly SyncRule[]) => {
		fs.writeFileSync(
			path.join(dir, "default.project.json"),
			JSON.stringify({
				name: "t",
				tree: { $path: "src" },
				...(syncRules && { syncRules }),
			})
		);
		return readFirst(built(dir, "default.project.json"));
	};

	const rogenReads = () =>
		new Map(
			FOLDERS.map((names, at) => [
				`F${at}`,
				RojoFile.initReadFirst(names),
			])
		);

	it("should read first the init file Rojo reads of a folder", () => {
		expect(rojoReads()).toEqual(rogenReads());
	});

	it("should read the same init file first whatever sync rules the project has", () => {
		expect(
			rojoReads([
				{ pattern: "init.luau", use: "ignore" },
				{ pattern: "*.server.luau", use: "moduleScript" },
				{ pattern: "*.luau", use: "serverScript" },
				{ pattern: "*.lua", use: "clientScript" },
				{ pattern: "*.csv", use: "text" },
			])
		).toEqual(rogenReads());
	});
});
