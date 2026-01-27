// 配置：Google Apps Script URL
const GOOGLE_SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbyDmyVuRF3vUHUGsPDHjdx8fNiqv86oAXr8lyi0NcvBJylAcXwReXjn0mXjHRrVYpA5/exec';

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
    
    // 处理数字类型
    if (typeof amount === 'number') {
        return '¥' + amount.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }
    
    // 处理字符串类型
    const num = parseFloat(amount.toString().replace(/[^\d.-]/g, ''));
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

// 获取操作标签背景色
function getOperationBackgroundClass(operation) {
    const op = (operation || '').toLowerCase();
    if (op.includes('推荐定投')) return 'bg-recommend';
    if (op.includes('一般')) return 'bg-normal';
    if (op.includes('风险较高')) return 'bg-risk';
    if (op.includes('暂时别买')) return 'bg-stop';
    return '';
}

// 格式化图片链接
function formatImageContent(content) {
    if (!content) return '';
    
    // 如果是图片对象类型，显示占位符
    if (typeof content === 'object' && content.valueType === 'IMAGE') {
        return '<span class="image-placeholder">📷 待上传图片</span>';
    }
    
    // 检查是否包含图片链接
    const imageRegex = /(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/gi;
    const matches = content.toString().match(imageRegex);
    
    if (matches && matches.length > 0) {
        return matches.map((url, index) => 
            `<div class="image-cell">
                <img src="${url}" alt="操作截图" loading="lazy" onclick="openImageModal('${url}')">
            </div>`
        ).join('');
    }
    
    return content.toString();
}

// 打开图片模态框
function openImageModal(imageUrl) {
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-btn" onclick="closeImageModal()">&times;</span>
            <img src="${imageUrl}" alt="放大图片">
        </div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeImageModal();
        }
    });
}

// 关闭图片模态框
function closeImageModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) {
        modal.remove();
    }
}

// 按ESC关闭图片
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeImageModal();
    }
});

// 渲染定投基金表格
function renderDCATable(data) {
    const tbody = document.getElementById('dca-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无定投记录</td></tr>';
        return;
    }

        tbody.innerHTML = data.map(row => {
        const bgClass = getOperationBackgroundClass(row['操作'] || row['操作']);
        
        return `
        <tr>
            <td>${formatDate(row['日期'] || row['日期'])}</td>
            <td><code>${row['基金代码'] || row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || row['基金名称'] || '-'}</td>
            <td>${row['基金限购'] || row['基金限购'] || '-'}</td>
            <td>
                <span class="operation-tag ${bgClass}">
                    ${row['操作'] || row['操作'] || '-'}
                </span>
            </td>
            <td>${formatCurrency(row['金额'] || row['金额'])}</td>
            <td>${row['备注'] || row['备注'] || '-'}</td>
        </tr>
    `;
    }).join('');
}

// 渲染主动操作表格
function renderManualTable(data) {
    const tbody = document.getElementById('manual-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="5">暂无操作记录</td></tr>';
        return;
    }

    // 按日期倒序（最新的在前）
    const sortedData = [...data].sort((a, b) => {
        const dateA = (a['操作时间'] || a['操作时间'] || '').replace(/[^\d]/g, '');
        const dateB = (b['操作时间'] || b['操作时间'] || '').replace(/[^\d]/g, '');
        return dateB.localeCompare(dateA);
    });

        tbody.innerHTML = sortedData.map(row => `
        <tr>
            <td>${formatDate(row['操作时间'] || row['操作时间'])}</td>
            <td>${formatImageContent(row['每日定投'] || row['每日定投'])}</td>
            <td>${formatImageContent(row['买入操作'] || row['买入操作'])}</td>
            <td>${formatImageContent(row['卖出操作'] || row['卖出操作'])}</td>
            <td>${row['当日留言'] || row['当日留言'] || '-'}</td>
        </tr>
    `).join('');
}

// 渲染历史操作记录表格
function renderDailyTable(data) {
    const tbody = document.getElementById('daily-body');

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
        renderManualTable(cachedData.active);
        renderDisclaimer(cachedData.disclaimer);
        updateLastUpdateTime();
        return;
    }

    try {
        const response = await fetch(GOOGLE_SHEET_API_URL);

        if (!response.ok) throw new Error('网络请求失败');

        const jsonData = await response.json();

        // 直接按 sheet 名称获取数据
        const dca = jsonData['定投基金'] ? jsonData['定投基金'].rows : [];
        const manual = jsonData['操作记录'] ? jsonData['操作记录'].rows : [];
        const active = jsonData['主动操作'] ? jsonData['主动操作'].rows : [];
        
        let disclaimer = '';
        let dailyNote = '';
        if (jsonData['说明'] && jsonData['说明'].rows.length > 0) {
            const firstRow = jsonData['说明'].rows[0];
            disclaimer = firstRow['风险说明'] || '';
            dailyNote = firstRow['今日留言'] || '';
        }

        // 更新缓存
        cachedData = { dca, manual, disclaimer, dailyNote };
        lastFetchTime = now;

        // 渲染
        renderDCATable(dca);
        renderManualTable(active);  // 主动操作
        renderDisclaimer(disclaimer);
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
