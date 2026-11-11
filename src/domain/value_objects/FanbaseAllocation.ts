import { DomainInvariantError } from '../errors/DomainError.ts';

export interface FanbaseAllocationProps {
  minSupporters: number;
  maxSupporters: number;
  avgSupporters: number;
  scaleFactor: number;
  newsReaders: number;
  matchdayLive: number;
  searchers: number;
  catalogMedia: number;
  mobileApp: number;
  protocolMatrix: number;
  totalPeakVUs: number;
  supportersPerPeakVu: number;
}

const MIN_SUPPORTERS = 14_000_000;
const MAX_SUPPORTERS = 17_500_000;
const AVG_SUPPORTERS = 15_750_000;

function scaleVus(base: number, factor: number): number {
  return Math.max(1, Math.round(base * factor));
}

export class FanbaseAllocation {
  public readonly minSupporters: number;
  public readonly maxSupporters: number;
  public readonly avgSupporters: number;
  public readonly scaleFactor: number;
  public readonly newsReaders: number;
  public readonly matchdayLive: number;
  public readonly searchers: number;
  public readonly catalogMedia: number;
  public readonly mobileApp: number;
  public readonly protocolMatrix: number;
  public readonly totalPeakVUs: number;
  public readonly supportersPerPeakVu: number;

  private constructor(props: FanbaseAllocationProps) {
    this.minSupporters = props.minSupporters;
    this.maxSupporters = props.maxSupporters;
    this.avgSupporters = props.avgSupporters;
    this.scaleFactor = props.scaleFactor;
    this.newsReaders = props.newsReaders;
    this.matchdayLive = props.matchdayLive;
    this.searchers = props.searchers;
    this.catalogMedia = props.catalogMedia;
    this.mobileApp = props.mobileApp;
    this.protocolMatrix = props.protocolMatrix;
    this.totalPeakVUs = props.totalPeakVUs;
    this.supportersPerPeakVu = props.supportersPerPeakVu;
  }

  public static fromScaleFactor(scaleFactor: number): FanbaseAllocation {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      throw new DomainInvariantError('SCALE_FACTOR deve ser numero finito maior que zero.');
    }

    const newsReaders = scaleVus(12, scaleFactor);
    const matchdayLive = scaleVus(8, scaleFactor);
    const searchers = scaleVus(5, scaleFactor);
    const catalogMedia = scaleVus(4, scaleFactor);
    const mobileApp = scaleVus(3, scaleFactor);
    const protocolMatrix = scaleVus(3, scaleFactor);
    const totalPeakVUs =
      newsReaders + matchdayLive + searchers + catalogMedia + mobileApp + protocolMatrix;

    return new FanbaseAllocation({
      minSupporters: MIN_SUPPORTERS,
      maxSupporters: MAX_SUPPORTERS,
      avgSupporters: AVG_SUPPORTERS,
      scaleFactor,
      newsReaders,
      matchdayLive,
      searchers,
      catalogMedia,
      mobileApp,
      protocolMatrix,
      totalPeakVUs,
      supportersPerPeakVu: Math.round(AVG_SUPPORTERS / totalPeakVUs),
    });
  }
}
