// Vercel Serverless Function - 飞书API代理
// 用于解决CORS跨域问题

const FEISHU_CONFIG = {
    app_id: 'cli_a903d71491789cd2',
    app_secret: 'iaKqzllntmpBLWTMARMbshH4HTTnHo8t',
    app_token: 'DZsgbRGajagE8BsvkSHcc2mwnhg'
};

// Token缓存（避免频繁请求）
let cachedToken = null;
let tokenExpireTime = 0;

// 获取tenant_access_token
async function getTenantAccessToken() {
    const now = Date.now();
    
    // 如果token还有效，直接返回缓存
    if (cachedToken && now < tokenExpireTime) {
        return cachedToken;
    }
    
    const url = 'https://open.feishu.cn/open-api/auth/v3/tenant_access_token/internal';
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            app_id: FEISHU_CONFIG.app_id,
            app_secret: FEISHU_CONFIG.app_secret
        })
    });
    
    const data = await response.json();
    
    if (data.code === 0) {
        cachedToken = data.tenant_access_token;
        // token有效期2小时，我们设置1.5小时后过期
        tokenExpireTime = now + (90 * 60 * 1000);
        return cachedToken;
    } else {
        throw new Error(`获取token失败: ${data.msg}`);
    }
}

// 获取所有数据表
async function getTables(token) {
    const url = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    if (data.code === 0) {
        return data.data.items;
    } else {
        throw new Error(`获取表格列表失败: ${data.msg}`);
    }
}

// 获取指定表的字段信息
async function getFields(token, tableId) {
    const url = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${tableId}/fields`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    if (data.code === 0) {
        return data.data.items;
    } else {
        throw new Error(`获取字段失败: ${data.msg}`);
    }
}

// 获取指定表的所有记录
async function getRecords(token, tableId) {
    let allRecords = [];
    let hasMore = true;
    let pageToken = null;
    
    while (hasMore) {
        let url = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${tableId}/records?page_size=500`;
        
        if (pageToken) {
            url += `&page_token=${pageToken}`;
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.code === 0) {
            allRecords = allRecords.concat(data.data.items || []);
            hasMore = data.data.has_more;
            pageToken = data.data.page_token;
        } else {
            throw new Error(`获取记录失败: ${data.msg}`);
        }
    }
    
    return allRecords;
}

// 将飞书数据转换为前端需要的格式（类似Google Sheets格式）
function transformFeishuData(tables, fieldsMap, recordsMap) {
    const result = {};
    
    tables.forEach(table => {
        const tableName = table.name;
        const fields = fieldsMap[table.table_id] || [];
        const records = recordsMap[table.table_id] || [];
        
        // 构建headers（字段名数组）
        const headers = fields.map(field => field.field_name);
        
        // 构建rows（数据行数组）
        const rows = records.map(record => {
            const row = {};
            fields.forEach(field => {
                const fieldValue = record.fields[field.field_name];
                
                // 处理不同类型的字段值
                if (fieldValue === null || fieldValue === undefined) {
                    row[field.field_name] = '';
                } else if (Array.isArray(fieldValue)) {
                    // 数组类型（如多选、附件等）
                    if (fieldValue.length > 0 && typeof fieldValue[0] === 'object') {
                        // 如果是对象数组，提取text或name
                        row[field.field_name] = fieldValue.map(item => item.text || item.name || '').join(', ');
                    } else {
                        row[field.field_name] = fieldValue.join(', ');
                    }
                } else if (typeof fieldValue === 'object') {
                    // 对象类型（如人员、链接等）
                    row[field.field_name] = fieldValue.text || fieldValue.link || fieldValue.name || JSON.stringify(fieldValue);
                } else {
                    row[field.field_name] = fieldValue;
                }
            });
            return row;
        });
        
        result[tableName] = {
            headers: headers,
            rows: rows
        };
    });
    
    return result;
}

// Vercel Serverless Function 入口
export default async function handler(req, res) {
    // 设置CORS头，允许跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    try {
        // 1. 获取访问token
        const token = await getTenantAccessToken();
        
        // 2. 获取所有数据表
        const tables = await getTables(token);
        
        // 3. 获取每个表的字段和记录
        const fieldsMap = {};
        const recordsMap = {};
        
        for (const table of tables) {
            fieldsMap[table.table_id] = await getFields(token, table.table_id);
            recordsMap[table.table_id] = await getRecords(token, table.table_id);
        }
        
        // 4. 转换数据格式（兼容原来的Google Sheets格式）
        const result = transformFeishuData(tables, fieldsMap, recordsMap);
        
        // 5. 返回JSON数据
        res.status(200).json(result);
        
    } catch (error) {
        console.error('API错误:', error);
        res.status(500).json({
            error: error.message,
            message: '获取飞书数据失败'
        });
    }
}
