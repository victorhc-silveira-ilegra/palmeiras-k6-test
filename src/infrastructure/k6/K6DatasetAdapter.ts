import { DatasetPort } from '../../application/ports/DatasetPort.ts';
import { FanbaseModel, HmlDataset } from '../../domain/entities/JourneyModels.ts';

export class K6DatasetAdapter implements DatasetPort {
  private readonly loadHmlDataset: () => HmlDataset;
  private readonly loadFanbaseModel: () => FanbaseModel;

  public constructor(
    loadHmlDataset: () => HmlDataset,
    loadFanbaseModel: () => FanbaseModel
  ) {
    this.loadHmlDataset = loadHmlDataset;
    this.loadFanbaseModel = loadFanbaseModel;
  }

  public getHmlDataset(): HmlDataset {
    return this.loadHmlDataset();
  }

  public getFanbaseModel(): FanbaseModel {
    return this.loadFanbaseModel();
  }
}
