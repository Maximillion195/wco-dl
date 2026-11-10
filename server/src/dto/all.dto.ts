import { ApiProperty } from '@nestjs/swagger';

// -i, --input
// - se, --season  Selects the season to download of a show(Default = All)
// - epr, --episoderange Selects the range of episodes to download(Default = All)[Ex : --range 1 - 10(This will download first 10 episodes of ALL Seasons!)]
// -n, --newest

export class CreateShow {
  @ApiProperty({ required: true })
  name: string;

  @ApiProperty({ required: false })
  season: string;

  @ApiProperty({ required: false })
  episode: string;

  @ApiProperty({ required: false, default: false, example: false })
  newest: boolean = false;

  @ApiProperty({ required: false, default: '720', example: '720' })
  quality?: string;

  @ApiProperty({ required: false, default: undefined, example: 'sub' })
  language?: string;
}

export class BatchDownload {
  @ApiProperty({ required: true, type: [String] })
  names: string[];

  @ApiProperty({ required: false })
  season?: string;

  @ApiProperty({ required: false })
  episode?: string;

  @ApiProperty({ required: false, default: false })
  newest?: boolean;

  @ApiProperty({ required: false })
  quality?: string;

  @ApiProperty({ required: false })
  language?: string;
}

export class ProcessShow {
  @ApiProperty({ required: true })
  name: string;
}

export class SingleEpisodeReq {
  @ApiProperty({ required: true })
  name: string;
}

export class WebhookReq {
  @ApiProperty({ required: true, example: 'http://example.com/hook' })
  url: string;
}
