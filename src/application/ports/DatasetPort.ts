import { FanbaseModel, HmlDataset } from '../../domain/entities/JourneyModels.ts';

export interface DatasetPort {
  getHmlDataset(): HmlDataset;
  getFanbaseModel(): FanbaseModel;
}
