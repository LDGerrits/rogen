import { UsageError } from "../../../base/errors.js";
import { Result, ResultError, err, ok } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { ConfigSelection } from "../../config/config-service.js";
import { selectionOf } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	RojoCommandRun,
	RojoCommandService,
} from "../../runner/rojo-command-service.js";
import { configOf } from "../../write/__tests__/fixtures.js";
import { RojoSyncback } from "../rojo-syncback.js";
import { SyncbackRequest } from "../syncback.js";
import { abs, layoutOf } from "./layout-fixtures.js";

class FakeRojo implements RojoCommandService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly ran: (
			project: ResolvedConfig
		) => Result<RojoCommandRun, Error>
	) {}

	choose(selection: ConfigSelection): ResolvedConfig {
		return selection.configs[0];
	}

	projects(): never {
		throw new Error("not used");
	}

	runBare(): never {
		throw new Error("not used");
	}

	watch(): never {
		throw new Error("not used");
	}

	async run(
		_selection: unknown,
		{ project }: { project?: unknown }
	): Promise<Result<RojoCommandRun, Error>> {
		return this.ran(project as ResolvedConfig);
	}
}

describe("RojoSyncback", () => {
	const config = configOf();
	const request: SyncbackRequest = {
		selection: selectionOf(config),
		project: config,
		input: "game.rbxl",
		cwd: "/repo",
	};

	const failingWith =
		(failure: DiagnosticsError | UsageError) => (project: ResolvedConfig) =>
			ok({ project, messages: [], failure });

	const errorOf = (result: Result<unknown, Error>) =>
		(result as ResultError<Error>).error;

	describe("refusedYaml", () => {
		it("should find no refused YAML file in an error that holds no diagnostics", () => {
			expect(
				RojoSyncback.refusedYaml(
					new Error(
						"Failed to syncback Workspace/Data because cannot syncback Yaml middleware"
					)
				)
			).toBeUndefined();
		});
	});

	describe("plain", () => {
		it("should fail when Rojo can't be run", async () => {
			const failure = new Error("rojo is not installed");
			const rojo = new RojoSyncback(
				request,
				new FakeRojo(() => err(failure))
			);

			expect(errorOf(await rojo.plain(true))).toBe(failure);
		});
	});

	describe("listOn", () => {
		it("should pass on a usage error of Rojo's run as it is", async () => {
			const failure = new UsageError("Rojo is too old", "Update it.");
			const rojo = new RojoSyncback(
				request,
				new FakeRojo(failingWith(failure))
			);

			const listed = await rojo.listOn(
				"/repo/x.project.json",
				new AbortController().signal
			);

			expect(errorOf(listed)).toBe(failure);
		});
	});

	describe("explain", () => {
		const refusal = new DiagnosticsError([
			errorDiagnostic(
				"rojo.failed",
				{ resource: "/repo" },
				"The child 'Gone' of Instance 'Workspace' is present only in a project file"
			),
		]);

		it("should find the node Rojo would not remove", () => {
			expect(RojoSyncback.refusedNode(refusal)).toEqual({
				parent: "Workspace",
				child: "Gone",
			});
			expect(
				RojoSyncback.refusedNode(new Error(refusal.message))
			).toBeUndefined();
		});

		it("should pass on an error about anything else as it is", async () => {
			const failure = new UsageError("Rojo is too old", "Update it.");

			expect(
				new RojoSyncback(
					request,
					new FakeRojo(failingWith(failure))
				).explain(failure, await layoutOf([]))
			).toBe(failure);
		});

		it("should say to remove the node from the tree when no file makes the instance Rojo would not remove", async () => {
			const rojo = new RojoSyncback(
				request,
				new FakeRojo(failingWith(refusal))
			);

			const explained = rojo.explain(
				refusal,
				await layoutOf(["src/Inventory/Server/Bag.luau"])
			);

			expect((explained as DiagnosticsError).diagnostics).toMatchObject([
				{
					code: "syncback.removedFromProjectFile",
					resource: config.file,
					message:
						"the place no longer holds Workspace/Gone, and the tree of the config defines it, which syncback cannot remove. Remove its node from the tree, then run syncback again.",
				},
			]);
		});

		it.each([
			[
				"a feature side that holds a nested project",
				"ServerScriptService",
				"Shop",
				["src/Shop/Server/A.luau", "src/Shop/Server/B.luau"],
				`Delete ${abs("src/Shop/Server/A.luau")}, ${abs("src/Shop/Server/B.luau")}, or put it back`,
			],
			[
				"a service a route makes",
				"Game",
				"ReplicatedStorage",
				[
					"src/A/Shared/A.luau",
					"src/B/Shared/B.luau",
					"src/C/Shared/C.luau",
					"src/D/Shared/D.luau",
				],
				"and 1 more, or put it back",
			],
		])(
			"should name the files of %s that Rojo would not remove",
			async (_, parent, child, files, advice) => {
				const failure = new DiagnosticsError([
					errorDiagnostic(
						"rojo.failed",
						{ resource: "/repo" },
						`The child '${child}' of Instance '${parent}' is present only in a project file`
					),
				]);
				const rojo = new RojoSyncback(
					request,
					new FakeRojo(failingWith(failure))
				);

				const explained = rojo.explain(
					failure,
					await layoutOf(files)
				) as DiagnosticsError;

				expect(explained.diagnostics[0].message).toContain(advice);
				expect(explained.diagnostics[0].message).not.toContain(
					"Remove its node"
				);
			}
		);
	});
});
