import path from "path";
import { samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { SyncServer } from "../runner/sync-server.js";
import { ToolManifest } from "../toolchain/tool-manifest.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { Setup } from "./setup.js";

const ROJO_NAME = "rojo";

/** Adds the pin that makes Rogen run the same Rojo for everyone who clones the repo. */
export class RojoPinSetup implements Setup<boolean> {
	constructor(
		private readonly manifest: ToolManifest,
		private readonly questions: InitQuestions
	) {}

	/** The Rokit file in `directory` to pin Rojo in, unless a toolchain file there or above already pins it, or the file uses the name `rojo` for another tool. */
	static manifestFor(
		directory: string,
		manifests: readonly ToolManifest[]
	): ToolManifest | undefined {
		if (
			manifests.some((manifest) =>
				manifest.nameOf(SyncServer.ROJO.repository)
			)
		)
			return undefined;
		return manifests.find(
			(manifest) =>
				manifest.managerId === "rokit" &&
				!manifest.uses(ROJO_NAME) &&
				samePath(path.dirname(manifest.file), directory)
		);
	}

	async ask(): Promise<Result<boolean | undefined, Diagnostic[]>> {
		return ok(
			await this.questions.addRojoPin(path.basename(this.manifest.file))
		);
	}

	plan(pin: boolean, builder: InitPlanBuilder): void {
		if (!pin) return;
		const server = SyncServer.ROJO;
		builder.addToolManifest({
			fileName: path.basename(this.manifest.file),
			content: this.manifest.withPin(
				ROJO_NAME,
				server.repository,
				server.pinned.toString()
			),
			addition: `${server.name}'s pin`,
		});
		builder.addSetup(
			`Run '${this.manifest.installCommand}', then '${server.pluginCommand}' to install ${server.name} and its Studio plugin.`
		);
	}
}
