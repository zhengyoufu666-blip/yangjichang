// 配置：Google Sheets 发布链接
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS7SWjFLCfLb9gMYK-aFZ1qXtvna6RyITzyOXYKDtNKQueRWKArcm2k6htJCVLrCoBX7TOo-KShMNRO/pub?output=csv';

// 缓存数据（5分钟）
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

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
            // 空行可能是 sheet 分隔符
            if (currentSheet.rows.length > 0) {
                sheets.push(currentSheet);
                currentSheet = { headers: [], rows: [] };
                isNewSheet = true;
            }
            continue;
        }

        const values = parseCSVLine(line);

        if (isNewSheet) {
            // 这是 sheet 的表头
            currentSheet.headers = values;
            isNewSheet = false;
        } else {
            // 这是数据行
            const row = {};
            currentSheet.headers.forEach((header, index) => {
                row[header.trim()] = values[index] ? values[index].trim() : '';
            });
            currentSheet.rows.push(row);
        }
    }

    // 最后一个 sheet
    if (currentSheet.rows.length > 0) {
        sheets.push(currentSheet);
    }

    return sheets;
}

// 获取操作标签的 CSS 类
function getOperationClass(operation) {
    const op = (operation || '').toLowerCase();
    if (op.includes('买入')) return 'buy';
    if (op.includes('卖出')) return 'sell';
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

// 渲染甩锅区
function renderDisclaimer(content) {
    const container = document.getElementById('disclaimer');
    const contentDiv = document.getElementById('disclaimer-content');
    if (container && contentDiv && content) {
        contentDiv.innerHTML = content.replace(/\n/g, '<br>');
        container.style.display = 'block';
    }
}

// 渲染表格
function renderTable(data) {
    const tbody = document.getElementById('records-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无记录</td></tr>';
        return;
    }

    // 按日期倒序
    const sortedData = [...data].sort((a, b) => {
        const dateA = new Date(a['日期'] || a['date'] || 0);
        const dateB = new Date(b['日期'] || b['date'] || 0);
        return dateB - dateA;
    });

    tbody.innerHTML = sortedData.map(row => `
        <tr>
            <td>${row['日期'] || '-'}</td>
            <td><code>${row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || '-'}</td>
            <td>${row['基金限购'] || '-'}</td>
            <td>
                <span class="operation-tag ${getOperationClass(row['操作'])}">
                    ${row['操作'] || '-'}
                </span>
            </td>
            <td><strong>${formatCurrency(row['金额'])}</strong></td>
            <td>${row['备注'] || '-'}</td>
        </tr>
    `).join('');
}

// 更新统计
function updateStats(data) {
    if (!data || data.length === 0) {
        document.getElementById('total-operations').textContent = '0';
        document.getElementById('total-buy').textContent = '¥0.00';
        document.getElementById('total-sell').textContent = '¥0.00';
        return;
    }

    let totalBuy = 0;
    let totalSell = 0;

    data.forEach(row => {
        const operation = (row['操作'] || '').toLowerCase();
        const amount = parseFloat((row['金额'] || '0').replace(/[^\d.-]/g, ''));

        if (!isNaN(amount)) {
            if (operation.includes('买入')) totalBuy += amount;
            else if (operation.includes('卖出')) totalSell += amount;
        }
    });

    document.getElementById('total-operations').textContent = data.length;
    document.getElementById('total-buy').textContent = formatCurrency(totalBuy.toString());
    document.getElementById('total-sell').textContent = formatCurrency(totalSell.toString());
}

// 更新最后更新时间
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

// 获取数据
async function fetchData() {
    const now = Date.now();
    if (cachedData && (now - lastFetchTime) < CACHE_DURATION) {
        console.log('使用缓存数据');
        renderTable(cachedData.records);
        updateStats(cachedData.records);
        if (cachedData.disclaimer) renderDisclaimer(cachedData.disclaimer);
        updateLastUpdateTime();
        return;
    }

    const tbody = document.getElementById('records-body');

    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(GOOGLE_SHEET_CSV_URL)}`;
        const response = await fetch(proxyUrl);

        if (!response.ok) throw new Error('网络请求失败');

        const csvText = await response.text();
        const sheets = parseFullCSV(csvText);

        // 第一个 sheet 是记录
        const records = sheets[0] ? sheets[0].rows : [];

        // 查找甩锅区（第二个 sheet 的第一行第二列）
        let disclaimer = '';
        if (sheets[1] && sheets[1].rows.length > 0) {
            const firstRow = sheets[1].rows[0];
            // 获取第一个单元格的值作为标题，第二个作为内容
            const keys = Object.keys(firstRow);
            if (keys.length >= 2) {
                disclaimer = firstRow[keys[1]] || '';
            }
        }

        // 更新缓存
        cachedData = { records, disclaimer };
        lastFetchTime = now;

        renderTable(records);
        updateStats(records);
        if (disclaimer) renderDisclaimer(disclaimer);
        updateLastUpdateTime();

    } catch (error) {
        console.error('获取数据失败:', error);
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7">
                    <p>❌ 加载失败</p>
                    <p style="font-size: 0.875rem; margin-top: 8px;">${error.message}</p>
                </td>
            </tr>
        `;
    }
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', fetchData);
