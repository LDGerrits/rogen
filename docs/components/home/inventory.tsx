import type { ReactNode } from "react";
import type { Icon, Service } from "./explorer";
import type { Lang } from "./lang-script";

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
	["InventoryHud.luau", 3, "hud", "replicated"],
	["ItemSlot.luau", 3, "slot", "replicated"],
	["InventoryController@Client.luau", 2, "ctrl", "client"],
	["InventoryInput@Client.luau", 2, "input", "client"],
	["InventoryService@Server.luau", 2, "svc", "server"],
	["InventoryStore@Server.luau", 2, "store", "server"],
	["InventoryTypes.luau", 2, "types", "replicated"],
	["ItemCatalog.luau", 2, "cat", "replicated"],
	["ItemIcons.rbxm", 2, "icons", "replicated"],
];

const tsDisk: DiskRow[] = [
	["src/", 0],
	["inventory/", 1],
	["ui/", 2],
	["inventory-hud.tsx", 3, "hud", "replicated"],
	["item-slot.tsx", 3, "slot", "replicated"],
	["inventory-controller@client.ts", 2, "ctrl", "client"],
	["inventory-input@client.ts", 2, "input", "client"],
	["inventory-service@server.ts", 2, "svc", "server"],
	["inventory-store@server.ts", 2, "store", "server"],
	["inventory-types.ts", 2, "types", "replicated"],
	["item-catalog.ts", 2, "cat", "replicated"],
	["item-icons.ts", 2, "icons", "replicated"],
];

const luauStudio: StudioRow[] = [
	["", "ReplicatedStorage", 0, "service", "replicated"],
	["", "Shared", 1, "folder", "replicated"],
	["", "Inventory", 2, "folder", "replicated"],
	["types", "InventoryTypes", 3, "script", "replicated"],
	["cat", "ItemCatalog", 3, "script", "replicated"],
	["icons", "ItemIcons", 3, "model", "replicated"],
	["", "UI", 3, "folder", "replicated"],
	["hud", "InventoryHud", 4, "script", "replicated"],
	["slot", "ItemSlot", 4, "script", "replicated"],
	["", "ServerScriptService", 0, "service", "server"],
	["", "Inventory", 1, "folder", "server"],
	["svc", "InventoryService", 2, "script", "server"],
	["store", "InventoryStore", 2, "script", "server"],
	["", "StarterPlayer", 0, "service", "client"],
	["", "StarterPlayerScripts", 1, "service", "client"],
	["", "Inventory", 2, "folder", "client"],
	["ctrl", "InventoryController", 3, "script", "client"],
	["input", "InventoryInput", 3, "script", "client"],
];

const tsStudio: StudioRow[] = [
	["", "ReplicatedStorage", 0, "service", "replicated"],
	["", "shared", 1, "folder", "replicated"],
	["", "inventory", 2, "folder", "replicated"],
	["types", "inventory-types", 3, "script", "replicated"],
	["cat", "item-catalog", 3, "script", "replicated"],
	["icons", "item-icons", 3, "script", "replicated"],
	["", "ui", 3, "folder", "replicated"],
	["hud", "inventory-hud", 4, "script", "replicated"],
	["slot", "item-slot", 4, "script", "replicated"],
	["", "ServerScriptService", 0, "service", "server"],
	["", "inventory", 1, "folder", "server"],
	["svc", "inventory-service", 2, "script", "server"],
	["store", "inventory-store", 2, "script", "server"],
	["", "StarterPlayer", 0, "service", "client"],
	["", "StarterPlayerScripts", 1, "service", "client"],
	["", "inventory", 2, "folder", "client"],
	["ctrl", "inventory-controller", 3, "script", "client"],
	["input", "inventory-input", 3, "script", "client"],
];

export const disk: Record<Lang, DiskRow[]> = { luau: luauDisk, ts: tsDisk };
export const studio: Record<Lang, StudioRow[]> = {
	luau: luauStudio,
	ts: tsStudio,
};

export function L({ luau, ts }: { luau: ReactNode; ts: ReactNode }) {
	return (
		<>
			<span data-only="luau">{luau}</span>
			<span data-only="ts">{ts}</span>
		</>
	);
}

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

export function studioClass(icon: Icon, name: string): string {
	if (icon === "service") return name;
	if (icon === "folder") return "Folder";
	return icon === "model" ? "Model" : "ModuleScript";
}
