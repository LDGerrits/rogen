import type { CSSProperties } from "react";
import {
	Chevron,
	ClassIcon,
	classOfFile,
	FileIcon,
	hasChildren,
	IndentGuides,
	instanceName,
	isService,
	outlineOf,
	StudioWindow,
	Triangle,
	VsCodeWindow,
} from "./ide";

// A project in VS Code beside the Studio Explorer it makes, for docs pages.
const KEYS: Record<string, string> = {
	server: "s",
	client: "c",
	shared: "r",
	character: "c",
};

const keyColour = (key: string) => KEYS[key.toLowerCase()];

function DiskName({ name }: { name: string }) {
	const folder = /^\(?([A-Za-z]+)\)?$/.exec(name);
	if (folder && keyColour(folder[1]))
		return <span className={`nm c-${keyColour(folder[1])}`}>{name}</span>;
	// An @key, or Rojo's .server and .client on a script, in its route's colour.
	const at =
		/@([A-Za-z]+)/.exec(name) ?? /\.(server|client)(?=\.\w+$)/.exec(name);
	if (!at || !keyColour(at[1])) return <span className="nm">{name}</span>;
	const end = at.index + at[0].length;
	return (
		<span className="nm">
			{name.slice(0, at.index)}
			<span className={`c-${keyColour(at[1])}`}>{at[0]}</span>
			{name.slice(end)}
		</span>
	);
}

export function RouteFigure({
	disk,
	studio,
}: {
	disk: string;
	studio?: string;
}) {
	const diskRows = outlineOf(disk);
	// Each script in the Explorer takes the class its file makes, and an init file gives its folder's.
	const classes = new Map<string, string>();
	diskRows.forEach((row, i) => {
		if (row.name.endsWith("/")) return;
		const kind = classOfFile(row.name);
		if (!kind) return;
		const parent = diskRows
			.slice(0, i)
			.findLast((above) => above.depth < row.depth);
		const name = instanceName(row.name);
		classes.set(
			name === "init" && parent ? parent.name.replace(/\/$/, "") : name,
			kind
		);
	});
	const studioRows = outlineOf(studio ?? "");
	return (
		<figure className={`route-fig ide not-prose${studio ? "" : " solo"}`}>
			<VsCodeWindow title="my-game">
				<div className="ide-section">
					<Chevron open />
					MY-GAME
				</div>
				<ul className="ide-tree">
					{diskRows.map(({ depth, name }, i) => {
						const folder = name.endsWith("/");
						return (
							<li
								key={i}
								style={{ "--d": depth } as CSSProperties}
							>
								<IndentGuides depth={depth} />
								{folder ? (
									<Chevron open={hasChildren(diskRows, i)} />
								) : (
									<span className="ide-chev" />
								)}
								{!folder && <FileIcon name={name} />}
								<DiskName name={name.replace(/\/$/, "")} />
							</li>
						);
					})}
				</ul>
			</VsCodeWindow>
			{studio && (
				<StudioWindow>
					<ul className="ide-tree">
						{studioRows.map(({ depth, name }, i) => {
							const bare = name.replace(/\/$/, "");
							const parent = hasChildren(studioRows, i);
							const icon = isService(bare)
								? bare
								: name.endsWith("/")
									? "Folder"
									: (classes.get(bare) ??
										(parent ? "Folder" : "ModuleScript"));
							return (
								<li
									key={i}
									style={{ "--d": depth } as CSSProperties}
								>
									<Triangle
										open={
											parent
												? true
												: name.endsWith("/")
													? false
													: undefined
										}
									/>
									<ClassIcon name={icon} />
									<span className="nm">{bare}</span>
								</li>
							);
						})}
					</ul>
				</StudioWindow>
			)}
		</figure>
	);
}
