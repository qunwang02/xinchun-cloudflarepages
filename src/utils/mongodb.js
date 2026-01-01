import { MongoClient } from 'mongodb';

// 连接缓存
let cachedClient = null;
let cachedDb = null;

/**
 * 获取MongoDB客户端连接
 */
export async function getMongoClient(env) {
  if (cachedClient && cachedClient.topology?.isConnected()) {
    return cachedClient;
  }

  try {
    const MONGODB_URI = env.MONGODB_URI;
    
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is required');
    }

    const client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 1,
      maxIdleTimeMS: 30000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000,
      retryWrites: true,
      w: 'majority',
    });

    await client.connect();
    console.log('MongoDB connected successfully');
    
    // 测试连接
    await client.db().admin().ping();
    
    cachedClient = client;
    
    // Cloudflare Workers 不支持长时间运行的定时器，移除健康检查
    // 连接状态将在每次请求时检查

    return client;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    cachedClient = null;
    throw error;
  }
}

/**
 * 获取数据库实例
 */
export async function getDatabase(env) {
  try {
    const client = await getMongoClient(env);
    const dbName = env.DATABASE_NAME || 'donation_system';
    
    if (!cachedDb) {
      cachedDb = client.db(dbName);
    }
    
    return cachedDb;
  } catch (error) {
    console.error('Failed to get database:', error);
    throw error;
  }
}

/**
 * 获取捐赠集合
 */
export async function getDonationCollection(env) {
  try {
    const db = await getDatabase(env);
    const collectionName = env.COLLECTION_NAME || 'donations';
    
    // 确保集合存在
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (collections.length === 0) {
      console.log(`Creating collection: ${collectionName}`);
      await db.createCollection(collectionName);
      
      // 创建索引
      const collection = db.collection(collectionName);
      await createIndexes(collection);
    }
    
    return db.collection(collectionName);
  } catch (error) {
    console.error('Failed to get collection:', error);
    throw error;
  }
}

/**
 * 创建集合索引
 */
async function createIndexes(collection) {
  try {
    await collection.createIndex({ submittedAt: -1 });
    await collection.createIndex({ name: 1 });
    await collection.createIndex({ project: 1 });
    await collection.createIndex({ payment: 1 });
    await collection.createIndex({ localId: 1 }, { unique: true, sparse: true });
    await collection.createIndex({ deviceId: 1 });
    await collection.createIndex({ batchId: 1 });
    
    // 文本搜索索引
    await collection.createIndex(
      { name: 'text', project: 'text', content: 'text', contact: 'text' },
      { weights: { name: 10, project: 5, content: 3, contact: 2 } }
    );
    
    console.log('Collection indexes created successfully');
  } catch (error) {
    console.warn('Failed to create indexes:', error.message);
  }
}

/**
 * 验证ObjectId格式
 */
export function isValidObjectId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * 安全地关闭连接
 */
export async function closeMongoConnection() {
  if (cachedClient) {
    try {
      await cachedClient.close();
      console.log('MongoDB connection closed');
    } catch (error) {
      console.error('Error closing MongoDB connection:', error);
    } finally {
      cachedClient = null;
      cachedDb = null;
    }
  }
}

/**
 * 健康检查
 */
export async function checkMongoHealth(env) {
  try {
    const client = await getMongoClient(env);
    await client.db().admin().ping();
    return { ok: true, message: 'MongoDB is connected' };
  } catch (error) {
    return { ok: false, message: `MongoDB connection failed: ${error.message}` };
  }
}
