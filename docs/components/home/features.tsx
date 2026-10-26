import type { CSSProperties } from "react";
import { L, Name } from "./inventory";
import { delay, MoreLink } from "./more-link";

type Dot = "o" | "s" | "c" | "r";

// [Luau name, roblox-ts name, depth, marker, class]
const tree: [string, string, number, Dot, string?][] = [
	["Combat/", "combat/", 1, "o"],
	["Inventory/", "inventory/", 1, "o", "on"],
	["UI/", "ui/", 2, "r", "f"],
	["InventoryHud.luau", "inventory-hud.tsx", 3, "r", "f"],
	["ItemSlot.luau", "item-slot.tsx", 3, "r", "f"],
	[
		"InventoryController@Client.luau",
		"inventory-controller@client.ts",
		2,
		"c",
		"f",
	],
	[
		"InventoryService@Server.luau",
		"inventory-service@server.ts",
		2,
		"s",
		"f",
	],
	["InventoryTypes.luau", "inventory-types.ts", 2, "r", "f"],
	["ItemIcons.rbxm", "item-icons.ts", 2, "r", "f"],
	["Shop/", "shop/", 1, "o"],
];

const commands = [
	"rogen serve",
	"rogen build -o game.rbxl",
	"rogen sourcemap -o sourcemap.json",
	"rogen syncback --input game.rbxl",
];

const depth = (d: number) => ({ "--d": d }) as CSSProperties;

const requires: [from: string, to: string, ok: boolean, note: string][] = [
	["Inventory", "Inventory", true, "same feature"],
	["Combat", "Inventory", false, "lint error"],
];
const folder = (name: string) => (
	<L luau={`${name}/`} ts={`${name.toLowerCase()}/`} />
);

function Boundaries() {
	return (
		<div className="plate rv" style={delay(240)}>
			<div className="pane-h">
				<b>require</b>
				<span>between features</span>
			</div>
			<ul className="reqs">
				{requires.map(([from, to, ok, note]) => (
					<li
						key={from}
						className={ok ? "ok" : "no"}
						aria-label={`${from} requires ${to}: ${note}`}
					>
						<code>{folder(from)}</code>
						<i aria-hidden="true">{ok ? "→" : "✕"}</i>
						<code>{folder(to)}</code>
						<em>{note}</em>
					</li>
				))}
			</ul>
		</div>
	);
}

function Places() {
	return (
		<div className="plate rv" style={delay(320)}>
			<div className="pane-h">
				<b>places/</b>
				<span>shared code, one override</span>
			</div>
			<div className="places">
				<div className="pl shared">
					<b>shared/</b>
					<span>
						<L luau="InventoryTypes.luau" ts="inventory-types.ts" />
					</span>
					<span>
						<L luau="ItemCatalog.luau" ts="item-catalog.ts" />
					</span>
				</div>
				<div className="pl">
					<b>lobby/</b>
					<span className="dim">uses the shared files</span>
				</div>
				<div className="pl">
					<b>arena/</b>
					<span className="ov">
						<L luau="ItemCatalog.luau" ts="item-catalog.ts" />
					</span>
					<em>replaces the shared one</em>
				</div>
			</div>
		</div>
	);
}

export function Features() {
	return (
		<section className="sec why" aria-labelledby="why-h">
			<div className="wrap">
				<div className="cols">
					<div className="head-r">
						<h2 id="why-h" className="rv">
							One folder per feature from server to client
						</h2>
					</div>
				</div>

				<div className="cols r1">
					<div className="rtxt">
						<span className="n rv">01</span>
						<h3 className="rv" style={delay(60)}>
							Organize by feature
						</h3>
						<p className="rv" style={delay(120)}>
							Keep everything a feature needs in one folder, from
							its server code to its UI and assets. You find it
							all in one place, and you remove a feature by
							deleting its folder.
						</p>
						<MoreLink href="/docs/v2/architectures" dl={180}>
							See suggested architectures
						</MoreLink>
					</div>
					<div className="fpanel rv" style={delay(120)}>
						<div
							className="tree"
							aria-label="Example feature folder"
						>
							<div className="hd">src/</div>
							{tree.map(([luau, ts, d, dot, cls]) => (
								<div
									key={luau}
									className={cls}
									style={depth(d)}
								>
									<i className={`dia ${dot}`} />
									<L
										luau={
											<Name
												name={luau}
												colour={
													dot === "o"
														? undefined
														: dot
												}
											/>
										}
										ts={
											<Name
												name={ts}
												colour={
													dot === "o"
														? undefined
														: dot
												}
											/>
										}
									/>
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="split hl" data-line="">
					<div className="rtxt">
						<span className="n rv">02</span>
						<h3 className="rv" style={delay(60)}>
							Enforce boundaries
						</h3>
						<p className="rv" style={delay(120)}>
							Every require path includes the name of its feature,
							so a lint rule can stop one feature from reaching
							into another.
						</p>
						<MoreLink
							href="/docs/v2/architectures#enforcing-the-rules"
							dl={180}
						>
							See the lint rule
						</MoreLink>
						<Boundaries />
					</div>
					<div className="rtxt">
						<span className="n rv" style={delay(80)}>
							03
						</span>
						<h3 className="rv" style={delay(140)}>
							Multi-place games
						</h3>
						<p className="rv" style={delay(200)}>
							Write shared code once and use it in every place.
							When one place needs its own version of a file, put
							a file with the same name in that place&apos;s
							folder, and it replaces the shared one.
						</p>
						<MoreLink href="/docs/v2/setups/places" dl={260}>
							Set up places
						</MoreLink>
						<Places />
					</div>
				</div>

				<div className="cols r4 hl" data-line="">
					<div className="rtxt">
						<span className="n rv">04</span>
						<h3 className="rv" style={delay(60)}>
							Still Rojo
						</h3>
						<p className="rv" style={delay(120)}>
							Run <code>rogen serve</code> where you ran{" "}
							<code>rojo serve</code>, with the same flags. Rojo
							still does the syncing and building underneath.
						</p>
						<MoreLink href="/docs/v2/coming-from-rojo" dl={180}>
							Coming from Rojo
						</MoreLink>
					</div>
					<ul
						className="cmds"
						aria-label="Rogen commands"
						data-cmds=""
					>
						{commands.map((command, i) => (
							<li key={command} style={delay(i * 100)}>
								<i>$</i>
								<span>{command}</span>
							</li>
						))}
					</ul>
				</div>
			</div>
		</section>
	);
}
