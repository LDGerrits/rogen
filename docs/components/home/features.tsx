import type { CSSProperties } from "react";
import { delay, MoreLink } from "./more-link";

type Dot = "o" | "s" | "c" | "r";

const tree: {
	depth: number;
	dot: Dot;
	name: string;
	route?: string;
	ext?: string;
	cls?: string;
}[] = [
	{ depth: 1, dot: "o", name: "Combat/" },
	{ depth: 1, dot: "o", name: "Inventory/", cls: "on" },
	{ depth: 2, dot: "r", name: "UI/", cls: "f" },
	{ depth: 3, dot: "r", name: "InventoryHud.luau", cls: "f" },
	{ depth: 3, dot: "r", name: "ItemSlot.luau", cls: "f" },
	{
		depth: 2,
		dot: "c",
		name: "InventoryController",
		route: "@Client",
		ext: ".luau",
		cls: "f",
	},
	{
		depth: 2,
		dot: "s",
		name: "InventoryService",
		route: "@Server",
		ext: ".luau",
		cls: "f",
	},
	{ depth: 2, dot: "r", name: "InventoryTypes.luau", cls: "f" },
	{ depth: 2, dot: "r", name: "ItemIcons.rbxm", cls: "f" },
	{ depth: 1, dot: "o", name: "Shop/" },
];

const commands = [
	"rogen serve",
	"rogen build -o game.rbxl",
	"rogen sourcemap -o sourcemap.json",
	"rogen syncback --input game.rbxl",
];

const depth = (d: number) => ({ "--d": d }) as CSSProperties;

const requires: [from: string, to: string, ok: boolean, note: string][] = [
	["Inventory/", "Inventory/", true, "same feature"],
	["Combat/", "Inventory/", false, "lint error"],
];

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
						<code>{from}</code>
						<i aria-hidden="true">{ok ? "→" : "✕"}</i>
						<code>{to}</code>
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
					<span>InventoryTypes.luau</span>
					<span>ItemCatalog.luau</span>
				</div>
				<div className="pl">
					<b>lobby/</b>
					<span className="dim">uses the shared files</span>
				</div>
				<div className="pl">
					<b>arena/</b>
					<span className="ov">ItemCatalog.luau</span>
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
							{tree.map((row) => (
								<div
									key={row.name}
									className={row.cls}
									style={depth(row.depth)}
								>
									<i className={`dia ${row.dot}`} />
									{row.route ? (
										<span>
											{row.name}
											<span className={`c-${row.dot}`}>
												{row.route}
											</span>
											{row.ext}
										</span>
									) : (
										row.name
									)}
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
