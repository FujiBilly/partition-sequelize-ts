
import { IDefineOptions } from './node_modules/sequelize-typescript/lib/interfaces/IDefineOptions';

interface IPartitionDefineOptions extends IDefineOptions {
  partition?: 'RANGE' | 'LIST';
  partitionKey?: string;
  partitionRule?: {
    [suffix: string]: number[] | string[],
    [suffix: number]: number[] | string[]
  };
}

export * from './node_modules/sequelize-typescript';
export declare function Table(options: IPartitionDefineOptions): Function;
