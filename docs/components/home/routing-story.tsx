"use client";

import { useEffect, useRef } from "react";
import { useLang, type Lang } from "./lang";
import { mountStory } from "./story";

const SUMMARY: Record<Lang, string> = {
	luau: "The name InventoryService@Server.luau is read from src/Inventory, matched to the Server route in default.rogen.json, and written into default.project.json as InventoryService inside an Inventory folder. Rojo syncs it into Roblox Studio as ServerScriptService/Inventory/InventoryService, with an Inventory folder under each of the three services.",
	ts: "The name inventory-service@server.ts is read from src/inventory, matched to the server route in default.rogen.json, and written into default.project.json as inventory-service inside an inventory folder, pointing at the compiled out/inventory/inventory-service@server.luau. Rojo syncs it into Roblox Studio as ServerScriptService/inventory/inventory-service, with an inventory folder under each of the three services.",
};

/** The scroll story that follows one file from disk to the Studio Explorer. */
export function RoutingStory() {
	const ref = useRef<HTMLDivElement>(null);
	const lang = useLang();

	useEffect(() => {
		if (ref.current) return mountStory(ref.current, lang);
	}, [lang]);

	return (
		<div ref={ref} className="story">
			<div className="pin">
				<div className="wrap cols pin-in">
					<div className="cap">
						<div className="odo" data-odo="" aria-hidden="true" />
						<ol
							className="steps"
							aria-label="Steps"
							data-steps=""
						/>
						<div className="bodies" data-bodies="" />
					</div>
					<div
						className="field"
						data-field=""
						role="img"
						aria-label={SUMMARY[lang]}
					/>
				</div>
			</div>
			<p className="wrap story-sr">{SUMMARY[lang]}</p>
			<ol className="wrap slides" data-slides="" />
		</div>
	);
}
