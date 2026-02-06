/**
 * 养鸡场基金自动化更新脚本
 * 功能：自动获取基金涨跌幅并更新到Google Sheets
 * 定时：每天10:00, 13:00, 22:00自动执行
 */

// ==================== 配置区域 ====================
const CONFIG = {
  // Google Sheets配置
  SHEET_NAME: "定投基金",          // 工作表名称
  FUND_CODE_COLUMN: 2,            // B列：基金代码（从1开始计数）
  DAILY_RETURN_COLUMN: 4,         // D列：参考日回报
  START_ROW: 2,                   // 数据起始行（表头在第1行）
  MAX_ROWS: 100,                  // 最大处理行数
  
  // API配置（根据实际API调整）
  API_BASE_URL: "https://api.example.com/fund", // API基础URL
  REQUEST_DELAY: 1000,            // 请求间隔（毫秒），避免频率限制
  
  // 日志配置
  LOG_SHEET_NAME: "自动化日志",    // 日志工作表名称
  MAX_LOG_ENTRIES: 1000           // 最大日志条目数
};

// ==================== 主函数 ====================

/**
 * 主函数：更新所有基金涨跌幅
 * 定时触发器调用此函数
 */
function updateAllFundsDailyReturn() {
  const startTime = new Date();
  logMessage("INFO", "开始更新基金涨跌幅数据...");
  
  try {
    // 获取工作表
    const sheet = getSheet(CONFIG.SHEET_NAME);
    if (!sheet) {
      logMessage("ERROR", `找不到工作表: ${CONFIG.SHEET_NAME}`);
      return;
    }
    
    // 获取基金代码列表
    const fundCodes = getFundCodes(sheet);
    logMessage("INFO", `找到 ${fundCodes.length} 个基金`);
    
    if (fundCodes.length === 0) {
      logMessage("WARNING", "未找到基金代码，请检查表格格式");
      return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    // 遍历每个基金，获取涨跌幅
    for (let i = 0; i < fundCodes.length; i++) {
      const fundCode = fundCodes[i];
      if (!fundCode || fundCode === "-") {
        continue;
      }
      
      try {
        logMessage("DEBUG", `处理基金 ${fundCode} (${i + 1}/${fundCodes.length})`);
        
        // 获取涨跌幅
        const dailyReturn = getFundDailyReturn(fundCode);
        
        if (dailyReturn !== null && dailyReturn !== undefined) {
          // 更新到Google Sheets
          updateCell(sheet, i + CONFIG.START_ROW, CONFIG.DAILY_RETURN_COLUMN, dailyReturn);
          successCount++;
          logMessage("DEBUG", `  ${fundCode} 更新成功: ${dailyReturn}`);
        } else {
          failCount++;
          logMessage("WARNING", `  ${fundCode} 获取失败，返回空值`);
        }
        
        // 避免请求过快，添加延迟（避免API频率限制）
        if (i < fundCodes.length - 1) {
          Utilities.sleep(CONFIG.REQUEST_DELAY);
        }
        
      } catch (error) {
        failCount++;
        logMessage("ERROR", `处理基金 ${fundCode} 时出错: ${error.message}`);
      }
    }
    
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);
    
    logMessage("SUCCESS", 
      `更新完成！成功: ${successCount}, 失败: ${failCount}, 总计: ${fundCodes.length}, 耗时: ${duration}秒`
    );
    
  } catch (error) {
    logMessage("ERROR", `更新过程中发生错误: ${error.message}`);
    logMessage("ERROR", `错误堆栈: ${error.stack}`);
  }
}

// ==================== 核心功能函数 ====================

/**
 * 获取基金涨跌幅
 * @param {string} fundCode - 基金代码
 * @return {string|null} - 涨跌幅字符串，如 "+1.23%" 或 "-0.56%"，失败返回null
 */
function getFundDailyReturn(fundCode) {
  try {
    // TODO: 根据实际API实现
    // 这里需要根据调研的API进行实现
    
    // 示例1：天天基金网API
    // const url = `http://fundgz.1234567.com.cn/js/${fundCode}.js`;
    // 返回格式: jsonpgz({"fundcode":"161039","name":"纳指100ETF","jzrq":"2024-01-15","dwjz":"1.2345","gsz":"1.2456","gszzl":"+0.90","gztime":"2024-01-15 15:00"});
    
    // 示例2：东方财富API
    // const url = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${fundCode}&pageIndex=1&pageSize=1`;
    
    // 当前使用模拟数据（开发测试用）
    return getMockDailyReturn(fundCode);
    
  } catch (error) {
    logMessage("ERROR", `获取基金 ${fundCode} 数据失败: ${error.message}`);
    return null;
  }
}

/**
 * 模拟获取涨跌幅（开发测试用）
 * 实际使用时需要替换为真实的API调用
 */
function getMockDailyReturn(fundCode) {
  // 生成随机涨跌幅用于测试
  // 实际范围：-5% 到 +5%
  const randomChange = (Math.random() * 10 - 5).toFixed(2);
  const sign = randomChange >= 0 ? "+" : "";
  return `${sign}${randomChange}%`;
}

// ==================== Google Sheets操作函数 ====================

/**
 * 获取工作表
 */
function getSheet(sheetName) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    return spreadsheet.getSheetByName(sheetName);
  } catch (error) {
    logMessage("ERROR", `获取工作表 ${sheetName} 失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取基金代码列表
 */
function getFundCodes(sheet) {
  try {
    const range = sheet.getRange(
      CONFIG.START_ROW, 
      CONFIG.FUND_CODE_COLUMN, 
      CONFIG.MAX_ROWS, 
      1
    );
    const values = range.getValues();
    
    return values
      .map(row => row[0] ? row[0].toString().trim() : null)
      .filter(code => code && code !== "" && code !== "-");
      
  } catch (error) {
    logMessage("ERROR", `获取基金代码列表失败: ${error.message}`);
    return [];
  }
}

/**
 * 更新单元格
 */
function updateCell(sheet, row, column, value) {
  try {
    sheet.getRange(row, column).setValue(value);
    return true;
  } catch (error) {
    logMessage("ERROR", `更新单元格(${row},${column})失败: ${error.message}`);
    return false;
  }
}

// ==================== 日志功能 ====================

/**
 * 记录日志消息
 */
function logMessage(level, message) {
  const timestamp = Utilities.formatDate(new Date(), "Asia/Shanghai", "yyyy-MM-dd HH:mm:ss");
  const logEntry = `${timestamp} [${level}] ${message}`;
  
  // 输出到控制台
  console.log(logEntry);
  
  // 保存到日志工作表
  saveToLogSheet(level, message, timestamp);
}

/**
 * 保存日志到工作表
 */
function saveToLogSheet(level, message, timestamp) {
  try {
    let logSheet = getSheet(CONFIG.LOG_SHEET_NAME);
    
    // 如果日志工作表不存在，创建它
    if (!logSheet) {
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      logSheet = spreadsheet.insertSheet(CONFIG.LOG_SHEET_NAME);
      
      // 设置表头
      logSheet.getRange("A1").setValue("时间");
      logSheet.getRange("B1").setValue("级别");
      logSheet.getRange("C1").setValue("消息");
      
      // 设置列宽
      logSheet.setColumnWidth(1, 180); // 时间列
      logSheet.setColumnWidth(2, 80);  // 级别列
      logSheet.setColumnWidth(3, 400); // 消息列
    }
    
    // 获取最后一行
    const lastRow = logSheet.getLastRow();
    const insertRow = lastRow + 1;
    
    // 写入日志
    logSheet.getRange(insertRow, 1).setValue(timestamp);
    logSheet.getRange(insertRow, 2).setValue(level);
    logSheet.getRange(insertRow, 3).setValue(message);
    
    // 限制日志数量
    if (insertRow > CONFIG.MAX_LOG_ENTRIES + 1) {
      const deleteCount = insertRow - CONFIG.MAX_LOG_ENTRIES - 1;
      logSheet.deleteRows(2, deleteCount);
    }
    
  } catch (error) {
    console.error(`保存日志失败: ${error.message}`);
  }
}

/**
 * 清空日志
 */
function clearLogs() {
  try {
    const logSheet = getSheet(CONFIG.LOG_SHEET_NAME);
    if (logSheet) {
      const lastRow = logSheet.getLastRow();
      if (lastRow > 1) {
        logSheet.getRange(2, 1, lastRow - 1, 3).clearContent();
      }
    }
    logMessage("INFO", "日志已清空");
  } catch (error) {
    console.error(`清空日志失败: ${error.message}`);
  }
}

// ==================== 触发器管理 ====================

/**
 * 设置定时触发器
 * 每天10:00, 13:00, 22:00执行
 */
function setupTriggers() {
  try {
    // 删除现有触发器
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'updateAllFundsDailyReturn') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    
    // 创建新触发器
    // 注意：Google Apps Script的时区设置需要与这里一致
    
    // 早上10点
    ScriptApp.newTrigger('updateAllFundsDailyReturn')
      .timeBased()
      .atHour(10)
      .everyDays(1)
      .create();
    
    // 下午1点  
    ScriptApp.newTrigger('updateAllFundsDailyReturn')
      .timeBased()
      .atHour(13)
      .everyDays(1)
      .create();
      
    // 晚上10点
    ScriptApp.newTrigger('updateAllFundsDailyReturn')
      .timeBased()
      .atHour(22)
      .everyDays(1)
      .create();
      
    logMessage("INFO", "定时触发器设置完成：10:00, 13:00, 22:00");
    logMessage("INFO", "时区：Asia/Shanghai");
    
  } catch (error) {
    logMessage("ERROR", `设置触发器失败: ${error.message}`);
  }
}

/**
 * 删除所有触发器
 */
function deleteAllTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
    logMessage("INFO", `已删除 ${triggers.length} 个触发器`);
  } catch (error) {
    logMessage("ERROR", `删除触发器失败: ${error.message}`);
  }
}

/**
 * 查看当前触发器
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  logMessage("INFO", `当前有 ${triggers.length} 个触发器:`);
  
  triggers.forEach((trigger, index) => {
    logMessage("INFO", 
      `  ${index + 1}. 函数: ${trigger.getHandlerFunction()}, ` +
      `类型: ${trigger.getEventType()}, ` +
      `来源: ${trigger.getTriggerSource()}`
    );
  });
}

// ==================== 测试函数 ====================

/**
 * 手动测试函数
 * 可以在Google Apps Script编辑器中直接运行测试
 */
function testUpdate() {
  logMessage("INFO", "开始手动测试...");
  updateAllFundsDailyReturn();
}

/**
 * 测试单个基金
 */
function testSingleFund() {
  const testFundCode = "161039"; // 示例基金代码
  logMessage("INFO", `测试单个基金: ${testFundCode}`);
  
  try {
    const dailyReturn = getFundDailyReturn(testFundCode);
    logMessage("INFO", `获取结果: ${dailyReturn}`);
  } catch (error) {
    logMessage("ERROR", `测试失败: ${error.message}`);
  }
}

/**
 * 测试日志功能
 */
function testLogging() {
  logMessage("DEBUG", "这是一条调试日志");
  logMessage("INFO", "这是一条信息日志");
  logMessage("WARNING", "这是一条警告日志");
  logMessage("ERROR", "这是一条错误日志");
  logMessage("SUCCESS", "这是一条成功日志");
}

// ==================== 初始化函数 ====================

/**
 * 初始化脚本
 * 第一次使用时运行此函数
 */
function initialize() {
  logMessage("INFO", "开始初始化养鸡场基金自动化脚本...");
  
  // 1. 设置触发器
  setupTriggers();
  
  // 2. 创建日志工作表（如果不存在）
  saveToLogSheet("INFO", "脚本初始化完成", 
    Utilities.formatDate(new Date(), "Asia/Shanghai", "yyyy-MM-dd HH:mm:ss"));
  
  // 3. 测试一次更新
  testUpdate();
  
  logMessage("SUCCESS", "初始化完成！");
}

/**
 * 卸载脚本
 * 清理所有资源
 */
function uninstall() {
  logMessage("INFO", "开始卸载脚本...");
  
  // 1. 删除所有触发器
  deleteAllTriggers();
  
  // 2. 清空日志
  clearLogs();
  
  // 3. 删除日志工作表（可选）
  // const logSheet = getSheet(CONFIG.LOG_SHEET_NAME);
  // if (logSheet) {
  //   const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  //   spreadsheet.deleteSheet(logSheet);
  // }
  
  logMessage("INFO", "脚本卸载完成");
}