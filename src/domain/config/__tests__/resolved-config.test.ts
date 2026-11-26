import path from "path";
import { toPosix } from "../../../base/path.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { CompiledPath, ResolvedConfig } from "../resolved-config.js";

const projectDir = path.resolve("/repo");
const at = (...parts: string[]) => path.join(projectDir, ...parts);
const posixAt = (...parts: string[]) => toPosix(at(...parts));

const langRules = SyncRules.following(
	SyncRules.read([{ pattern: "*.lang", use: "moduleScript" }]).rules,
	toPosix(projectDir)
);

const compiledOf = (folder: string | undefined, root = at("src")) =>
	new CompiledPath(folder, root, projectDir, langRules);

describe("CompiledPath", () => {
	describe("of", () => {
		it("should keep a file where it is when the config compiles nothing", () => {
			const file = at("src", "A.luau");

			expect(compiledOf(undefined).of(file)).toBe(file);
		});

		it("should repeat a file's place under the root inside the compiled folder", () => {
			expect(compiledOf(at("out")).of(at("src", "lib", "A.luau"))).toBe(
				at("out", "lib", "A.luau")
			);
		});
	});

	describe("sourceOf", () => {
		it("should keep a compiled file where it is when the config compiles nothing", () => {
			const file = at("out", "A.luau");

			expect(compiledOf(undefined).sourceOf(file)).toBe(file);
		});

		it("should map a compiled file back under the root", () => {
			const compiled = compiledOf(at("out"));
			const source = at("src", "lib", "A.luau");

			expect(compiled.sourceOf(compiled.of(source))).toBe(source);
		});
	});

	describe("glob", () => {
		it("should keep a glob when the config compiles nothing", () => {
			expect(compiledOf(undefined).glob("src/**/*.spec.luau")).toBe(
				"src/**/*.spec.luau"
			);
		});

		it("should move a glob under the root into the compiled folder, with forward slashes", () => {
			expect(
				compiledOf(at("build", "out")).glob("src/lib/**/*.spec.luau")
			).toBe("build/out/lib/**/*.spec.luau");
		});

		it("should keep a glob outside the root", () => {
			expect(compiledOf(at("out")).glob("assets/**")).toBe("assets/**");
		});
	});

	describe("fileOf", () => {
		it("should read a source as Rojo does when the config compiles nothing", () => {
			const file = compiledOf(undefined).fileOf(posixAt("src", "A.lang"));

			expect(file.isCompiled).toBe(false);
			expect(file.isLuau).toBe(true);
		});

		it("should read a sync-rule source as compiled when the config compiles", () => {
			expect(
				compiledOf(at("out")).fileOf(posixAt("src", "A.lang"))
					.isCompiled
			).toBe(true);
		});
	});
});

describe("ResolvedConfig", () => {
	const configWith = (sourcePaths: string[], compiledPath?: string) =>
		new ResolvedConfig({
			file: at("default.project.json"),
			projectName: "default",
			project: new RojoProject({ name: "default", tree: {} }),
			sourcePaths,
			routes: new Map(),
			ignored: [],
			compiledPath,
			warnings: [],
		});

	it("should root its compiled path at the common folder of its source paths", () => {
		const { compiled } = configWith(
			[at("src", "server"), at("src", "shared")],
			at("out")
		);

		expect(compiled).toMatchObject({ folder: at("out"), root: at("src") });
		expect(compiled.of(at("src", "shared", "A.luau"))).toBe(
			at("out", "shared", "A.luau")
		);
	});

	it("should root its compiled path at the project folder when there are no source paths", () => {
		const config = configWith([], at("out"));

		expect(config.compiled.root).toBe(projectDir);
		expect(config.compiledPath).toBe(at("out"));
	});
});
