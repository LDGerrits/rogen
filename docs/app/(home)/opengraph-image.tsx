import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { appName } from "@/lib/shared";

export const alt =
	"Each feature in one folder: an Inventory folder in VS Code beside its files spread across services in Roblox Studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const paper = "#f7f5f1";
const ink = "#1c1917";
const muted = "#6b645d";
const border = "#e0dcd5";
const rowText = "#3b3b3b";
const chevron = "#616161";
const selection = "#dfe7f5";
const accent = "#005fb8";

type Row = {
	depth: number;
	name: string;
	open?: boolean;
	icon?: string;
	mark?: string;
	inFeature?: boolean;
};

const files: Row[] = [
	{ depth: 0, name: "Inventory", open: true, inFeature: true },
	{ depth: 1, name: "Client", open: true, mark: "Client", inFeature: true },
	{ depth: 2, name: "InventoryWindow.luau", icon: "luau", inFeature: true },
	{
		depth: 1,
		name: "InventoryService@Server.luau",
		icon: "luau",
		mark: "@Server",
		inFeature: true,
	},
	{ depth: 1, name: "ItemConfig.luau", icon: "luau", inFeature: true },
	{ depth: 0, name: "Shop", open: false },
	{ depth: 0, name: "Trading", open: false },
	{ depth: 0, name: "Quests", open: false },
	{ depth: 0, name: "Combat", open: false },
];

const explorer: Row[] = [
	{
		depth: 0,
		name: "ReplicatedStorage",
		open: true,
		icon: "ReplicatedStorage",
	},
	{ depth: 1, name: "Shared", open: true, icon: "Folder" },
	{
		depth: 2,
		name: "Inventory",
		open: true,
		icon: "Folder",
		inFeature: true,
	},
	{ depth: 3, name: "ItemConfig", icon: "ModuleScript", inFeature: true },
	{
		depth: 0,
		name: "ServerScriptService",
		open: true,
		icon: "ServerScriptService",
	},
	{
		depth: 1,
		name: "Inventory",
		open: true,
		icon: "Folder",
		inFeature: true,
	},
	{
		depth: 2,
		name: "InventoryService",
		icon: "ModuleScript",
		inFeature: true,
	},
	{ depth: 0, name: "StarterPlayer", open: true, icon: "StarterPlayer" },
	{
		depth: 1,
		name: "StarterPlayerScripts",
		open: true,
		icon: "StarterPlayerScripts",
	},
	{
		depth: 2,
		name: "Inventory",
		open: true,
		icon: "Folder",
		inFeature: true,
	},
	{
		depth: 3,
		name: "InventoryWindow",
		icon: "ModuleScript",
		inFeature: true,
	},
];

async function studioIcons() {
	const names = [...new Set(explorer.map((row) => row.icon as string))];
	const icons = await Promise.all(
		names.map(async (name) => {
			const png = await readFile(
				join(process.cwd(), "public/studio/light", `${name}.png`)
			);
			return [name, `data:image/png;base64,${png.toString("base64")}`];
		})
	);
	return Object.fromEntries(icons) as Record<string, string>;
}

function Chevron({
	open,
	size,
	solid,
}: {
	open?: boolean;
	size: number;
	solid: boolean;
}) {
	if (open === undefined)
		return <div style={{ display: "flex", width: size }} />;
	const shape = solid
		? { d: open ? "M3 6H17L10 15Z" : "M6 3L15 10L6 17Z", fill: chevron }
		: {
				d: open ? "M4 7L10 13L16 7" : "M7 4L13 10L7 16",
				fill: "none",
				stroke: chevron,
				strokeWidth: 2,
			};
	return (
		<svg width={size} height={size} viewBox="0 0 20 20">
			<path {...shape} />
		</svg>
	);
}

function LuauIcon({ size }: { size: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 20 20">
			<g transform="rotate(16 10 10)">
				<rect x="3" y="3" width="14" height="14" fill="#498ba7" />
				<rect x="11" y="5" width="4" height="4" fill="#fff" />
			</g>
		</svg>
	);
}

function RowName({ name, mark }: Pick<Row, "name" | "mark">) {
	if (!mark) return <span>{name}</span>;
	const start = name.indexOf(mark);
	const parts = [
		{ text: name.slice(0, start) },
		{ text: mark, color: accent },
		{ text: name.slice(start + mark.length) },
	].filter((part) => part.text);
	return (
		<div style={{ display: "flex" }}>
			{parts.map((part, index) => (
				// Each piece is measured apart, which leaves a gap that reads as a space.
				<span
					key={part.text}
					style={{ marginLeft: index && -5, color: part.color }}
				>
					{part.text}
				</span>
			))}
		</div>
	);
}

function Tree({
	rows,
	fontSize,
	rowHeight,
	indent,
	icons,
}: {
	rows: Row[];
	fontSize: number;
	rowHeight: number;
	indent: number;
	icons?: Record<string, string>;
}) {
	const iconSize = Math.round(fontSize * 0.85);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				padding: "12px 0",
				color: rowText,
			}}
		>
			{rows.map((row, index) => (
				<div
					key={index}
					style={{
						display: "flex",
						alignItems: "center",
						height: rowHeight,
						paddingLeft: 18 + row.depth * indent,
						fontSize,
						background: row.inFeature ? selection : "transparent",
					}}
				>
					<Chevron
						open={row.open}
						size={Math.round(fontSize * 0.7)}
						solid={Boolean(icons)}
					/>
					{row.icon && (
						<div
							style={{
								display: "flex",
								marginLeft: 6,
								marginRight: 2,
							}}
						>
							{icons ? (
								<img
									alt=""
									src={icons[row.icon]}
									width={iconSize}
									height={iconSize}
								/>
							) : (
								<LuauIcon size={iconSize} />
							)}
						</div>
					)}
					<div style={{ display: "flex", marginLeft: 6 }}>
						<RowName name={row.name} mark={row.mark} />
					</div>
				</div>
			))}
		</div>
	);
}

function Window({
	title,
	width,
	children,
}: {
	title: string;
	width: number;
	children: ReactNode;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width,
				height: 520,
				background: "#fff",
				border: `1.5px solid ${border}`,
				borderRadius: 16,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					height: 46,
					padding: "0 18px",
					background: "#f8f8f8",
					borderBottom: `1.5px solid ${border}`,
				}}
			>
				{["#ff5f57", "#febc2e", "#28c840"].map((color) => (
					<div
						key={color}
						style={{
							display: "flex",
							width: 13,
							height: 13,
							borderRadius: 13,
							marginRight: 8,
							background: color,
						}}
					/>
				))}
				<div
					style={{
						display: "flex",
						flexGrow: 1,
						justifyContent: "center",
						marginRight: 63,
						fontSize: 22,
						color: chevron,
					}}
				>
					{title}
				</div>
			</div>
			{children}
		</div>
	);
}

export default async function Image() {
	const [regular, semibold, icons] = await Promise.all([
		readFile(join(process.cwd(), "app/fonts/geist-regular.ttf")),
		readFile(join(process.cwd(), "app/fonts/geist-semibold.ttf")),
		studioIcons(),
	]);

	return new ImageResponse(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				padding: "36px 44px 0",
				background: paper,
				color: ink,
				fontFamily: "Geist",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div
					style={{ fontSize: 68, fontWeight: 600, letterSpacing: -2 }}
				>
					Each feature in one folder
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-end",
					}}
				>
					<div style={{ display: "flex", alignItems: "center" }}>
						<Logo
							width={40}
							height={40}
							style={{ color: ink, marginRight: 12 }}
						/>
						<div
							style={{
								fontSize: 34,
								fontWeight: 600,
								letterSpacing: -1,
							}}
						>
							{appName}
						</div>
					</div>
					<div style={{ fontSize: 24, marginTop: 4, color: muted }}>
						A Rojo superset
					</div>
				</div>
			</div>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					marginTop: 26,
				}}
			>
				<Window title="VS Code" width={556}>
					<Tree
						rows={files}
						fontSize={27}
						rowHeight={44}
						indent={28}
					/>
				</Window>
				<Window title="Roblox Studio" width={540}>
					<Tree
						rows={explorer}
						fontSize={26}
						rowHeight={38}
						indent={24}
						icons={icons}
					/>
				</Window>
			</div>
		</div>,
		{
			...size,
			fonts: [
				{ name: "Geist", data: regular, weight: 400, style: "normal" },
				{ name: "Geist", data: semibold, weight: 600, style: "normal" },
			],
		}
	);
}
