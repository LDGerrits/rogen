import path from "path";
import { isObject } from "../../base/objects.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { toPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { RogenConfig, RogenKeys, configFileContent } from "../config/config.js";
import { RojoNode } from "../rojo/rojo-project.js";
import { Darklua, Language, PlannedFile } from "../toolchain/toolchain.js";
import { GreeterSample } from "./greeter-sample.js";
import { InitPlan } from "./init-service.js";
import { InitQuestions } from "./init-questions.js";
import { PROCESSED_OUTPUT, RELEASE_OUTPUT } from "./output-configs.js";
import { PlaceLayout, PlaceLayouts, PlaceModel } from "./place-layout.js";
import { StarterPlaces } from "./starter-places.js";

const TSCONFIG = "tsconfig.json";

/** A place added to a workspace that has places: a complete config copied from the first place that has one, beside the files that place has for its toolchain. */
export class PlaceInit {
	private readonly layouts: PlaceLayouts;

	constructor(
		private readonly fileReader: FileReader,
		private readonly questions: InitQuestions,
		/** The folder the user ran in, which the plan's config paths are relative to. */
		private readonly cwd: string,
		/** The language of the sample a place at the root starts with. */
		private readonly luau: Language
	) {
		this.layouts = new PlaceLayouts(fileReader);
	}

	/** The plan to add `folder` as a place, or `undefined` when it is not a place of a workspace that has places, and `init` starts a project there. */
	async plan(folder: string): Promise<Result<InitPlan | undefined, Error>> {
		const layout = await this.layouts.find(this.cwd, folder);
		if (!layout) return ok(undefined);
		const taken = await this.taken(layout);
		if (taken.length > 0) return err(new DiagnosticsError(taken));
		return ok(await this.planIn(layout));
	}

	private async planIn(layout: PlaceLayout): Promise<InitPlan> {
		const { root, place, folder, model, sourcePaths, source } = layout;
		const base = this.copyOf(model, layout);

		const outputs = await this.outputsOf(model, base);
		const copied = await this.copiedFiles(layout);
		const compiled = base.rogen?.compiledPath;
		const processed = outputs.find(({ stem }) => stem === PROCESSED_OUTPUT)
			?.config.rogen?.compiledPath;
		const serve = processed ? layout.configFile(PROCESSED_OUTPUT) : place;
		const compile = copied.some(({ fileName }) =>
			fileName.endsWith(TSCONFIG)
		);
		const ignored = folder
			? await this.ignoreHint(root, place, [
					...(compile ? ["out", "include"] : []),
					...(processed ? [processed] : []),
				])
			: undefined;
		const configFile = layout.configFile();
		const inFolder = (command: string) =>
			folder ? `cd ${folder} && ${command}` : command;

		return {
			directory: root,
			purpose: "create",
			summary: [
				{ area: "Place", text: place },
				{ area: "Code", text: [...sourcePaths].join(", ") },
			],
			files: [
				{
					fileName: configFile,
					content: configFileContent(base),
				},
				...outputs.map(({ stem, config }) => ({
					fileName: layout.configFile(stem),
					content: configFileContent(config),
				})),
				...copied,
				...(await this.sample(layout)),
			],
			directories: [source],
			commands: [],
			configs: [
				toPosix(path.relative(this.cwd, path.join(root, configFile))),
			],
			warnings: [],
			notes: [
				`Copied the ${joinedWithAnd(["routes", ...(compiled ? ["compiled path"] : []), ...(base.tree ? ["tree"] : [])])} of ${toPosix(path.relative(root, folder ? model.folder : model.file))}.`,
			],
			nextSteps: {
				setup: [],
				run: [
					...(compile ? [`rbxtsc -w -p ${place}`] : []),
					...(processed
						? this.processCommands(
								layout,
								compile ? [compiled ?? "out"] : sourcePaths,
								processed
							).map(inFolder)
						: []),
					`rogen serve ${serve}`,
				],
				edits: [
					...(ignored ? [ignored] : []),
					...(compile
						? [
								`Add rbxtsc -p ${place} and rbxtsc -w -p ${place} to the build and watch scripts in package.json, so 'npm run watch' compiles it too.`,
							]
						: []),
					`Put the code of ${layout.name} in ${source}. A second place is served from a second terminal with its own --port: 'rogen serve ${serve} --port <port>'.`,
					...(layout.seeded
						? [
								`luau-lsp reads the sourcemap of one place at a time. To read ${layout.name}, set the generatorCommand in .vscode/settings.json to "${StarterPlaces.sourcemapCommand(layout.name)}".`,
							]
						: []),
				],
			},
			asked: this.questions.interactive,
			decided: this.questions.decided,
			present: [],
			gitInit: false,
		};
	}

	/** The config and folder the plan would write that are there already, which `init` never overwrites. */
	private async taken(layout: PlaceLayout): Promise<Diagnostic[]> {
		const taken: Diagnostic[] = [];
		const config = path.join(layout.root, layout.configFile());
		if (await this.fileReader.exists(config))
			taken.push(
				errorDiagnostic(
					"init.configExists",
					{ resource: config },
					"this config already exists, and init never overwrites one. Pick another name for the place."
				)
			);
		const source = path.join(layout.root, layout.source);
		if (layout.seeded && (await this.fileReader.exists(source)))
			taken.push(
				errorDiagnostic(
					"init.fileExists",
					{ resource: source },
					"this folder already exists, and init never overwrites one. Pick another name for the place."
				)
			);
		return taken;
	}

	/** The commands that keep the new place's processed code current. The first place already runs one for the shared code, so a place at the root runs only its own. */
	private processCommands(
		layout: PlaceLayout,
		sourceDirs: readonly string[],
		compiledPath: string
	): string[] {
		const commands = new Darklua().processCommands(
			path.join(layout.root, layout.folder),
			sourceDirs,
			compiledPath
		);
		return layout.seeded ? commands.slice(-1) : commands;
	}

	private copyOf(
		{ config }: PlaceModel,
		{ name, sourcePaths }: PlaceLayout
	): RogenConfig {
		const rogen = isObject(config.rogen) ? config.rogen : {};
		const { routes, compiledPath } = rogen as RogenKeys;
		const keys: RogenKeys = {
			sourcePaths: [...sourcePaths],
			...(routes && { routes }),
			...(compiledPath && { compiledPath }),
		};
		return {
			name,
			...(isObject(config.tree) && { tree: config.tree as RojoNode }),
			rogen: keys,
		};
	}

	/** `dist` and `release` for the new place when the model has them, each as the model's with the new place's keys. */
	private async outputsOf(
		model: PlaceModel,
		base: RogenConfig
	): Promise<{ stem: string; config: RogenConfig }[]> {
		const outputs: { stem: string; config: RogenConfig }[] = [];
		for (const stem of [PROCESSED_OUTPUT, RELEASE_OUTPUT]) {
			const twin = await model.output(stem);
			if (!twin) continue;
			const rogen = isObject(twin.rogen) ? (twin.rogen as RogenKeys) : {};
			outputs.push({
				stem,
				config: {
					...base,
					rogen: {
						...base.rogen,
						...(rogen.compiledPath && {
							compiledPath: rogen.compiledPath,
						}),
					},
					...(Array.isArray(twin.globIgnorePaths) && {
						globIgnorePaths: twin.globIgnorePaths as string[],
					}),
				},
			});
		}
		return outputs;
	}

	/** The files the model has for the toolchain of its code, which are the same in a place at the same depth. A place at the root has no folder for them, and shares the root's. */
	private async copiedFiles({
		model,
		folder,
		place,
	}: PlaceLayout): Promise<PlannedFile[]> {
		const copied: PlannedFile[] = [];
		if (!folder) return copied;
		for (const name of [TSCONFIG, ...new Darklua().configFiles]) {
			const file = path.join(model.folder, name);
			if (await this.fileReader.isFile(file))
				copied.push({
					fileName: path.posix.join(place, name),
					content: await this.fileReader.readFile(file),
				});
		}
		return copied;
	}

	/** The script the first place starts with, for the new one; none with `--no-sample`, or when the shared code no longer has the module the script requires. */
	private async sample({
		root,
		name,
		seeded,
		source,
		sourcePaths,
	}: PlaceLayout): Promise<PlannedFile[]> {
		if (!seeded) return [];
		const sample = new GreeterSample(this.luau, path.basename(root));
		const greeting = path.join(root, sample.greeting(sourcePaths[0]));
		return (await this.fileReader.isFile(greeting)) &&
			this.questions.sample()
			? sample.addedPlace(source, name)
			: [];
	}

	/** What to add to the `.gitignore` of the root so what a toolchain writes into `place` stays out of git, which init never edits; none when it lists them or there is none. */
	private async ignoreHint(
		root: string,
		place: string,
		folders: readonly string[]
	): Promise<string | undefined> {
		if (folders.length === 0) return undefined;
		const text = await tryWithAsync(() =>
			this.fileReader.readFile(path.join(root, ".gitignore"))
		);
		if (text.isErr()) return undefined;
		const missing = folders.filter(
			(folder) =>
				![
					`${place}/${folder}`,
					`${path.posix.dirname(place)}/*/${folder}`,
				].some((line) => text.value.includes(line))
		);
		return missing.length === 0
			? undefined
			: `Add ${missing.map((folder) => `${place}/${folder}`).join(" and ")} to .gitignore so what is built into ${missing.length === 1 ? "it" : "them"} isn't committed.`;
	}
}
