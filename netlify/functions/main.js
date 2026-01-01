// Netlify Functions 主入口文件
// 用于处理所有 API 请求

// 导入 MongoDB 工具函数
import { getDonationCollection, isValidObjectId, checkMongoHealth } from '../../src/utils/mongodb.js';

// 辅助函数：生成响应
function createResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  return new Response(JSON.stringify(data), {
    status,
    headers: { ...defaultHeaders, ...headers },
  });
}

// 错误响应
function createErrorResponse(error, status = 500) {
  return createResponse({
    success: false,
    error: error.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
  }, status);
}

// 处理预检请求
function handlePreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// 测试API处理器
async function handleTest(request, env) {
  try {
    const url = new URL(request.url);
    const detailed = url.searchParams.get('detailed') === 'true';
    
    // 检查MongoDB连接
    const mongoHealth = await checkMongoHealth(env);
    
    const response = {
      success: mongoHealth.ok,
      message: mongoHealth.ok ? '服务器运行正常' : '服务器连接异常',
      service: 'donation-collection-system',
      timestamp: new Date().toISOString(),
      mongodb: {
        connected: mongoHealth.ok,
        message: mongoHealth.message
      }
    };
    
    return createResponse(response);
  } catch (error) {
    console.error('Test API error:', error);
    return createErrorResponse(error);
  }
}

// 捐赠数据API处理器 - 直接处理HTTP请求，不需要Request对象
async function handleDonationsDirect(httpMethod, body, env, path) {
  const method = httpMethod.toUpperCase();
  
  try {
    switch (method) {
      case 'GET':
        // 创建一个简单的Request对象，只用于处理GET请求的URL
        const url = new URL(`http://${env.HOST || 'localhost'}${path}`);
        const request = new Request(url, {
          method: httpMethod
        });
        return await getDonations(request, env);
      case 'POST':
        return await postDonationsDirect(body, env);
      case 'DELETE':
        // 创建一个简单的Request对象，只用于处理DELETE请求的URL
        const deleteUrl = new URL(`http://${env.HOST || 'localhost'}${path}`);
        const deleteRequest = new Request(deleteUrl, {
          method: httpMethod
        });
        return await deleteDonation(deleteRequest, env, path);
      default:
        return createResponse(
          { success: false, error: 'Method Not Allowed' },
          405
        );
    }
  } catch (error) {
    console.error('Donations API error:', error);
    return createErrorResponse(error);
  }
}

// 捐赠数据API处理器 - 兼容旧的Request对象接口
async function handleDonations(request, env, path) {
  const method = request.method.toUpperCase();
  
  try {
    switch (method) {
      case 'GET':
        return await getDonations(request, env);
      case 'POST':
        return await postDonations(request, env);
      case 'DELETE':
        return await deleteDonation(request, env, path);
      default:
        return createResponse(
          { success: false, error: 'Method Not Allowed' },
          405
        );
    }
  } catch (error) {
    console.error('Donations API error:', error);
    return createErrorResponse(error);
  }
}

// 获取捐赠数据
async function getDonations(request, env) {
  const collection = await getDonationCollection(env);
  const url = new URL(request.url);
  const params = url.searchParams;
  
  // 构建查询条件
  const query = buildQuery(params);
  
  // 分页参数
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '50')));
  const skip = (page - 1) * limit;
  
  // 排序
  const sortField = params.get('sortBy') || 'submittedAt';
  const sortOrder = params.get('sortOrder') === 'asc' ? 1 : -1;
  const sort = { [sortField]: sortOrder };
  
  // 执行查询
  const [data, total] = await Promise.all([
    collection.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(query)
  ]);
  
  // 格式化数据
  const formattedData = data.map(item => ({
    ...item,
    _id: item._id.toString(),
    submittedAt: item.submittedAt?.toISOString(),
    createdAt: item.createdAt?.toISOString(),
    updatedAt: item.updatedAt?.toISOString()
  }));
  
  return createResponse({
    success: true,
    data: formattedData,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  });
}

// 新增捐赠数据 - 直接处理请求体，不需要Request对象
async function postDonationsDirect(bodyString, env) {
  const collection = await getDonationCollection(env);
  let body;
  
  // 解析请求体
  try {
    body = JSON.parse(bodyString);
  } catch (error) {
    return createResponse(
      { success: false, error: 'Invalid JSON format' },
      400
    );
  }
  
  // 验证必需字段
  if (!body.name || !body.name.trim()) {
    return createResponse(
      { success: false, error: '姓名为必填项' },
      400
    );
  }
  
  if (!body.project || !body.project.trim()) {
    return createResponse(
      { success: false, error: '护持项目为必填项' },
      400
    );
  }
  
  // 处理批量数据
  if (body.data && Array.isArray(body.data)) {
    return await handleBatchInsert(body.data, collection);
  }
  
  // 单条数据
  const donationData = createDonationData(body);
  const result = await collection.insertOne(donationData);
  
  return createResponse({
    success: true,
    message: '数据保存成功',
    id: result.insertedId.toString(),
    data: {
      ...donationData,
      _id: result.insertedId.toString()
    }
  });
}

// 新增捐赠数据 - 兼容旧的Request对象接口
async function postDonations(request, env) {
  const collection = await getDonationCollection(env);
  const body = await request.json();
  
  // 验证必需字段
  if (!body.name || !body.name.trim()) {
    return createResponse(
      { success: false, error: '姓名为必填项' },
      400
    );
  }
  
  if (!body.project || !body.project.trim()) {
    return createResponse(
      { success: false, error: '护持项目为必填项' },
      400
    );
  }
  
  // 处理批量数据
  if (body.data && Array.isArray(body.data)) {
    return await handleBatchInsert(body.data, collection);
  }
  
  // 单条数据
  const donationData = createDonationData(body);
  const result = await collection.insertOne(donationData);
  
  return createResponse({
    success: true,
    message: '数据保存成功',
    id: result.insertedId.toString(),
    data: {
      ...donationData,
      _id: result.insertedId.toString()
    }
  });
}

// 删除捐赠数据
async function deleteDonation(request, env, path) {
  const collection = await getDonationCollection(env);
  const url = new URL(request.url);
  
  // 提取ID
  const id = extractIdFromPath(path);
  if (!id) {
    return createResponse(
      { success: false, error: '未指定要删除的记录ID' },
      400
    );
  }
  
  // 验证管理员密码
  const adminPassword = url.searchParams.get('adminPassword');
  const expectedPassword = env.ADMIN_PASSWORD;
  
  if (!adminPassword || adminPassword !== expectedPassword) {
    return createResponse(
      { success: false, error: '管理员密码错误或未提供' },
      401
    );
  }
  
  // 构建查询条件
  let query;
  if (isValidObjectId(id)) {
    query = { _id: id };
  } else {
    query = {
      $or: [
        { localId: id },
        { serverId: id },
        { deviceId: id }
      ]
    };
  }
  
  const result = await collection.deleteOne(query);
  
  return createResponse({
    success: result.deletedCount > 0,
    deletedCount: result.deletedCount,
    message: result.deletedCount > 0 ? '删除成功' : '未找到记录'
  });
}

// 构建查询条件
function buildQuery(params) {
  const query = {};
  
  // 搜索条件
  const search = params.get('search');
  if (search && search.trim()) {
    query.$text = { $search: search.trim() };
  }
  
  // 项目筛选
  const project = params.get('project');
  if (project && project.trim()) {
    query.project = project.trim();
  }
  
  // 缴费状态筛选
  const payment = params.get('payment');
  if (payment && payment.trim()) {
    query.payment = payment.trim();
  }
  
  // 日期范围筛选
  const startDate = params.get('startDate');
  const endDate = params.get('endDate');
  if (startDate || endDate) {
    query.submittedAt = {};
    if (startDate) {
      query.submittedAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query.submittedAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
  }
  
  return query;
}

// 创建捐赠数据对象
function createDonationData(body) {
  const now = new Date();
  return {
    name: body.name.trim(),
    project: body.project,
    method: body.method || '',
    amountTWD: parseFloat(body.amountTWD) || 0,
    amountRMB: parseFloat(body.amountRMB) || 0,
    content: body.content || '',
    payment: body.payment || '未缴费',
    contact: body.contact || '',
    deviceId: body.deviceId || '',
    batchId: body.batchId || '',
    localId: body.localId || generateLocalId(),
    submittedAt: body.submittedAt ? new Date(body.submittedAt) : now,
    createdAt: now,
    updatedAt: now
  };
}

// 处理批量插入
async function handleBatchInsert(data, collection) {
  const donations = data.map(item => createDonationData(item));
  
  // 过滤无效数据
  const validDonations = donations.filter(d => d.name && d.project);
  
  if (validDonations.length === 0) {
    return createResponse(
      { success: false, error: '没有有效的捐赠数据' },
      400
    );
  }
  
  const result = await collection.insertMany(validDonations);
  
  return createResponse({
    success: true,
    message: `成功插入 ${result.insertedCount} 条记录`,
    insertedCount: result.insertedCount,
    insertedIds: Object.values(result.insertedIds).map(id => id.toString())
  });
}

// 从路径中提取ID
function extractIdFromPath(path) {
  const parts = path.split('/');
  const id = parts[parts.length - 1];
  return id && id !== 'donations' ? id : null;
}

// 生成本地ID
function generateLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 主请求处理器
export async function handler(event, context) {
  // Netlify Functions 的 event 对象包含请求信息
  const { path, httpMethod, headers, body } = event;
  
  // 环境变量
  const env = process.env;
  
  console.log(`[${new Date().toISOString()}] ${httpMethod} ${path}`);
  
  // 处理预检请求
  if (httpMethod === 'OPTIONS') {
    return handlePreflight();
  }
  
  try {
    let response;
    
    // 路由分发
    switch (true) {
      case path === '/api/test' || path === '/api/test/':
        // 直接调用测试处理器，不需要Request对象
        const url = new URL(`http://${headers.host}${path}`);
        const testRequest = new Request(url, {
          method: httpMethod,
          headers
        });
        response = await handleTest(testRequest, env);
        break;

      case path === '/api/donations' || path.startsWith('/api/donations/'):
        // 直接处理捐赠请求，不需要Request对象
        response = await handleDonationsDirect(httpMethod, body, env, path);
        break;

      case path === '/health' || path === '/health/':
        const mongoHealth = await checkMongoHealth(env);
        response = createResponse({
          status: 'ok',
          timestamp: new Date().toISOString(),
          service: 'donation-collection-system',
          mongodb: {
            connected: mongoHealth.ok,
            message: mongoHealth.message
          }
        });
        break;

      default:
        // 如果没有匹配的API路由，返回404
        response = createResponse({
          success: false,
          error: 'Not Found',
          path: path,
          availableEndpoints: [
            '/api/test',
            '/api/donations',
            '/health'
          ]
        }, 404);
    }
    
    return response;
    
  } catch (error) {
    console.error('Global error handler:', error);
    return createErrorResponse(error, 500);
  }
}
