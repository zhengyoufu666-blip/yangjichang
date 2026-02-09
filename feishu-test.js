// 飞书多维表格API测试脚本
// 用于获取表格结构信息

const FEISHU_CONFIG = {
    app_id: 'cli_a903d71491789cd2',
    app_secret: 'iaKqzllntmpBLWTMARMbshH4HTTnHo8t',
    app_token: 'DZsgbRGajagE8BsvkSHcc2mwnhg'
};

// 获取tenant_access_token
async function getTenantAccessToken() {
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
        console.log('✅ 获取token成功:', data.tenant_access_token);
        return data.tenant_access_token;
    } else {
        console.error('❌ 获取token失败:', data);
        throw new Error(`获取token失败: ${data.msg}`);
    }
}

// 获取多维表格所有数据表列表
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
        console.log('\n📋 表格列表:');
        data.data.items.forEach((table, index) => {
            console.log(`  ${index + 1}. ${table.name} (ID: ${table.table_id})`);
        });
        return data.data.items;
    } else {
        console.error('❌ 获取表格列表失败:', data);
        throw new Error(`获取表格列表失败: ${data.msg}`);
    }
}

// 获取指定数据表的字段信息
async function getFields(token, tableId, tableName) {
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
        console.log(`\n📊 [${tableName}] 的字段列表:`);
        data.data.items.forEach((field, index) => {
            console.log(`  ${index + 1}. ${field.field_name} (类型: ${field.type}, ID: ${field.field_id})`);
        });
        return data.data.items;
    } else {
        console.error(`❌ 获取[${tableName}]字段失败:`, data);
        return [];
    }
}

// 获取指定数据表的数据记录（仅前5条用于测试）
async function getRecords(token, tableId, tableName) {
    const url = `https://open.feishu.cn/open-api/bitable/v1/apps/${FEISHU_CONFIG.app_token}/tables/${tableId}/records?page_size=5`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    if (data.code === 0) {
        console.log(`\n📝 [${tableName}] 的示例数据 (前5条):`);
        if (data.data.items && data.data.items.length > 0) {
            data.data.items.forEach((record, index) => {
                console.log(`  记录 ${index + 1}:`, JSON.stringify(record.fields, null, 2));
            });
        } else {
            console.log('  (空表)');
        }
        return data.data.items;
    } else {
        console.error(`❌ 获取[${tableName}]数据失败:`, data);
        return [];
    }
}

// 主测试函数
async function main() {
    try {
        console.log('🚀 开始测试飞书多维表格API...\n');
        console.log('📝 配置信息:');
        console.log(`  App ID: ${FEISHU_CONFIG.app_id}`);
        console.log(`  App Token: ${FEISHU_CONFIG.app_token}\n`);
        
        // 1. 获取访问token
        const token = await getTenantAccessToken();
        
        // 2. 获取所有数据表
        const tables = await getTables(token);
        
        // 3. 遍历每个表，获取字段和示例数据
        for (const table of tables) {
            await getFields(token, table.table_id, table.name);
            await getRecords(token, table.table_id, table.name);
        }
        
        console.log('\n✅ 测试完成！');
        
    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error('详细错误:', error);
    }
}

// 在Node.js环境中运行
if (typeof window === 'undefined') {
    main();
}

// 在浏览器环境中运行（可以在浏览器控制台复制此代码执行）
if (typeof window !== 'undefined') {
    window.testFeishu = main;
    console.log('💡 在浏览器控制台执行: testFeishu()');
}
