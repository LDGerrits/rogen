import { toNative } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { UnplacedInstance } from "./syncback.js";
import { SyncbackLayout } from "./syncback-layout.js";

/** A property edit Rojo made on an instance, which the meta file of the folder that makes it would hold. */
export interface MetaRequest<T> {
	readonly instance: readonly string[];
	readonly edit: T;
}

/** An edit that goes into the `init.meta.json` of a feature folder, which sets it on every instance the folder makes. */
interface PlacedMeta<T> extends MetaRequest<T> {
	readonly folder: string;
}

/** Where property edits on the instances of feature folders go: a feature's meta when every instance it makes got the same edit, left out otherwise; an edit on an instance no feature folder makes comes back as `homeless`. */
export function featureMetas<T>(
	layout: SyncbackLayout,
	requests: readonly MetaRequest<T>[],
	same: (a: T, b: T) => boolean
): {
	placed: PlacedMeta<T>[];
	unplaced: UnplacedInstance[];
	homeless: MetaRequest<T>[];
} {
	const homeless: MetaRequest<T>[] = [];
	const features = new Map<
		string,
		{ instances: (readonly string[])[]; requests: MetaRequest<T>[] }
	>();
	for (const request of requests) {
		const feature = layout.featureMaking(request.instance);
		if (!feature) {
			homeless.push(request);
			continue;
		}
		const known = features.get(feature.folder) ?? {
			instances: feature.instances,
			requests: [],
		};
		known.requests.push(request);
		features.set(feature.folder, known);
	}
	const placed: PlacedMeta<T>[] = [];
	const unplaced: UnplacedInstance[] = [];
	for (const [folder, { instances, requests: edits }] of features) {
		const keys = edits.map(({ instance }) => instanceKey(instance));
		const missing = instances
			.map(instanceKey)
			.filter((key) => !keys.includes(key));
		const alike = edits.every(({ edit }) => same(edit, edits[0].edit));
		if (missing.length === 0 && alike) {
			placed.push({ folder, ...edits[0] });
			continue;
		}
		const meta = toNative(`${folder}/${RojoFile.INIT_META}`);
		const reason =
			missing.length > 0
				? `${meta} would also set it on ${joinedWithAnd(missing)}; set it on all of them in Studio, or edit ${meta} by hand`
				: `it differs between the instances ${toNative(folder)} makes, which share ${meta}; set it alike in Studio, or edit ${meta} by hand`;
		for (const key of keys) unplaced.push({ instance: key, reason });
	}
	return { placed, unplaced, homeless };
}
