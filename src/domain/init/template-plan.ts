import path from "path";
import { joinedWithAnd, joinedWithOr } from "../../base/strings.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { Mount, PlannedFile } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitDirectory } from "./init-directory.js";
import {
	StarterTemplate,
	TEMPLATE_FILE,
	TemplateChoice,
} from "./starter-template.js";

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
			return TemplatePlan.copied(template, mounts, dirs, derived);
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

	private static copied(
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
		return new TemplatePlan(
			{
				fileName: TEMPLATE_FILE,
				// Rewriting would drop comments and formatting, so only do it when something changed.
				content:
					mounted && removed.length + added.length > 0
						? mounted.template.toJson()
						: content,
			},
			TEMPLATE_FILE,
			[
				`Copying ${from} to ${TEMPLATE_FILE}, since Rogen replaces ${from} on every build.`,
				...(removed.length > 0
					? [
							`Left out ${joinedWithAnd(removed)}, since ${removed.length === 1 ? "it points" : "they point"} into ${joinedWithOr(dirs)} and Rogen generates that code now.`,
						]
					: []),
				...(derived?.unrouted.length
					? [
							`Couldn't route ${joinedWithOr(
								derived.unrouted.map(({ node }) => node)
							)}: only a folder directly in a root dir becomes a route. Give ${derived.unrouted.length === 1 ? "its folder" : "each folder"} a marker such as ${path.posix.basename(derived.unrouted[0].target)}@server, or move ${derived.unrouted.length === 1 ? "it" : "them"} up into a root dir.`,
						]
					: []),
				...(added.length > 0
					? [`Added ${joinedWithAnd(added)} to ${TEMPLATE_FILE}.`]
					: []),
				...(skipped.length > 0
					? [
							`Didn't add ${joinedWithAnd(skipped)} to ${TEMPLATE_FILE}, since it already has ${skipped.length === 1 ? "a node" : "nodes"} there.`,
						]
					: []),
			],
			[
				...(stripped
					? []
					: [
							`Remove the nodes in ${TEMPLATE_FILE} that point into ${joinedWithOr(dirs)}; Rogen generates those now.`,
						]),
				...(parsed || mounts.length === 0
					? []
					: [
							`Mount ${joinedWithAnd(
								mounts.map(({ path }) => path)
							)} in ${TEMPLATE_FILE}; Rogen couldn't read it to add the ${mounts.length === 1 ? "mount" : "mounts"}.`,
						]),
			]
		);
	}
}
