import type { CSSProperties } from "react";
import { icons, type Icon, type Service } from "./home/explorer";
import { TreeGuides } from "./home/tree-guides";

// The home page's routing panes for docs pages: src/ in VS Code beside the Studio Explorer, in each service's colour.
const KEY_COLOURS: Record<string, Service> = {
	server: "s",
	client: "c",
	shared: "r",
	character: "c",
};
const SERVICES: Record<string, Service> = {
	ServerScriptService: "s",
	ServerStorage: "s",
	ReplicatedStorage: "r",
	ReplicatedFirst: "r",
	StarterPlayer: "c",
	StarterPlayerScripts: "c",
	StarterCharacterScripts: "c",
	StarterGui: "c",
};

/** Rows of an outline indented two spaces per level, measured from its least indented line. */
function rowsOf(text: string) {
	const lines = text.split("\n").filter((line) => line.trim());
	const indents = lines.map((line) => line.length - line.trimStart().length);
	const base = Math.min(...indents);
	return lines.map((line, i) => ({
		depth: (indents[i] - base) / 2,
		name: line.trim(),
	}));
}

const keyColour = (key: string) => KEY_COLOURS[key.toLowerCase()];

function DiskName({ name }: { name: string }) {
	const folder = /^\(?([A-Za-z]+)\)?\/$/.exec(name);
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
	// A lone top folder, such as src/, titles the pane as on the home page.
	const outline = rowsOf(disk);
	const titled =
		outline[0]?.name.endsWith("/") &&
		outline.filter((row) => row.depth === 0).length === 1;
	const diskRows = titled ? outline.slice(1) : outline;
	const depths = diskRows.map((row) => row.depth);
	let colour: Service = "r";
	const studioRows = rowsOf(studio ?? "").map(({ depth, name }) => {
		const service = SERVICES[name];
		if (service && depth === 0) colour = service;
		const icon: Icon = service ? "svc" : name.endsWith("/") ? "dir" : "scr";
		return { depth, name: name.replace(/\/$/, ""), icon, colour };
	});
	return (
		<figure className={`route-fig not-prose${studio ? "" : " solo"}`}>
			<div className="rf-pane">
				<div className="rf-head">
					<b>{titled ? outline[0].name : ""}</b>
					<span>VS Code</span>
				</div>
				<ul className="rf-tree">
					{diskRows.map(({ name }, i) => (
						<li
							key={i}
							className={name.endsWith("/") ? "b" : undefined}
						>
							<TreeGuides depths={depths} i={i} />
							<DiskName name={name} />
						</li>
					))}
				</ul>
			</div>
			{studio && (
				<div className="rf-pane">
					<div className="rf-head">
						<b>Explorer</b>
						<span>Roblox Studio</span>
					</div>
					<ul className="rf-xt">
						{studioRows.map(({ depth, name, icon, colour }, i) => (
							<li
								key={i}
								className={`k-${colour}${icon === "svc" ? " svc" : ""}`}
								style={{ "--d": depth } as CSSProperties}
							>
								<svg
									className="ic"
									viewBox="0 0 16 16"
									aria-hidden="true"
									dangerouslySetInnerHTML={{
										__html: icons[icon],
									}}
								/>
								<span className="nm">{name}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</figure>
	);
}
