import type { CSSProperties, ReactNode } from "react";

// VS Code's explorer and Roblox Studio's Explorer as they look, in the site's light or dark theme.
// Class icons are Studio's own; file icons are VS Code's Seti theme and luau-lsp's Luau icon.

const SERVICES = new Set([
	"Workspace",
	"Players",
	"Lighting",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"StarterPlayerScripts",
	"StarterCharacterScripts",
	"SoundService",
	"Teams",
]);

export const isService = (name: string) => SERVICES.has(name);

/** One row of an outline indented two spaces per level, measured from its least indented line. */
export interface OutlineRow {
	depth: number;
	name: string;
}

export function outlineOf(text: string): OutlineRow[] {
	const lines = text.split("\n").filter((line) => line.trim());
	const indents = lines.map((line) => line.length - line.trimStart().length);
	const base = Math.min(...indents);
	return lines.map((line, i) => ({
		depth: (indents[i] - base) / 2,
		name: line.trim(),
	}));
}

/** Whether the row after i is inside it. */
export const hasChildren = (rows: { depth: number }[], i: number) =>
	(rows[i + 1]?.depth ?? -1) > rows[i].depth;

/** The class Rojo makes from a file, by its name, or undefined when it makes none. */
export function classOfFile(file: string): string | undefined {
	const name = file.replace(/@\w+(?=\.|$)/, "");
	if (/\.(meta|project)\.json$/.test(name) || name.startsWith("@"))
		return undefined;
	if (/\.server\.(luau|lua|ts)$/.test(name)) return "Script";
	if (/\.client\.(luau|lua|ts|tsx)$/.test(name)) return "LocalScript";
	if (/\.(rbxm|rbxmx|model\.json)$/.test(name)) return "Model";
	if (/\.txt$/.test(name)) return "StringValue";
	if (/\.csv$/.test(name)) return "LocalizationTable";
	return "ModuleScript";
}

/** The instance name Rojo gives a file: its name without the extension, Rojo's suffixes or an @ suffix. */
export const instanceName = (file: string) =>
	file
		.replace(/@\w+(?=\.|$)/, "")
		.replace(/(\.(server|client|model|meta|project))?\.\w+$/, "");

export function TrafficLights() {
	return (
		<span className="ide-tl" aria-hidden="true">
			<i />
			<i />
			<i />
		</span>
	);
}

/** The CSS that shows a Studio class's icon, light or dark with the site. */
export const classIconStyle = (name: string) =>
	({
		"--il": `url(/studio/light/${name}.png)`,
		"--id": `url(/studio/dark/${name}.png)`,
	}) as CSSProperties;

export function ClassIcon({ name }: { name: string }) {
	return (
		<span
			className="ide-ci"
			aria-hidden="true"
			style={classIconStyle(name)}
		/>
	);
}

// luau-lsp's Luau file icon, on a 60x60 grid.
export const LUAU_ICON =
	"M15.86 5.51 5.51 44.14l38.63 10.35 10.35-38.63zm20.84 9.89 12.67 3.4-3.4 12.67-12.67-3.4z";

// Seti's glyph and colour class for each kind of file VS Code shows.
const SETI: [RegExp, string, string][] = [
	[/\.jsonc?$/, "\ue055", "json"],
	[/\.toml$/, "\ue019", "config"],
	[/\.tsx$/, "\ue07d", "ts"],
	[/\.ts$/, "\ue099", "ts"],
	[/\.md$/, "\ue060", "ts"],
	[/\.csv$/, "\ue01e", "csv"],
	[/\.ya?ml$/, "\ue0a7", "yml"],
];

/** The Seti glyph and its colour class for a file, or undefined for a Luau file, which has luau-lsp's icon. */
export function setiOf(
	name: string
): [glyph: string, kind: string] | undefined {
	if (/\.luau?$/.test(name)) return undefined;
	const [, glyph, kind] = SETI.find(([pattern]) => pattern.test(name)) ?? [
		null,
		"\ue023",
		"file",
	];
	return [glyph, kind];
}

export function FileIcon({ name }: { name: string }) {
	const seti = setiOf(name);
	if (!seti)
		return (
			<span className="ide-fi luau" aria-hidden="true">
				<svg viewBox="0 0 60 60">
					<path fillRule="evenodd" d={LUAU_ICON} />
				</svg>
			</span>
		);
	return (
		<span className={`ide-fi seti ${seti[1]}`} aria-hidden="true">
			{seti[0]}
		</span>
	);
}

export function Chevron({ open }: { open: boolean }) {
	return (
		<svg className="ide-chev" viewBox="0 0 16 16" aria-hidden="true">
			<path d={open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4"} />
		</svg>
	);
}

export function Triangle({ open }: { open?: boolean }) {
	return (
		<svg className="ide-tri" viewBox="0 0 10 10" aria-hidden="true">
			{open !== undefined && (
				<path d={open ? "M1.5 3h7L5 7.5z" : "M3 1.5v7L7.5 5z"} />
			)}
		</svg>
	);
}

/** VS Code's indent guides in front of a row at this depth, one per open folder above it. */
export function IndentGuides({ depth }: { depth: number }) {
	return (
		<>
			{Array.from({ length: depth }, (_, level) => (
				<i
					key={level}
					className="ide-guide"
					style={{ "--a": level } as CSSProperties}
				/>
			))}
		</>
	);
}

/** A window of VS Code: its title bar, then what it shows. */
export function VsCodeWindow({
	title,
	children,
	className,
}: {
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={`ide-win ide-vs${className ? ` ${className}` : ""}`}>
			<div className="ide-bar">
				<TrafficLights />
				<b>{title}</b>
			</div>
			{children}
		</div>
	);
}

/** Roblox Studio's Explorer: its title bar and search field, then what it shows. */
export function StudioWindow({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={`ide-win ide-st${className ? ` ${className}` : ""}`}>
			<div className="ide-bar">
				<TrafficLights />
				<b>Explorer</b>
			</div>
			<div className="ide-search" aria-hidden="true">
				<span>
					Search
					<svg viewBox="0 0 16 16">
						<path d="M2.5 8a5.5 5.5 0 105.5-5.5A5.5 5.5 0 003.6 4.7M3.3 2v3h3M8 5v3.2l2 1.3" />
					</svg>
				</span>
				<span>•••</span>
			</div>
			{children}
		</div>
	);
}
