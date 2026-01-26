// 配置：Google Apps Script URL
const GOOGLE_SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbyYEeA38gy8Z-GwanVleo4Sff8n-GIUmKItzPlTj9fzyH5fk_UR2cgnGhBXlSN2VBoK/exec';

// 缓存数据（5分钟）
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

// 当前显示的标签
let currentTab = 'dca';

// 解析单行 CSV
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// 解析 Google Apps Script 返回的 JSON
function parseSheetsData(jsonData) {
    const result = [];
    
    // 遍历所有 sheet
    for (const sheetName in jsonData) {
        const sheet = jsonData[sheetName];
        result.push({
            headers: sheet.headers,
            rows: sheet.rows
        });
    }
    
    return result;
}

// 获取操作标签 CSS 类
function getOperationClass(operation) {
    const op = (operation || '').toLowerCase();
    if (op.includes('买入') || op.includes('加仓') || op.includes('增加')) return 'increase';
    if (op.includes('卖出') || op.includes('减仓') || op.includes('减少')) return 'decrease';
    if (op.includes('定投')) return 'dca';
    return '';
}

// 格式化金额
function formatCurrency(amount) {
    if (!amount || amount === '-') return '-';
    const num = parseFloat(amount.replace(/[^\d.-]/g, ''));
    if (isNaN(num)) return amount;
    return '¥' + num.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// 格式化日期（去掉年份）
function formatDate(dateStr) {
    if (!dateStr) return '-';
    // 如果是 20240115 这种格式，只取月日
    const cleaned = dateStr.replace(/[^\d]/g, '');
    if (cleaned.length === 8) {
        return cleaned.slice(4); // 取月日
    }
    return dateStr;
}

// 渲染风险说明（紧凑版）
function renderDisclaimer(content) {
    const container = document.getElementById('disclaimer');
    const contentDiv = document.getElementById('disclaimer-content');
    if (container && contentDiv && content) {
        contentDiv.innerHTML = content.replace(/\n/g, '<br>');
        container.style.display = 'block';
    }
}

// 渲染今日留言
function renderDailyNote(content) {
    const container = document.getElementById('daily-note');
    const contentDiv = document.getElementById('daily-note-content');
    if (container && contentDiv && content && content.trim()) {
        contentDiv.textContent = content;
        container.style.display = 'block';
    }
}

// 渲染定投基金表格
function renderDCATable(data) {
    const tbody = document.getElementById('dca-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无定投记录</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${formatDate(row['日期'] || row['日期'])}</td>
            <td><code>${row['基金代码'] || row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || row['基金名称'] || '-'}</td>
            <td>${row['基金限购'] || row['基金限购'] || '-'}</td>
            <td>
                <span class="operation-tag ${getOperationClass(row['操作'] || row['操作'])}">
                    ${row['操作'] || row['操作'] || '-'}
                </span>
            </td>
            <td>${formatCurrency(row['金额'] || row['金额'])}</td>
            <td>${row['备注'] || row['备注'] || '-'}</td>
        </tr>
    `).join('');
}

// 渲染手动操作表格
function renderManualTable(data) {
    const tbody = document.getElementById('manual-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="6">暂无操作记录</td></tr>';
        return;
    }

    // 按日期倒序（最新的在前）
    const sortedData = [...data].sort((a, b) => {
        const dateA = (a['日期'] || a['日期'] || '').replace(/[^\d]/g, '');
        const dateB = (b['日期'] || b['日期'] || '').replace(/[^\d]/g, '');
        return dateB.localeCompare(dateA);
    });

    tbody.innerHTML = sortedData.map(row => `
        <tr>
            <td>${formatDate(row['日期'] || row['日期'])}</td>
            <td>
                <span class="operation-tag ${getOperationClass(row['操作类型'] || row['操作类型'] || row['操作'])}">
                    ${row['操作类型'] || row['操作类型'] || row['操作'] || '-'}
                </span>
            </td>
            <td><code>${row['基金代号'] || row['基金代号'] || row['基金代码'] || '-'}</code></td>
            <td>${row['基金名字'] || row['基金名称'] || row['基金名字'] || '-'}</td>
            <td><strong>${formatCurrency(row['金额'] || row['金额'])}</strong></td>
            <td>${row['备注'] || row['备注'] || '-'}</td>
        </tr>
    `).join('');
}

// 切换标签
function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('last-update').textContent = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 切换标签
function switchTab(tabName) {
    currentTab = tabName;

    // 更新按钮状态
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 更新内容显示
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

// 展开/收起风险说明
function toggleDisclaimer() {
    document.getElementById('disclaimer').classList.toggle('expanded');
}

// 手动刷新数据
function refreshData() {
    const btn = document.querySelector('.refresh-btn');
    if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '🔄 加载中...';
        btn.disabled = true;
    }

    // 清除缓存
    cachedData = null;
    lastFetchTime = 0;

    fetchData().finally(() => {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

// 获取数据
async function fetchData() {
    const now = Date.now();
    if (cachedData && (now - lastFetchTime) < CACHE_DURATION) {
        console.log('使用缓存数据');
        renderDCATable(cachedData.dca);
        renderManualTable(cachedData.manual);
        renderDisclaimer(cachedData.disclaimer);
        renderDailyNote(cachedData.dailyNote);
        updateLastUpdateTime();
        return;
    }

    try {
        const response = await fetch(GOOGLE_SHEET_API_URL);

        if (!response.ok) throw new Error('网络请求失败');

        const jsonData = await response.json();
        const sheets = parseSheetsData(jsonData);

        // 按 sheet 名称查找数据
        let dca = [], manual = [], disclaimer = '', dailyNote = '';

        sheets.forEach(sheet => {
            const sheetName = sheet.headers[0]; // 第一个单元格作为 sheet 名称
            const rows = sheet.rows;

            if (sheetName.includes('定投') || sheetName.includes('基金')) {
                dca = rows;
            } else if (sheetName.includes('操作') || sheetName.includes('记录')) {
                manual = rows;
            } else if (sheetName.includes('说明')) {
                // 说明 sheet
                if (rows.length > 0) {
                    const firstRow = rows[0];
                    const headers = sheet.headers;
                    
                    // 找到今日留言和风险说明列
                    const todayIndex = headers.findIndex(h => h.includes('今日留言'));
                    const riskIndex = headers.findIndex(h => h.includes('风险说明'));
                    
                    if (riskIndex >= 0) disclaimer = firstRow[headers[riskIndex]] || '';
                    if (todayIndex >= 0) dailyNote = firstRow[headers[todayIndex]] || '';
                }
            }
        });

        // 更新缓存
        cachedData = { dca, manual, disclaimer, dailyNote };
        lastFetchTime = now;

        // 渲染
        renderDCATable(dca);
        renderManualTable(manual);
        renderDisclaimer(disclaimer);
        renderDailyNote(dailyNote);
        updateLastUpdateTime();

    } catch (error) {
        console.error('获取数据失败:', error);
        document.getElementById('dca-body').innerHTML = `
            <tr class="empty-state"><td colspan="7">加载失败: ${error.message}</td></tr>
        `;
        document.getElementById('manual-body').innerHTML = `
            <tr class="empty-state"><td colspan="6">加载失败: ${error.message}</td></tr>
        `;
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});
