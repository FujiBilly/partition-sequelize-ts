const Sequelize = require('sequelize-typescript');
const { Model, DataType } = Sequelize;
const Promise = require('bluebird');
const _ = require('lodash');

class PartitionModel extends Model {

  constructor(values, options) {
    super(values, options);
  }

  static sync(options) {
    if (!this.options.partition) {
      return super.sync(options);
    }
    options = _.extend({}, this.options, options);
    options.hooks = options.hooks === undefined ? true : !!options.hooks;
    const attributes = this.tableAttributes;
    let prititionColumn;
    return Promise.try(() => {
      if (options.hooks) {
        // @ts-ignore
        return this.runHooks('beforeSync', options);
      }
    })
      .then(() => {
        if (options.force) {
          return this.drop(options);
        }
      })
      .then(() => {
        // pgsql版本10的分区主表不能有主键
        const primaryKey = [];
        for (const name in attributes) {
          const attr = attributes[name];
          if (attr.primaryKey) {
            primaryKey.push(name);
            attr.allowNull = false;
            delete attr.primaryKey;
          }
          if (name === this.options.partitionKey) {
            prititionColumn = attributes[name];
          }
        }
        // 分区子表使用unique索引代替主键
        if (!this.options.indexes) {
          this.options.indexes = [];
        }
        this.options.indexes.push({
          fields: primaryKey,
          unique: true,
        });
        // 生成创建分区主表的SQL
        const attrs = this.QueryInterface.QueryGenerator.attributesToSQL(attributes, {
          context: 'createTable',
        });
        let createTableSql = this.QueryInterface.QueryGenerator.createTableQuery(this.getTableName(options), attrs, options);
        createTableSql = createTableSql.substring(0, createTableSql.length - 1) + ` PARTITION BY ${options.partition} ("${options.partitionKey}");`;
        return this.sequelize.query(createTableSql, options);
      })
      .then(() => {
        // 同步分区子表
        const pmList = [];
        for (const suffix in options.partitionRule) {
          let rule = options.partitionRule[suffix];
          if (prititionColumn.type instanceof DataType.STRING || prititionColumn.type instanceof DataType.TEXT || prititionColumn.type instanceof DataType.CHAR) {
            rule = rule.map(val => `'${val}'`);
          }
          let sql = `CREATE TABLE IF NOT EXISTS "${this.tableName + suffix}" PARTITION OF "${this.tableName}" FOR VALUES`;
          if (options.partition.toUpperCase() === 'LIST') {
            sql += ` IN (${rule.join(',')});`;
          } else if (options.partition.toUpperCase() === 'RANGE') {
            sql += ` FROM (${rule[0]}) TO (${rule[1]});`;
          }
          pmList.push(this.sequelize.query(sql, options));
        }
        return Promise.all(pmList);
      })
      .then(() => {
        // 同步分区主表字段结构
        if (options.alter) {
          return Promise.all([
            this.QueryInterface.describeTable(this.getTableName(options)),
            this.QueryInterface.getForeignKeyReferencesForTable(this.getTableName(options)),
          ])
            .then(tableInfos => {
              const columns = tableInfos[0];
              // Use for alter foreign keys
              const foreignKeyReferences = tableInfos[1];
              const changes = []; // array of promises to run
              const removedConstraints = {};
              _.each(attributes, (_columnDesc, columnName) => {
                if (!columns[columnName]) {
                  changes.push(() => this.QueryInterface.addColumn(this.getTableName(options), columnName, attributes[columnName]));
                }
              });
              _.each(columns, (_columnDesc, columnName) => {
                const currentAttributes = attributes[columnName];
                if (!currentAttributes) {
                  changes.push(() => this.QueryInterface.removeColumn(this.getTableName(options), columnName, options));
                } else if (!currentAttributes.primaryKey) {
                  // Check foreign keys. If it's a foreign key, it should remove constraint first.
                  const references = currentAttributes.references;
                  if (currentAttributes.references) {
                    const database = this.sequelize.config.database;
                    const schema = this.sequelize.config.schema;
                    _.each(foreignKeyReferences, foreignKeyReference => {
                      const constraintName = foreignKeyReference.constraintName;
                      if (!!constraintName
                        && foreignKeyReference.tableCatalog === database
                        && (schema ? foreignKeyReference.tableSchema === schema : true)
                        && foreignKeyReference.referencedTableName === references.model
                        && foreignKeyReference.referencedColumnName === references.key
                        && (schema ? foreignKeyReference.referencedTableSchema === schema : true)
                        && !removedConstraints[constraintName]) {
                        changes.push(() => this.QueryInterface.removeConstraint(this.getTableName(options), constraintName, options));
                        removedConstraints[constraintName] = true;
                      }
                    });
                  }
                  if (columnName !== options.partitionKey) {
                    changes.push(() => this.QueryInterface.changeColumn(this.getTableName(options), columnName, attributes[columnName]));
                  }
                }
              });
              return changes.reduce((p, fn) => p.then(fn), Promise.resolve());
            });
        }
      })
      .then(() => {
        // 同步每个分区子表的索引结构
        const tableNameList = [];
        let indexOptions = this.options.indexes;
        for (const suffix in options.partitionRule) {
          tableNameList.push(`${this.getTableName(options) + suffix}`);
        }
        return Promise.map(tableNameList, tableName => this.QueryInterface.showIndex(tableName, options))
          .then(indexesList => {
            const createIdxPrmList = [];
            for (let i = 0 ; i < indexesList.length; i++) {
              let indexes = indexesList[i];
              const tableName = tableNameList[i];
              for (const index of indexOptions) {
                delete index.name;
              }
              indexOptions = this.QueryInterface.nameIndexes(indexOptions, tableName);
              indexes = _.filter(indexOptions, item1 =>
                !_.some(indexes, item2 => item1.name === item2.name),
              ).sort((index1, index2) => {
                if (this.sequelize.options.dialect === 'postgres') {
                  // move concurrent indexes to the bottom to avoid weird deadlocks
                  if (index1.concurrently === true) return 1;
                  if (index2.concurrently === true) return -1;
                }
                return 0;
              });
              for (const index of indexes) {
                createIdxPrmList.push(this.QueryInterface.addIndex(
                  tableName,
                  _.assign({
                    logging: options.logging,
                    benchmark: options.benchmark,
                    transaction: options.transaction,
                  }, index),
                  tableName,
                ));
              }
            }
            return Promise.all(createIdxPrmList);
          });
      })
      .then(() => {
        if (options.hooks) {
          // @ts-ignore
          return this.runHooks('afterSync', options);
        }
      }).return(this);
  }

}

Sequelize.Model = PartitionModel;
module.exports = Sequelize;
