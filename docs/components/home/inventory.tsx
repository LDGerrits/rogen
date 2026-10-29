import type { ReactNode } from "react";
import { icons, type Icon, type Service } from "./explorer";
import type { Lang } from "./lang-script";

// The example feature, src/Inventory, on disk and in the Studio Explorer.
export type DiskRow = [
	name: string,
	depth: number,
	key?: string,
	colour?: Service,
];
export type StudioRow = [
	key: string,
	name: string,
	depth: number,
	icon: Icon,
	colour: Service,
];

const luauDisk: DiskRow[] = [
	["src/", 0],
	["Inventory/", 1],
	["UI/", 2],
	["InventoryHud.luau", 3, "hud", "r"],
	["ItemSlot.luau", 3, "slot", "r"],
	["InventoryController@Client.luau", 2, "ctrl", "c"],
	["InventoryInput@Client.luau", 2, "input", "c"],
	["InventoryService@Server.luau", 2, "svc", "s"],
	["InventoryStore@Server.luau", 2, "store", "s"],
	["InventoryTypes.luau", 2, "types", "r"],
	["ItemCatalog.luau", 2, "cat", "r"],
	["ItemIcons.rbxm", 2, "icons", "r"],
];

// roblox-ts: lowercase folders and route keys, kebab-case files as in Next.js.
const tsDisk: DiskRow[] = [
	["src/", 0],
	["inventory/", 1],
	["ui/", 2],
	["inventory-hud.tsx", 3, "hud", "r"],
	["item-slot.tsx", 3, "slot", "r"],
	["inventory-controller@client.ts", 2, "ctrl", "c"],
	["inventory-input@client.ts", 2, "input", "c"],
	["inventory-service@server.ts", 2, "svc", "s"],
	["inventory-store@server.ts", 2, "store", "s"],
	["inventory-types.ts", 2, "types", "r"],
	["item-catalog.ts", 2, "cat", "r"],
	["item-icons.ts", 2, "icons", "r"],
];

const luauStudio: StudioRow[] = [
	["", "ReplicatedStorage", 0, "svc", "r"],
	["", "Shared", 1, "dir", "r"],
	["", "Inventory", 2, "dir", "r"],
	["types", "InventoryTypes", 3, "scr", "r"],
	["cat", "ItemCatalog", 3, "scr", "r"],
	["icons", "ItemIcons", 3, "mdl", "r"],
	["", "UI", 3, "dir", "r"],
	["hud", "InventoryHud", 4, "scr", "r"],
	["slot", "ItemSlot", 4, "scr", "r"],
	["", "ServerScriptService", 0, "svc", "s"],
	["", "Inventory", 1, "dir", "s"],
	["svc", "InventoryService", 2, "scr", "s"],
	["store", "InventoryStore", 2, "scr", "s"],
	["", "StarterPlayer", 0, "svc", "c"],
	["", "StarterPlayerScripts", 1, "svc", "c"],
	["", "Inventory", 2, "dir", "c"],
	["ctrl", "InventoryController", 3, "scr", "c"],
	["input", "InventoryInput", 3, "scr", "c"],
];

const tsStudio: StudioRow[] = [
	["", "ReplicatedStorage", 0, "svc", "r"],
	["", "shared", 1, "dir", "r"],
	["", "inventory", 2, "dir", "r"],
	["types", "inventory-types", 3, "scr", "r"],
	["cat", "item-catalog", 3, "scr", "r"],
	["icons", "item-icons", 3, "scr", "r"],
	["", "ui", 3, "dir", "r"],
	["hud", "inventory-hud", 4, "scr", "r"],
	["slot", "item-slot", 4, "scr", "r"],
	["", "ServerScriptService", 0, "svc", "s"],
	["", "inventory", 1, "dir", "s"],
	["svc", "inventory-service", 2, "scr", "s"],
	["store", "inventory-store", 2, "scr", "s"],
	["", "StarterPlayer", 0, "svc", "c"],
	["", "StarterPlayerScripts", 1, "svc", "c"],
	["", "inventory", 2, "dir", "c"],
	["ctrl", "inventory-controller", 3, "scr", "c"],
	["input", "inventory-input", 3, "scr", "c"],
];

export const disk: Record<Lang, DiskRow[]> = { luau: luauDisk, ts: tsDisk };
export const studio: Record<Lang, StudioRow[]> = {
	luau: luauStudio,
	ts: tsStudio,
};

/** Both versions of a piece of text; the stylesheet shows the one for the current language. */
export function L({ luau, ts }: { luau: ReactNode; ts: ReactNode }) {
	return (
		<>
			<span data-only="luau">{luau}</span>
			<span data-only="ts">{ts}</span>
		</>
	);
}

/** A file name with its @Server or @Client suffix in that route's colour. */
export function Name({ name, colour }: { name: string; colour?: Service }) {
	const at = name.indexOf("@");
	if (at < 0) return <span className="nm">{name}</span>;
	const dot = name.lastIndexOf(".");
	return (
		<span className="nm">
			{name.slice(0, at)}
			<span className={`c-${colour}`}>{name.slice(at, dot)}</span>
			{name.slice(dot)}
		</span>
	);
}

export function StudioIcon({ icon }: { icon: Icon }) {
	return (
		<svg
			className="ic"
			viewBox="0 0 16 16"
			aria-hidden="true"
			dangerouslySetInnerHTML={{ __html: icons[icon] }}
		/>
	);
}
