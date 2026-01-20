// 配置：Google Sheets 发布链接
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS7SWjFLCfLb9gMYK-aFZ1qXtvna6RyITzyOXYKDtNKQueRWKArcm2k6htJCVLrCoBX7TOo-KShMNRO/pub?output=csv';

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

// 解析整个 CSV（支持多 sheet）
function parseFullCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const sheets = [];
    let currentSheet = { headers: [], rows: [] };
    let isNewSheet = true;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (currentSheet.rows.length > 0) {
                sheets.push(currentSheet);
                currentSheet = { headers: [], rows: [] };
                isNewSheet = true;
            }
            continue;
        }

        const values = parseCSVLine(line);

        if (isNewSheet) {
            currentSheet.headers = values;
            isNewSheet = false;
        } else {
            const row = {};
            currentSheet.headers.forEach((header, index) => {
                row[header.trim()] = values[index] ? values[index].trim() : '';
            });
            currentSheet.rows.push(row);
        }
    }

    if (currentSheet.rows.length > 0) {
        sheets.push(currentSheet);
    }

    return sheets;
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
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(GOOGLE_SHEET_CSV_URL)}`;
        const response = await fetch(proxyUrl);

        if (!response.ok) throw new Error('网络请求失败');

        const csvText = await response.text();
        const sheets = parseFullCSV(csvText);

        // Sheet1: 定投基金
        const dca = sheets[0] ? sheets[0].rows : [];

        // Sheet2: 操作说明
        const manual = sheets[1] ? sheets[1].rows : [];

        // Sheet3: 说明（取第三行第三列作为今日留言）
        let disclaimer = '';
        let dailyNote = '';
        if (sheets[2] && sheets[2].rows.length > 0) {
            const headers = sheets[2].headers;
            const firstRow = sheets[2].rows[0];

            // 找说明列（第一列）和内容列
            const titleCol = headers[0];
            const contentCol = headers[1];

            if (titleCol && titleCol.includes('说明')) {
                disclaimer = firstRow[contentCol] || '';
            }

            // 今日留言（第三行）
            if (sheets[2].rows.length >= 3) {
                const thirdRow = sheets[2].rows[2];
                dailyNote = thirdRow[contentCol] || '';
            }
        }

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
