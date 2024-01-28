import { ApiProperty } from "@nestjs/swagger";

// -i, --input
// - se, --season  Selects the season to download of a show(Default = All)
// - epr, --episoderange Selects the range of episodes to download(Default = All)[Ex : --range 1 - 10(This will download first 10 episodes of ALL Seasons!)]
// -n, --newest   


export class CreateShow {
	@ApiProperty()
	name: string;

	@ApiProperty({ required: false })
	season: string;

	@ApiProperty({ required: false })
	episode: string;

	@ApiProperty({ required: false, default: true, example: "false" })
	newest: boolean = false;
}
