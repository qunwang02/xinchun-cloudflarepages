const { MongoClient } = require('mongodb');

// MongoDB配置
const MONGODB_URI = 'mongodb+srv://nanmo009:Wwx731217@cluster-fosheng.r3b5crc.mongodb.net/?appName=cluster-fosheng';
const DATABASE_NAME = 'donation_system';
const COLLECTION_NAME = 'donations';

// 示例数据
const SAMPLE_DATA = [
  {
    name: "王大明",
    project: "供灯祈福(总功德主)",
    method: "1.供灯祈福共修 (七天)\n2.附 福慧灯 三盏\n3.附 常年光明灯 三盏",
    amountTWD: 300000,
    amountRMB: 71428.57,
    content: "祈求合家平安，事业顺利",
    payment: "已缴费",
    contact: "0912345678",
    deviceId: "device_001",
    localId: "local_001",
    submittedAt: new Date('2024-01-15'),
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "李小花",
    project: "供灯祈福(个人福慧功德主)",
    method: "1.供灯祈福共修 (七天)\n2.附 常年光明灯 一盏",
    amountTWD: 6000,
    amountRMB: 1428.57,
    content: "祈求身体健康",
    payment: "未缴费",
    contact: "0923456789",
    deviceId: "device_002",
    localId: "local_002",
    submittedAt: new Date('2024-01-14'),
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "陈建国",
    project: "常年光明灯（阖家光明灯功德主）",
    method: "佛龕供灯一年",
    amountTWD: 1000,
    amountRMB: 238.10,
    content: "阖家平安",
    payment: "已缴费",
    contact: "0934567890",
    deviceId: "device_003",
    localId: "local_003",
    submittedAt: new Date('2024-01-13'),
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "林美惠",
    project: "新春祈福单(随喜功德主)",
    method: "祈福共修 (三天)",
    amountTWD: 0,
    amountRMB: 0,
    content: "随喜功德",
    payment: "随喜",
    contact: "0945678901",
    deviceId: "device_004",
    localId: "local_004",
    submittedAt: new Date('2024-01-12'),
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

async function initDatabase() {
  console.log('=== 开始初始化捐赠系统数据库 ===\n');
  
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  
  try {
    console.log('1. 连接到 MongoDB...');
    await client.connect();
    console.log('✓ 连接成功\n');
    
    const db = client.db(DATABASE_NAME);
    
    console.log('2. 检查数据库...');
    const databaseList = await client.db().admin().listDatabases();
    const databaseExists = databaseList.databases.some(db => db.name === DATABASE_NAME);
    
    if (!databaseExists) {
      console.log(`创建数据库: ${DATABASE_NAME}`);
    } else {
      console.log(`数据库 ${DATABASE_NAME} 已存在`);
    }
    console.log();
    
    console.log('3. 检查集合...');
    const collections = await db.listCollections().toArray();
    const collectionExists = collections.some(col => col.name === COLLECTION_NAME);
    
    if (!collectionExists) {
      console.log(`创建集合: ${COLLECTION_NAME}`);
      await db.createCollection(COLLECTION_NAME);
      console.log('✓ 集合创建成功\n');
    } else {
      console.log(`集合 ${COLLECTION_NAME} 已存在\n`);
    }
    
    const collection = db.collection(COLLECTION_NAME);
    
    console.log('4. 创建索引...');
    await createIndexes(collection);
    console.log('✓ 索引创建完成\n');
    
    console.log('5. 检查现有数据...');
    const count = await collection.countDocuments();
    console.log(`当前数据量: ${count} 条记录\n`);
    
    if (count === 0) {
      console.log('6. 插入示例数据...');
      const result = await collection.insertMany(SAMPLE_DATA);
      console.log(`✓ 插入 ${result.insertedCount} 条示例数据\n`);
      
      console.log('示例数据预览:');
      const sampleRecords = await collection.find().limit(2).toArray();
      sampleRecords.forEach((record, index) => {
        console.log(`  ${index + 1}. ${record.name} - ${record.project} (${record.payment})`);
      });
      console.log();
    } else {
      console.log('6. 跳过示例数据插入（已有数据）\n');
    }
    
    console.log('7. 生成统计报告...');
    const stats = await generateStats(collection);
    console.log('  总记录数:', stats.totalRecords);
    console.log('  总金额(新台币):', stats.totalAmountTWD.toLocaleString());
    console.log('  总金额(人民币):', stats.totalAmountRMB.toFixed(2));
    console.log('  项目种类:', stats.projects.length);
    console.log('  缴费状态:', stats.payments.map(p => `${p._id}: ${p.count}`).join(', '));
    console.log();
    
    console.log('=== 数据库初始化完成 ===\n');
    console.log('数据库信息:');
    console.log(`  URI: ${MONGODB_URI}`);
    console.log(`  数据库: ${DATABASE_NAME}`);
    console.log(`  集合: ${COLLECTION_NAME}`);
    console.log(`  总记录: ${stats.totalRecords}`);
    console.log();
    console.log('API端点:');
    console.log('  GET  /api/test          # 测试连接');
    console.log('  GET  /api/donations     # 获取捐赠数据');
    console.log('  POST /api/donations     # 新增捐赠数据');
    console.log('  GET  /api/stats         # 获取统计数据');
    console.log('  GET  /api/export/csv    # 导出CSV');
    
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function createIndexes(collection) {
  const indexes = [
    { key: { submittedAt: -1 }, name: 'submittedAt_desc' },
    { key: { name: 1 }, name: 'name_asc' },
    { key: { project: 1 }, name: 'project_asc' },
    { key: { payment: 1 }, name: 'payment_asc' },
    { key: { localId: 1 }, name: 'localId_unique', unique: true, sparse: true },
    { key: { deviceId: 1 }, name: 'deviceId_index' },
    { key: { batchId: 1 }, name: 'batchId_index' },
    { key: { contact: 1 }, name: 'contact_index' },
    { key: { amountTWD: -1 }, name: 'amountTWD_desc' },
  ];
  
  for (const index of indexes) {
    try {
      await collection.createIndex(index.key, {
        name: index.name,
        unique: index.unique || false,
        sparse: index.sparse || false,
      });
    } catch (error) {
      console.warn(`  警告: 创建索引 ${index.name} 失败:`, error.message);
    }
  }
}

async function generateStats(collection) {
  const [totalStats, projects, payments] = await Promise.all([
    collection.aggregate([
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalAmountTWD: { $sum: "$amountTWD" },
          totalAmountRMB: { $sum: "$amountRMB" }
        }
      }
    ]).toArray(),
    
    collection.distinct('project'),
    
    collection.aggregate([
      {
        $group: {
          _id: "$payment",
          count: { $sum: 1 }
        }
      }
    ]).toArray()
  ]);
  
  return {
    totalRecords: totalStats[0]?.totalRecords || 0,
    totalAmountTWD: totalStats[0]?.totalAmountTWD || 0,
    totalAmountRMB: totalStats[0]?.totalAmountRMB || 0,
    projects: projects || [],
    payments: payments || []
  };
}

// 运行初始化
if (require.main === module) {
  initDatabase().catch(console.error);
}

module.exports = { initDatabase };
