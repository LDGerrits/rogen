import fs from "fs";
import path from "path";
import { mockConfig } from "./mock-config-service.js";
import {
	DeclaredKeys,
	SCHEMA_URL,
	configFileName,
	configLabel,
	rootDirOverlap,
	schemaUrlFor,
} from "../config.js";

describe("domain/config/config", () => {
	describe("configFileName and configLabel", () => {
		it("should add the suffix to a stem", () => {
			expect(configFileName("lobby")).toBe("lobby.rogen.json");
		});

		it("should take the stem back out of a config path", () => {
			expect(configLabel("/repo/lobby.rogen.json")).toBe("lobby");
		});
	});

	describe("rootDirOverlap", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should find the root dir another one sits inside", () => {
			expect(rootDirOverlap([abs("src"), abs("src/lobby")], 1)).toEqual({
				kind: "nested",
				outer: abs("src"),
			});
		});

		it("should find a root dir listed again", () => {
			expect(rootDirOverlap([abs("src"), abs("src")], 1)).toEqual({
				kind: "duplicate",
			});
		});

		it("should leave the first of two equal root dirs alone", () => {
			expect(rootDirOverlap([abs("src"), abs("src")], 0)).toBeUndefined();
		});

		it("should be undefined for siblings", () => {
			expect(
				rootDirOverlap([abs("core"), abs("lobby")], 0)
			).toBeUndefined();
		});
	});

	describe("schemaUrlFor", () => {
		it("should point a stable release at its major", () => {
			expect(schemaUrlFor("2.1.0")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2/rogen.json"
			);
		});

		it("should point a new major's pre-release at its major", () => {
			expect(schemaUrlFor("2.0.0-beta.1")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2/rogen.json"
			);
		});

		it("should point a later pre-release at its exact version", () => {
			expect(schemaUrlFor("2.1.0-beta.1")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2.1.0-beta.1/rogen.json"
			);
		});

		it("should match the URL init writes for the package version", () => {
			const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
				version: string;
			};
			expect(SCHEMA_URL).toBe(schemaUrlFor(pkg.version));
		});
	});

	describe("DeclaredKeys", () => {
		const routes = new DeclaredKeys(["server", "client", "shared"], []);
		const withVariants = new DeclaredKeys(
			["server", "client", "shared"],
			["mock", "debug"]
		);

		it("should hold every key except the fallback route, which no name can spell", () => {
			const keys = new DeclaredKeys(["*", "server"], ["mock"]);

			expect([...keys.routeKeys]).toEqual(["server"]);
			expect([...keys.variantKeys]).toEqual(["mock"]);
			expect([...keys.all]).toEqual(["server", "mock"]);
		});

		describe("modes", () => {
			const keys = new DeclaredKeys(
				["server"],
				["mock"],
				["dev", "prod"]
			);

			it("should read a mode as a key that marks a file, beside the variants", () => {
				expect([...keys.modeKeys]).toEqual(["dev", "prod"]);
				expect([...keys.variantKeys]).toEqual(["mock", "dev", "prod"]);
				expect([...keys.all]).toEqual([
					"server",
					"mock",
					"dev",
					"prod",
				]);
				expect(keys.isVariant("dev")).toBe(true);
				expect(keys.isMode("dev")).toBe(true);
				expect(keys.isMode("mock")).toBe(false);
			});

			it("should resolve a mode with its first letter in either case", () => {
				expect(keys.resolveVariant("Prod")).toBe("prod");
				expect(keys.resolve("prod")).toBe("prod");
			});

			it("should name a mode a near miss", () => {
				expect(keys.nearMiss("PROD")).toBe("prod");
			});
		});

		describe("resolve", () => {
			it("should match a name spelled exactly like a declared key", () => {
				expect(routes.resolve("server")).toBe("server");
			});

			it("should match with the first letter in the other case and report the declared key", () => {
				expect(routes.resolve("Server")).toBe("server");
				expect(new DeclaredKeys(["Server"], []).resolve("server")).toBe(
					"Server"
				);
			});

			it("should not match any other difference in case", () => {
				expect(routes.resolve("SERVER")).toBeUndefined();
				expect(routes.resolve("sERVER")).toBeUndefined();
			});

			it("should not match an undeclared name or an empty one", () => {
				expect(routes.resolve("Inventory")).toBeUndefined();
				expect(routes.resolve("")).toBeUndefined();
			});

			it("should tell a route from a variant", () => {
				expect(withVariants.resolveRoute("mock")).toBeUndefined();
				expect(withVariants.resolveVariant("mock")).toBe("mock");
				expect(withVariants.resolveRoute("Server")).toBe("server");
				expect(withVariants.resolveVariant("server")).toBeUndefined();
				expect(withVariants.resolve("Mock")).toBe("mock");
			});
		});

		describe("nearMiss", () => {
			it("should name the key a name only differs from beyond the first letter", () => {
				expect(routes.nearMiss("SERVER")).toBe("server");
				expect(routes.nearMiss("sERVER")).toBe("server");
			});

			it("should ignore a name that matches, including with the first letter flipped", () => {
				expect(routes.nearMiss("server")).toBeUndefined();
				expect(routes.nearMiss("Server")).toBeUndefined();
			});

			it("should ignore an unrelated name", () => {
				expect(routes.nearMiss("Inventory")).toBeUndefined();
			});
		});

		it("should say which keys are variants", () => {
			expect(withVariants.isVariant("mock")).toBe(true);
			expect(withVariants.isVariant("server")).toBe(false);
		});

		it("should share an identity between keys that differ only in the first letter", () => {
			expect(DeclaredKeys.identityOf("Server")).toBe(
				DeclaredKeys.identityOf("server")
			);
			expect(DeclaredKeys.identityOf("Server")).not.toBe(
				DeclaredKeys.identityOf("Servers")
			);
		});

		it("should flip the first letter", () => {
			expect(DeclaredKeys.flipFirstLetter("server")).toBe("Server");
			expect(DeclaredKeys.flipFirstLetter("Server")).toBe("server");
		});

		it.each(["a", "Server", "level2"])(
			"should accept %j as a name",
			(text) => {
				expect(DeclaredKeys.isName(text)).toBe(true);
			}
		);

		it.each(["", "2fast", "a-b", "a b", "*"])(
			"should reject %j as a name",
			(text) => {
				expect(DeclaredKeys.isName(text)).toBe(false);
			}
		);
	});

	describe("ResolvedConfig", () => {
		it("should be asked for by the name of its file", () => {
			expect(mockConfig({ file: "/repo/lobby.rogen.json" }).label).toBe(
				"lobby"
			);
		});

		it("should build in the directory of its project file", () => {
			expect(
				mockConfig({ outFile: "/repo/out/game.project.json" })
					.projectDir
			).toBe("/repo/out");
		});

		it("should share the deepest directory of its root dirs", () => {
			expect(
				mockConfig({ rootDirs: ["/repo/a/x", "/repo/a/y"] }).commonRoot
			).toBe("/repo/a");
			expect(mockConfig({ rootDirs: [] }).commonRoot).toBeUndefined();
		});

		describe("modes", () => {
			const config = mockConfig({
				variants: { mock: false },
				exclude: ["/repo/a"],
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["/repo/b"] },
				},
				mode: "prod",
			});

			it("should hold the declared modes and the active one", () => {
				expect(config.modes).toEqual(["dev", "prod"]);
				expect(config.mode).toBe("prod");
				expect(config.exclude).toEqual(["/repo/a", "/repo/b"]);
			});

			it("should count the active mode on and every other off when it prunes", () => {
				const matches = [
					{ variant: "dev" },
					{ variant: "prod" },
					{ variant: "mock" },
				];

				expect(config.dormantVariants(matches)).toEqual([
					{ variant: "dev" },
					{ variant: "mock" },
				]);
				expect(config.allVariantsOn([{ variant: "prod" }])).toBe(true);
			});

			it("should leave a mode's name out of the variants it lists", () => {
				expect(config.variants).toEqual({ mock: false });
			});

			it("should give the same config in another mode", () => {
				const dev = config.inMode("dev");

				expect(dev).toMatchObject({
					mode: "dev",
					variants: { mock: true },
					exclude: ["/repo/a"],
					file: config.file,
				});
				expect(dev?.dormantVariants([{ variant: "prod" }])).toEqual([
					{ variant: "prod" },
				]);
			});

			it("should have no other mode to give", () => {
				expect(config.inMode("staging")).toBeUndefined();
				expect(mockConfig().modes).toEqual([]);
				expect(mockConfig().mode).toBeUndefined();
			});
		});

		it("should pick out the variants a file carries that are off", () => {
			const config = mockConfig({ variants: { mock: true, dev: false } });

			expect(
				config.dormantVariants([
					{ variant: "mock", form: "suffix" },
					{ variant: "dev", form: "folder" },
				])
			).toEqual([{ variant: "dev", form: "folder" }]);
		});

		it("should say whether every variant a file carries is on", () => {
			const config = mockConfig({ variants: { mock: true, dev: false } });

			expect(config.allVariantsOn([])).toBe(true);
			expect(
				config.allVariantsOn([{ variant: "mock", form: "suffix" }])
			).toBe(true);
			expect(
				config.allVariantsOn([
					{ variant: "mock", form: "suffix" },
					{ variant: "dev", form: "folder" },
				])
			).toBe(false);
		});

		it("should know its declared keys from its routes and variants", () => {
			const { keys } = mockConfig({
				routes: {
					"*": "ReplicatedStorage",
					server: "ServerScriptService",
				},
				variants: { mock: true },
			});

			expect([...keys.routeKeys]).toEqual(["server"]);
			expect([...keys.variantKeys]).toEqual(["mock"]);
		});
	});

	describe("ResolvedTemplate", () => {
		const template = (
			project: Record<string, unknown>,
			file = "/repo/t.json"
		) => mockConfig({ template: { file, project } }).template!;

		it("should equal a template with the same file and project", () => {
			expect(template({ tree: {} }).equals(template({ tree: {} }))).toBe(
				true
			);
		});

		it("should differ when the project or its file does", () => {
			expect(
				template({ tree: {} }).equals(template({ tree: { A: {} } }))
			).toBe(false);
			expect(
				template({ tree: {} }).equals(
					template({ tree: {} }, "/repo/u.json")
				)
			).toBe(false);
		});

		it("should differ from no template", () => {
			expect(template({ tree: {} }).equals(undefined)).toBe(false);
		});
	});
});
