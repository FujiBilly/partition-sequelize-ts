# partition-sequelize-ts
改进 `sequelize-typescript` 库使其支持 `Postgresql` 10/11版本的分区表

使用示例：
 ```typescript
 import {
   Model,
   Table,
   Column,
   PrimaryKey,
   Comment,
   DataType,
   AllowNull,
   Default
 } from 'partition-sequelize-ts';
 
 @Table({
   tableName: 'partition_model',
   partition: 'RANGE',
   partitionKey: 'id',
   partitionRule: {
     0: [1, 10000000],
     1: [10000001, 20000000]
   }
 })
 export default class PartitionModel extends Model<PartitionModel> {
 
   @Comment('id')
   @PrimaryKey
   @Column(DataType.INTEGER)
   id: number;
 
   @Comment('企业id')
   @AllowNull(false)
   @Default('')
   @Column(DataType.TEXT)
   options: string;
 }
```
