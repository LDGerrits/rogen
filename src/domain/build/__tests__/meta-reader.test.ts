import { jest } from "@jest/globals";
import { fileSystemError } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { MetaReader } from "../meta-reader.js";
import { abs, configOf, indexOf, placeFiles, syncTools } from "./fixtures.js";

describe("MetaReader", () => {
	type Read = Pick<ResolvedConfig, "rootDirs" | "exclude">;

	describe("read", () => {
		let fs: MemoryFileSystemService;

		const read = async (overrides: Partial<Read> = {}) => {
			const config: Read = {
				rootDirs: [abs("src")],
				exclude: [],
				...overrides,
			};
			const index = await indexOf(fs, config.rootDirs);
			const built = await new MetaReader(fs).read(
				placeFiles(index, configOf(config), syncTools).unwrap()
			);
			return built.map(({ folderMeta }) => folderMeta);
		};

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		it("should say a meta file that vanished while the build ran does not exist", async () => {
			await fs.writeFile(abs("src/Combat/init.meta.json"), "{}");
			jest.spyOn(fs, "readFile").mockRejectedValue(
				fileSystemError(
					"ENOENT",
					"ENOENT: no such file or directory, open 'x'"
				)
			);

			const result = await read();

			expect(result.isErr() && result.error).toMatchObject([
				{
					code: "meta.unreadable",
					message: expect.stringContaining("does not exist any more"),
				},
			]);
		});

		it("should give the reason, without a Node code, for a meta file it could not read", async () => {
			await fs.writeFile(abs("src/Combat/init.meta.json"), "{}");
			jest.spyOn(fs, "readFile").mockRejectedValue(
				fileSystemError(
					"EISDIR",
					"EISDIR: illegal operation on a directory, read"
				)
			);

			const result = await read();

			expect(result.isErr() && result.error).toMatchObject([
				{
					message:
						"the meta file could not be read: illegal operation on a directory.",
				},
			]);
		});

		it("should read every init.meta.json with its folder and fields", async () => {
			await fs.writeFile(
				abs("src/Combat/init.meta.json"),
				JSON.stringify({
					className: "Actor",
					properties: { Enabled: false },
					attributes: { Priority: 1 },
					ignoreUnknownInstances: true,
					id: "combat",
				})
			);
			await fs.writeFile(abs("src/init.meta.json"), "{}");

			const result = await read();

			expect(result.unwrap()).toEqual([
				{
					file: abs("src/Combat/init.meta.json"),
					rootDir: abs("src"),
					dir: "Combat",
					fields: {
						className: "Actor",
						properties: { Enabled: false },
						attributes: { Priority: 1 },
						ignoreUnknownInstances: true,
						id: "combat",
					},
					merged: [],
				},
				{
					file: abs("src/init.meta.json"),
					rootDir: abs("src"),
					dir: "",
					fields: {},
					merged: [],
				},
			]);
		});

		it("should warn of a mistyped field in a folder's meta, and of the same file once", async () => {
			await fs.writeFile(
				abs("src/Combat/init.meta.json"),
				'{ "classname": "Actor" }'
			);
			await fs.writeFile(abs("src/Combat/Hit.luau"), "");

			const index = await indexOf(fs, [abs("src")]);
			const built = await new MetaReader(fs).read(
				placeFiles(
					index,
					configOf({
						rootDirs: [abs("src")],
						exclude: [],
					}),
					syncTools
				).unwrap()
			);

			expect(built.unwrap().warnings).toMatchObject([
				{
					code: "meta.unknownField",
					resource: abs("src/Combat/init.meta.json"),
				},
			]);
		});

		it("should skip a file's meta and an excluded folder's", async () => {
			await fs.writeFile(abs("src/Save.meta.json"), "{ broken");
			await fs.writeFile(abs("src/legacy/init.meta.json"), "{ broken");

			const result = await read({ exclude: [abs("src/legacy")] });

			expect(result.unwrap()).toEqual([]);
		});

		it("should accept comments, trailing commas and unknown fields", async () => {
			await fs.writeFile(
				abs("src/Combat/init.meta.json"),
				'{\n\t// an actor\n\t"$schema": "x",\n\t"className": "Actor",\n}'
			);

			const result = await read();

			expect(result.unwrap()).toEqual([
				{
					file: abs("src/Combat/init.meta.json"),
					rootDir: abs("src"),
					dir: "Combat",
					fields: { className: "Actor" },
					merged: [],
				},
			]);
		});

		it("should fail with the file and position when the JSONC is invalid", async () => {
			await fs.writeFile(
				abs("src/Combat/init.meta.json"),
				'{\n\t"className": }'
			);

			const result = await read();

			expect(result.isErr() ? result.error : []).toMatchObject([
				{
					code: "meta.invalidSyntax",
					resource: abs("src/Combat/init.meta.json"),
					position: { line: 2, column: 15 },
				},
			]);
		});

		it("should fail when the meta isn't an object", async () => {
			await fs.writeFile(abs("src/Combat/init.meta.json"), "[]");

			const result = await read();

			expect(result.isErr() ? result.error : []).toMatchObject([
				{
					code: "meta.notAnObject",
					resource: abs("src/Combat/init.meta.json"),
				},
			]);
		});

		it("should fail at the value when a known field has the wrong type", async () => {
			await fs.writeFile(
				abs("src/Combat/init.meta.json"),
				'{\n\t"className": 1,\n\t"attributes": []\n}'
			);

			const result = await read();

			const errors = result.isErr() ? result.error : [];
			expect(errors).toMatchObject([
				{ code: "meta.wrongType", position: { line: 2, column: 15 } },
				{ code: "meta.wrongType", position: { line: 3, column: 16 } },
			]);
			expect(errors[0].message).toBe(
				'"className": expected a string, found a number.'
			);
		});

		it("should fail when a ModuleScript's meta sets a RunContext, its own or its folder's", async () => {
			await fs.writeFile(abs("src/Save.luau"), "");
			await fs.writeFile(
				abs("src/Save.meta.json"),
				'{"properties": {"RunContext": "Server"}}'
			);
			await fs.writeFile(abs("src/Net/init.luau"), "");
			await fs.writeFile(
				abs("src/Net/init.meta.json"),
				'{"properties": {"RunContext": "Client"}}'
			);

			const result = await read();

			expect(
				result.isErr()
					? result.error.map(({ code, resource }) => [code, resource])
					: []
			).toEqual([
				["meta.runContextOnModule", abs("src/Net/init.meta.json")],
				["meta.runContextOnModule", abs("src/Save.meta.json")],
			]);
		});

		it("should fail when the meta of a folder with an init script sets a className, which only a Folder takes", async () => {
			await fs.writeFile(abs("src/Net/init.luau"), "");
			await fs.writeFile(
				abs("src/Net/init.meta.json"),
				'{"className": "Folder"}'
			);
			await fs.writeFile(abs("src/Plain/A.luau"), "");
			await fs.writeFile(
				abs("src/Plain/init.meta.json"),
				'{"className": "Actor"}'
			);

			const result = await read();

			expect(
				result.isErr()
					? result.error.map(({ code, resource }) => [code, resource])
					: []
			).toEqual([
				["meta.classNameOnScript", abs("src/Net/init.meta.json")],
			]);
		});

		it("should read an init.meta.json and an init.meta.jsonc of one folder as one meta, the .jsonc over the .json", async () => {
			await fs.writeFile(abs("src/Combat/A.luau"), "");
			await fs.writeFile(
				abs("src/Combat/init.meta.json"),
				'{"className": "Actor", "properties": {"Name": "x"}, "attributes": {"a": 1}}'
			);
			await fs.writeFile(
				abs("src/Combat/init.meta.jsonc"),
				'{"properties": {"Archivable": false}, "attributes": {"b": 2}}'
			);

			const result = await read();

			const metas = result.isOk() ? result.value : [];
			expect(metas).toHaveLength(1);
			expect(metas[0].file).toBe(abs("src/Combat/init.meta.jsonc"));
			expect(metas[0].files).toEqual([
				abs("src/Combat/init.meta.jsonc"),
				abs("src/Combat/init.meta.json"),
			]);
			expect(metas[0].fields).toEqual({
				className: "Actor",
				properties: { Name: "x", Archivable: false },
				attributes: { b: 2 },
			});
		});

		it("should find a RunContext in the .meta.json of a script that has a .meta.jsonc too", async () => {
			await fs.writeFile(abs("src/Save.luau"), "");
			await fs.writeFile(
				abs("src/Save.meta.json"),
				'{"properties": {"RunContext": "Server"}}'
			);
			await fs.writeFile(abs("src/Save.meta.jsonc"), "{}");

			const result = await read();

			expect(
				result.isErr()
					? result.error.map(({ code, resource }) => [code, resource])
					: []
			).toEqual([["meta.runContextOnModule", abs("src/Save.meta.json")]]);
		});

		it("should accept a RunContext in the meta of a Script", async () => {
			await fs.writeFile(abs("src/Save.server.luau"), "");
			await fs.writeFile(
				abs("src/Save.meta.json"),
				'{"properties": {"RunContext": "Server"}}'
			);
			await fs.writeFile(abs("src/Net/init.client.luau"), "");
			await fs.writeFile(
				abs("src/Net/init.meta.json"),
				'{"properties": {"RunContext": "Client"}}'
			);

			const result = await read();

			expect(result.isOk()).toBe(true);
		});

		it("should report every invalid meta file at once", async () => {
			await fs.writeFile(abs("src/A/init.meta.json"), "{ broken");
			await fs.writeFile(abs("src/B/init.meta.json"), '{"id": true}');

			const result = await read();

			expect(
				new Set(
					result.isErr()
						? result.error.map(({ resource }) => resource)
						: []
				)
			).toEqual(
				new Set([
					abs("src/A/init.meta.json"),
					abs("src/B/init.meta.json"),
				])
			);
		});
	});
});
