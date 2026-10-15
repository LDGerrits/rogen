import path from "path";
import { SyncbackLayout, Donor } from "./syncback-layout.js";

/** An instance the place holds that no file of the project makes. */
export interface NewInstance {
	/** The instance path of the node it is a child of. */
	readonly parent: readonly string[];
	readonly name: string;
	/** Whether it is a folder of other instances rather than a file. */
	readonly folder: boolean;
}

/** Where a new instance is written, as the folder it goes into. */
export interface NewHome {
	/** Absolute POSIX path of the folder to write into. */
	readonly dir: string;
	/** For a folder: its files go into `dir` and the folder itself is not made, as the routing folder is the folder. */
	readonly contents: boolean;
	/** What to add to the name of the file or folder written, such as `@server`. */
	readonly mark: string;
}

export type NewPlacement =
	| { readonly kind: "placed"; readonly home: NewHome }
	| { readonly kind: "conflict"; readonly reason: string };

const conflict = (reason: string): NewPlacement => ({
	kind: "conflict",
	reason,
});

/** Runs routing backwards: from the instance path of an instance the place added to the folder a file for it goes in. */
export class ReverseRouter {
	constructor(private readonly layout: SyncbackLayout) {}

	place(instance: NewInstance): NewPlacement {
		const { parent } = instance;
		for (let depth = parent.length; depth >= 1; depth--) {
			const donors = this.layout.donorsAt(parent.slice(0, depth));
			if (donors.length > 0)
				return this.besideDonors(donors, parent.slice(depth));
		}
		return this.asNewFeature(instance);
	}

	private besideDonors(
		donors: readonly Donor[],
		below: readonly string[]
	): NewPlacement {
		const layouts = new Map<string, Donor>();
		for (const donor of donors)
			layouts.set(
				`${donor.dir}\0${donor.style}\0${donor.spelled ?? ""}`,
				donor
			);
		if (layouts.size > 1)
			return conflict(
				`files beside it are in more than one place: ${[...layouts.values()].map(({ dir }) => dir).join(", ")}`
			);
		const [donor] = layouts.values();
		if (donor.style === "suffix" && below.length > 0)
			return conflict(
				`the files beside it are named for their route (@${donor.spelled}), and none lies in its folder`
			);
		return {
			kind: "placed",
			home: {
				dir: path.posix.join(donor.dir, ...below),
				contents: false,
				mark: donor.style === "suffix" ? `@${donor.spelled}` : "",
			},
		};
	}

	private asNewFeature({ parent, name, folder }: NewInstance): NewPlacement {
		const { config } = this.layout;
		const roots = this.layout.sourcePaths;
		if (roots.length !== 1)
			return conflict(
				roots.length === 0
					? "the project has no source path"
					: `no file beside it says which source path holds it: ${roots.join(", ")}`
			);
		const candidates = [...config.routes]
			.filter(([, target]) =>
				target.instancePath.every((part, at) => parent[at] === part)
			)
			.map(([key, target]) => ({
				key,
				depth: target.instancePath.length,
			}));
		if (candidates.length === 0)
			return conflict("no route puts files where its parent is");
		const depth = Math.max(
			...candidates.map((candidate) => candidate.depth)
		);
		const deepest = candidates.filter(
			(candidate) => candidate.depth === depth
		);
		const keyed = deepest.filter(({ key }) => key !== "*");
		if (keyed.length > 1)
			return conflict(
				`more than one route puts files there: ${keyed.map(({ key }) => key).join(", ")}`
			);
		const below = parent.slice(depth);
		const [root] = roots;
		if (keyed.length === 0)
			return {
				kind: "placed",
				home: {
					dir: path.posix.join(root, ...below),
					contents: false,
					mark: "",
				},
			};
		const routingFolder = this.layout.folderNameFor(keyed[0].key);
		return folder
			? {
					kind: "placed",
					home: {
						dir: path.posix.join(
							root,
							...below,
							name,
							routingFolder
						),
						contents: true,
						mark: "",
					},
				}
			: {
					kind: "placed",
					home: {
						dir: path.posix.join(root, ...below, routingFolder),
						contents: false,
						mark: "",
					},
				};
	}
}
