import { HeroWorld } from "./hero-world";
import { InstallCommand } from "./install-command";

export function Hero() {
	return (
		<section className="hero">
			<div className="wrap">
				<div className="hero-copy">
					<span className="eyebrow in-1">
						Rojo with file-system routing
					</span>
					<h1 className="in-2">
						<span>Professional-grade</span> architecture for Roblox
					</h1>
					<p className="lede in-3">
						Rogen is a superset of Rojo that generates Rojo project
						files from your folders. You organize your game by
						feature, and Rogen puts each file in the right place.
					</p>
					<InstallCommand className="in-4" />
					<p className="langs in-5">
						<b>Luau</b> · <b>roblox-ts</b>
					</p>
				</div>
			</div>
			<HeroWorld />
		</section>
	);
}
