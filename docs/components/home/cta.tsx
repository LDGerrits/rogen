import { InstallCommand } from "./install-command";
import { MoreLink } from "./more-link";

export function Cta() {
	return (
		<section className="sec start" aria-labelledby="st-h">
			<div className="wrap">
				<div className="cols">
					<InstallCommand className="rv" />
					<div className="st">
						<h2 id="st-h" className="rv">
							Get started
						</h2>
						<MoreLink href="/docs/v2/installation" dl={80}>
							Read the setup guide
						</MoreLink>
					</div>
				</div>
			</div>
		</section>
	);
}
