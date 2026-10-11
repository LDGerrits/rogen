import path from "path";
import { joinedWithAnd, joinedWithOr } from "../../base/strings.js";
import { Mount, PlannedFile } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitDirectory } from "./init-directory.js";
import { StarterTemplate, TEMPLATE_FILE } from "./starter-template.js";
import { instanceKey } from "../roblox/roblox.js";

/** What the template question answers. */
export type TemplateChoice =
	/** Start `template.project.json` from the package mounts, when there are any. */
	| { readonly kind: "new" }
	/** Copy a hand-written project file to `template.project.json`. */
	| { readonly kind: "copy"; readonly from: string }
	/** Reference a hand-written project file as it is. */
	| { readonly kind: "use"; readonly file: string };

/** The template a new project chose, with the text of a copied file read in. */
export type ProjectTemplate =
	| Exclude<TemplateChoice, { readonly kind: "copy" }>
	| {
			readonly kind: "copy";
			readonly from: string;
			readonly content: string;
	  };

/** What a new project's template is made of. */
export interface TemplateInputs {
	readonly template: ProjectTemplate;
	/** Where a new template starts; at the root when unset. */
	readonly templateDir?: string;
	readonly mounts: readonly Mount[];
	/** The folders Rogen generates nodes for now, which a copy leaves out. */
	readonly dirs: readonly string[];
	/** The routes the nodes a copy leaves out become. */
	readonly derived: DerivedRoutes | undefined;
}

/** The name of the folder a mount at `target` lies in or is: a file's folder is where its marker goes. */
function folderNameOf(target: string): string {
	const name = path.posix.basename(target);
	return path.posix.extname(name) === ""
		? name
		: path.posix.basename(path.posix.dirname(target));
}

/** Which template a new project's configs name, the file `init` writes for it, and what it says about it. */
export class TemplatePlan {
	private constructor(
		readonly file: PlannedFile | undefined,
		/** What the configs name as their template. */
		readonly reference: string | undefined,
		readonly notes: readonly string[],
		readonly edits: readonly string[]
	) {}

	/** An existing `template.project.json` wins; else the choice: copy a hand-written file, use it as it is, or start one from the mounts in `templateDir`. */
	static of(
		directory: InitDirectory,
		configSet: ConfigSet,
		{ template, templateDir, mounts, dirs, derived }: TemplateInputs
	): TemplatePlan {
		if (directory.has(TEMPLATE_FILE)) {
			const handWritten = directory.handWrittenProjectFiles;
			const replaced = configSet.outputFiles.filter((file) =>
				handWritten.includes(file)
			);
			return new TemplatePlan(
				undefined,
				TEMPLATE_FILE,
				[
					`Using ${TEMPLATE_FILE}.`,
					...replaced.map(
						(file) =>
							`Rogen replaces ${file} on every build; move anything you need from it into ${TEMPLATE_FILE} first.`
					),
				],
				[]
			);
		}
		if (template.kind === "copy")
			return TemplatePlan.copied(
				TEMPLATE_FILE,
				template,
				mounts,
				dirs,
				derived
			);
		if (template.kind === "use")
			return new TemplatePlan(
				undefined,
				template.file,
				[`Using ${template.file} as the template.`],
				[]
			);

		const fileName = templateDir
			? `${templateDir}/${TEMPLATE_FILE}`
			: TEMPLATE_FILE;
		const started = StarterTemplate.fromMounts(
			directory.projectName,
			templateDir
				? mounts.map((mount) => ({
						...mount,
						path: path.posix.relative(templateDir, mount.path),
					}))
				: mounts
		);
		return started
			? new TemplatePlan(
					{ fileName, content: started.toJson() },
					fileName,
					[],
					[]
				)
			: new TemplatePlan(undefined, undefined, [], []);
	}

	/** A hand-written project file copied to `fileName`, as a place's template, without the nodes that point into `dirs`. */
	static copiedTo(
		fileName: string,
		source: { readonly from: string; readonly content: string },
		dirs: readonly string[]
	): TemplatePlan {
		return TemplatePlan.copied(fileName, source, [], dirs, undefined);
	}

	private static copied(
		fileName: string,
		{ from, content }: { readonly from: string; readonly content: string },
		mounts: readonly Mount[],
		dirs: readonly string[],
		derived: DerivedRoutes | undefined
	): TemplatePlan {
		const parsed = StarterTemplate.parse(content);
		const stripped = parsed?.withoutNodesIn(dirs);
		const mounted = (stripped?.template ?? parsed)?.withMounts(mounts);
		const removed = (stripped?.removed ?? []).map(({ instancePath }) =>
			instanceKey(instancePath)
		);
		const added = mounted?.added ?? [];
		const skipped = mounted?.skipped ?? [];
		// Its paths read from the folder it was written in, so a copy into another folder moves them.
		const folder = path.posix.dirname(fileName);
		const moved = folder !== ".";
		const rewritten =
			mounted && (removed.length + added.length > 0 || moved)
				? (moved
						? mounted.template.rebased(".", folder)
						: mounted.template
					).toJson()
				: undefined;
		return new TemplatePlan(
			{
				fileName,
				// Rewriting would drop comments and formatting, so only do it when something changed.
				content: rewritten ?? content,
			},
			fileName,
			[
				`Copying ${from} to ${fileName}, since Rogen replaces ${from} on every build.`,
				...(removed.length > 0
					? [
							`Left out ${joinedWithAnd(removed)}, since ${removed.length === 1 ? "it points" : "they point"} into ${joinedWithOr(dirs)} and Rogen generates that code now.`,
						]
					: []),
				...(derived?.unrouted.length
					? [
							`Couldn't route ${joinedWithOr(
								derived.unrouted.map(({ node }) => node)
							)}: only a folder directly in a root dir becomes a route. Give ${derived.unrouted.length === 1 ? "its folder" : "each folder"} a marker such as ${folderNameOf(derived.unrouted[0].target)}@server, or move ${derived.unrouted.length === 1 ? "it" : "them"} up into a root dir.`,
						]
					: []),
				...(added.length > 0
					? [`Added ${joinedWithAnd(added)} to ${fileName}.`]
					: []),
				...(skipped.length > 0
					? [
							`Didn't add ${joinedWithAnd(skipped)} to ${fileName}, since it already has ${skipped.length === 1 ? "a node" : "nodes"} there.`,
						]
					: []),
			],
			[
				...(stripped
					? []
					: [
							`Remove the nodes in ${fileName} that point into ${joinedWithOr(dirs)}; Rogen generates those now.`,
						]),
				...(parsed || !moved
					? []
					: [
							`Check the "$path" entries in ${fileName}: they read from the folder ${from} lies in, and Rogen couldn't read the file to move them.`,
						]),
				...(parsed || mounts.length === 0
					? []
					: [
							`Mount ${joinedWithAnd(
								mounts.map(({ path }) => path)
							)} in ${fileName}; Rogen couldn't read it to add the ${mounts.length === 1 ? "mount" : "mounts"}.`,
						]),
			]
		);
	}
}
