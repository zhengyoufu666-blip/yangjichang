// 配置：Google Apps Script URL
const GOOGLE_SHEET_API_URL = 
'https://script.google.com/macros/s/AKfycbw7TMJDyFDBIM0JGU15YseYlZ-bggEW9oHNIMI1ZtiYlEIyjBq3DZJhI-zN9gKMdyOQ/exec';

// 缓存数据（5分钟）
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

// 当前显示的标签
let currentTab = 'dca';

// 排序状态
let sortState = {
    column: null,
    direction: null // null: 默认, 'asc': 升序, 'desc': 降序
};

// 朋友专场基金代码配置
const FRIENDS_ZONE_FUNDS = [
    '012863',
    '002834', 
    '019414',
    '013478',
    '018463',
    '008182',
    '015790',
    '002207',
    '024329'
];

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
            minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
            maximumFractionDigits: 2
        });
    }
    
    // 处理字符串类型
    const num = parseFloat(amount.toString().replace(/[^\d.-]/g, ''));
    if (isNaN(num)) return amount;
    return '¥' + num.toLocaleString('zh-CN', {
        minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
        maximumFractionDigits: 2
    });
}

// 格式化百分比
function formatPercentage(value, decimals = 2) {
    if (value === null || value === undefined || value === '') return '-';
    
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return '-';
    
    return num.toFixed(decimals) + '%';
}

// 格式化参考日回报
function formatDailyReturn(value) {
    if (value === null || value === undefined || value === '') return '-';
    
    // 如果是字符串且包含%，去掉%后重新格式化
    let numStr = value;
    if (typeof value === 'string') {
        numStr = value.replace(/%/g, '').trim();
    }
    
    // 尝试解析数字
    const num = typeof numStr === 'number' ? numStr : parseFloat(numStr);
    if (isNaN(num)) {
        return value; // 返回原始值
    }
    
    // 格式化为1位小数并添加百分号
    const formatted = num.toFixed(1);
    return formatted + '%';
}

// 获取日回报样式类
function getDailyReturnClass(value) {
    if (value === null || value === undefined || value === '') return '';
    
    // 尝试解析数字
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return '';
    
    // 正数用红色，负数用绿色
    if (num > 0) return 'daily-return-positive';
    if (num < 0) return 'daily-return-negative';
    return ''; // 0值没有特殊样式
}

// 计算持仓占比
function calculateHoldingsPercentage(data) {
    if (!data || data.length === 0) return data;
    
    // 计算总金额
    const totalAmount = data.reduce((sum, row) => {
        const amount = parseFloat((row['金额'] || '0').toString().replace(/[^\d.-]/g, '')) || 0;
        return sum + amount;
    }, 0);
    
    // 如果总金额为0，返回原始数据
    if (totalAmount === 0) return data;
    
    // 计算每行的持仓占比
    return data.map(row => {
        const amount = parseFloat((row['金额'] || '0').toString().replace(/[^\d.-]/g, '')) || 0;
        const percentage = (amount / totalAmount * 100);
        
        return {
            ...row,
            _percentage: percentage, // 存储计算出的占比
            _originalAmount: amount  // 保留原始金额用于排序
        };
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

// 处理图片加载错误
function handleImageError(imgElement) {
    imgElement.onerror = null; // 防止循环错误
    imgElement.style.display = 'none';
    
    // 创建占位符
    const placeholder = document.createElement('span');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = '📷 图片加载失败';
    
    // 替换图片
    if (imgElement.parentNode) {
        imgElement.parentNode.appendChild(placeholder);
    }
}

// 格式化文本，将换行符转换为HTML换行标签
function formatTextWithLineBreaks(content) {
    if (!content) return '-';
    
    const contentStr = content.toString();
    
    // 将换行符转换为<br>标签
    // 处理不同平台的换行符：\n, \r\n, \r
    const withLineBreaks = contentStr
        .replace(/\r\n/g, '<br>')  // Windows换行
        .replace(/\r/g, '<br>')    // Mac旧版换行
        .replace(/\n/g, '<br>');   // Unix/Linux换行
    
    return withLineBreaks;
}

// 打开图片模态框
function openImageModal(imageUrl) {
    // 如果已有模态框，先关闭
    closeImageModal();
    
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-btn" onclick="closeImageModal()">&times;</span>
            <div class="image-container">
                <img src="${imageUrl}" alt="放大图片" id="modal-image">
            </div>
            <div class="image-controls">
                <button class="control-btn" onclick="zoomImage(1.2)" title="放大">🔍+</button>
                <button class="control-btn" onclick="zoomImage(0.8)" title="缩小">🔍-</button>
                <button class="control-btn" onclick="resetImage()" title="重置">↺</button>
                <button class="control-btn" onclick="downloadImage('${imageUrl}')" title="下载">⬇️</button>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    
    // 初始化图片状态
    window.currentImageScale = 1;
    window.isDragging = false;
    window.startX = 0;
    window.startY = 0;
    window.translateX = 0;
    window.translateY = 0;
    
    const image = document.getElementById('modal-image');
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeImageModal();
        }
    });
    
    // 添加图片拖拽功能
    image.addEventListener('mousedown', startDrag);
    image.addEventListener('touchstart', startDragTouch);
    
    // 添加鼠标滚轮缩放
    image.addEventListener('wheel', handleWheel);
    
    // 阻止模态框内容点击关闭
    modal.querySelector('.modal-content').addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // 设置双击重置功能
    image.addEventListener('dblclick', resetImage);
}

// 关闭图片模态框
function closeImageModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) {
        modal.remove();
    }
    // 重置状态
    window.currentImageScale = 1;
    window.isDragging = false;
    window.translateX = 0;
    window.translateY = 0;
}

// 图片缩放
function zoomImage(factor) {
    const image = document.getElementById('modal-image');
    if (!image) return;
    
    window.currentImageScale *= factor;
    // 限制缩放范围
    window.currentImageScale = Math.max(0.2, Math.min(5, window.currentImageScale));
    
    image.style.transform = `scale(${window.currentImageScale}) translate(${window.translateX}px, ${window.translateY}px)`;
    image.style.transformOrigin = 'center center';
}

// 重置图片
function resetImage() {
    const image = document.getElementById('modal-image');
    if (!image) return;
    
    window.currentImageScale = 1;
    window.translateX = 0;
    window.translateY = 0;
    
    image.style.transform = 'scale(1) translate(0px, 0px)';
    image.style.transformOrigin = 'center center';
}

// 下载图片
function downloadImage(url) {
    const link = document.createElement('a');
    link.href = url;
    link.download = '操作截图_' + new Date().getTime() + '.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 鼠标拖拽功能
function startDrag(e) {
    e.preventDefault();
    window.isDragging = true;
    window.startX = e.clientX - window.translateX;
    window.startY = e.clientY - window.translateY;
    
    document.addEventListener('mousemove', dragImage);
    document.addEventListener('mouseup', stopDrag);
}

function startDragTouch(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        window.isDragging = true;
        window.startX = e.touches[0].clientX - window.translateX;
        window.startY = e.touches[0].clientY - window.translateY;
        
        document.addEventListener('touchmove', dragImageTouch);
        document.addEventListener('touchend', stopDrag);
    }
}

function dragImage(e) {
    if (!window.isDragging) return;
    e.preventDefault();
    
    window.translateX = e.clientX - window.startX;
    window.translateY = e.clientY - window.startY;
    
    const image = document.getElementById('modal-image');
    if (image) {
        image.style.transform = `scale(${window.currentImageScale}) translate(${window.translateX}px, ${window.translateY}px)`;
    }
}

function dragImageTouch(e) {
    if (!window.isDragging || e.touches.length !== 1) return;
    e.preventDefault();
    
    window.translateX = e.touches[0].clientX - window.startX;
    window.translateY = e.touches[0].clientY - window.startY;
    
    const image = document.getElementById('modal-image');
    if (image) {
        image.style.transform = `scale(${window.currentImageScale}) translate(${window.translateX}px, ${window.translateY}px)`;
    }
}

function stopDrag() {
    window.isDragging = false;
    document.removeEventListener('mousemove', dragImage);
    document.removeEventListener('touchmove', dragImageTouch);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchend', stopDrag);
}

// 鼠标滚轮缩放
function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomImage(delta);
}

// 双击图片重置
function setupImageDoubleClick() {
    const image = document.getElementById('modal-image');
    if (image) {
        image.addEventListener('dblclick', resetImage);
    }
}

// 初始化图片模态框时设置双击事件
// 修改openImageModal函数，在最后添加：
// setupImageDoubleClick();

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
        tbody.innerHTML = '<tr class="empty-state"><td colspan="9">暂无定投记录</td></tr>';
        return;
    }

    // 计算持仓占比
    const dataWithPercentage = calculateHoldingsPercentage(data);

    tbody.innerHTML = dataWithPercentage.map(row => generateDCATableRow(row)).join('');
}

// 生成持仓表格行HTML
function generateDCATableRow(row) {
    const bgClass = getOperationBackgroundClass(row['操作'] || row['操作']);
    // 累计收益：只使用累计收益列数据，如果没有则显示"-"
    const cumulativeAmount = row['累计收益'];
    // 持仓占比：使用计算出的占比
    const percentage = row._percentage !== undefined ? row._percentage : null;
    // 近6月回报：使用近6月回报数据（支持旧字段名兼容）
    const dailyReturnRaw = row['近6月回报'] || row['参考日回报'] || row['参考日回报/%'] || row['参考日回报%'] || null;
    // 确保 dailyReturn 是字符串，如果是数字则转换为字符串
    const dailyReturn = dailyReturnRaw !== null && dailyReturnRaw !== undefined 
        ? String(dailyReturnRaw) 
        : null;
    const dailyReturnClass = getDailyReturnClass(dailyReturn);
    
    // 灵活获取分类字段，支持多种可能的字段名称
    const category = row['分类'] || row['category'] || row['Category'] || row['类型'] || row['类别'] || '-';
    
    // 解析涨跌幅和日期
    let dailyReturnValue = '-';
    let dailyReturnDate = '';
    
    if (dailyReturn) {
        // 检查是否包含日期信息（格式：+1.23% (01-15)）
        const dateMatch = dailyReturn.match(/\((\d{2}-\d{2})\)$/);
        if (dateMatch) {
            dailyReturnValue = formatDailyReturn(dailyReturn.replace(/\s*\(\d{2}-\d{2}\)$/, ''));
            dailyReturnDate = dateMatch[1]; // 月-日格式
        } else {
            dailyReturnValue = formatDailyReturn(dailyReturn);
        }
    }
    
    return `
    <tr data-fund-code="${row['基金代码'] || ''}">
        <td>${category}</td>
        <td><code class="fund-code">${row['基金代码'] || row['基金代码'] || '-'}</code></td>
        <td>${row['基金名称'] || row['基金名称'] || '-'}</td>
        <td class="daily-return-cell">
            <div class="daily-return-container">
                <span class="daily-return-value ${dailyReturnClass}">${dailyReturnValue}</span>
                ${dailyReturnDate ? `<span class="daily-return-date">${dailyReturnDate}</span>` : ''}
            </div>
        </td>
        <td class="valuation-cell" id="valuation-${row['基金代码'] || ''}">
            <div class="valuation-container">
                <span class="valuation-value">-</span>
                <span class="valuation-date"></span>
            </div>
        </td>
        <td><strong>${formatPercentage(percentage)}</strong></td>
        <td>
            <span class="operation-tag ${bgClass}">
                ${row['操作'] || row['操作'] || '-'}
            </span>
        </td>
        <td>${cumulativeAmount ? formatCurrency(cumulativeAmount) : '-'}</td>
        <td>${row['基金限购'] || row['基金限购'] || '-'}</td>
        <td>${formatTextWithLineBreaks(row['备注'] || row['备注'])}</td>
    </tr>
`;
}

// 渲染主动操作表格
function renderManualTable(data) {
    const tbody = document.getElementById('manual-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="10">暂无定投记录</td></tr>';
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
            <td>${formatTextWithLineBreaks(row['当日留言'] || row['当日留言'])}</td>
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
            <td>${formatTextWithLineBreaks(row['备注'] || row['备注'])}</td>
        </tr>
    `).join('');
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

// 排序表格
function sortTable(column) {
    // 循环切换排序状态：null → 'asc' → 'desc' → null
    if (sortState.column === column) {
        if (sortState.direction === null) {
            sortState.direction = 'asc';
        } else if (sortState.direction === 'asc') {
            sortState.direction = 'desc';
        } else {
            sortState.direction = null;
        }
    } else {
        sortState.column = column;
        sortState.direction = 'asc';
    }
    
    // 更新排序图标
    updateSortIcons();
    
    // 重新渲染当前表格
    if (currentTab === 'dca' && cachedData && cachedData.dca) {
        if (sortState.direction === null) {
            renderDCATable(cachedData.dca);
        } else {
            renderDCATableWithSort(cachedData.dca);
        }
    } else if (currentTab === 'manual' && cachedData && cachedData.dca) {
        // 主动操作表格没有金额列，暂时不处理排序
        console.log('主动操作表格暂不支持排序');
    }
}

// 更新排序图标
function updateSortIcons() {
    // 移除所有排序图标
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.textContent = '↕';
    });
    
    // 设置当前排序列的图标
    if (sortState.column && sortState.direction) {
        const currentHeader = document.querySelector(`th[data-column="${sortState.column}"] .sort-icon`);
        if (currentHeader) {
            currentHeader.textContent = sortState.direction === 'asc' ? '↑' : '↓';
        }
    }
}

// 带排序的渲染定投基金表格
function renderDCATableWithSort(data) {
    const tbody = document.getElementById('dca-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="9">暂无定投记录</td></tr>';
        return;
    }

    // 计算持仓占比
    const dataWithPercentage = calculateHoldingsPercentage(data);

    // 根据当前排序状态排序数据
    let sortedData = [...dataWithPercentage];
    if (sortState.column && sortState.direction) {
        sortedData.sort((a, b) => {
            let valueA, valueB;
            
            if (sortState.column === 'percentage') {
                // 持仓占比排序：使用计算出的占比
                valueA = a._percentage || 0;
                valueB = b._percentage || 0;
            } else if (sortState.column === 'cumulative') {
                // 累计收益排序：只使用累计收益列，如果没有则视为0
                valueA = parseFloat((a['累计收益'] || '0').toString().replace(/[^\d.-]/g, '')) || 0;
                valueB = parseFloat((b['累计收益'] || '0').toString().replace(/[^\d.-]/g, '')) || 0;
            } else if (sortState.column === 'dailyReturn') {
                // 日回报排序：使用近6月回报数据（支持旧字段名兼容）
                const dailyReturnA = a['近6月回报'] || a['参考日回报'] || a['参考日回报/%'] || a['参考日回报%'] || null;
                const dailyReturnB = b['近6月回报'] || b['参考日回报'] || b['参考日回报/%'] || b['参考日回报%'] || null;
                
                // 解析日回报值，如果不是数字则视为0
                valueA = dailyReturnA ? parseFloat(dailyReturnA) || 0 : 0;
                valueB = dailyReturnB ? parseFloat(dailyReturnB) || 0 : 0;
            }
            
            return sortState.direction === 'asc' ? valueA - valueB : valueB - valueA;
        });
    }

    tbody.innerHTML = sortedData.map(row => {
        const bgClass = getOperationBackgroundClass(row['操作'] || row['操作']);
        // 累计收益：只使用累计收益列数据，如果没有则显示"-"
        const cumulativeAmount = row['累计收益'];
        // 持仓占比：使用计算出的占比
        const percentage = row._percentage !== undefined ? row._percentage : null;
        
        // 近6月回报：使用近6月回报数据（支持旧字段名兼容）
        const dailyReturnRaw = row['近6月回报'] || row['参考日回报'] || row['参考日回报/%'] || row['参考日回报%'] || null;
        // 确保 dailyReturn 是字符串，如果是数字则转换为字符串
        const dailyReturn = dailyReturnRaw !== null && dailyReturnRaw !== undefined 
            ? String(dailyReturnRaw) 
            : null;
        const dailyReturnClass = getDailyReturnClass(dailyReturn);
        
        // 灵活获取分类字段，支持多种可能的字段名称
        const category = row['分类'] || row['category'] || row['Category'] || row['类型'] || row['类别'] || '-';
        
        // 解析涨跌幅和日期
        let dailyReturnValue = '-';
        let dailyReturnDate = '';
        
        if (dailyReturn) {
            // 检查是否包含日期信息（格式：+1.23% (01-15)）
            const dateMatch = dailyReturn.match(/\((\d{2}-\d{2})\)$/);
            if (dateMatch) {
                dailyReturnValue = formatDailyReturn(dailyReturn.replace(/\s*\(\d{2}-\d{2}\)$/, ''));
                dailyReturnDate = dateMatch[1]; // 月-日格式
            } else {
                dailyReturnValue = formatDailyReturn(dailyReturn);
            }
        }
        
        return generateDCATableRow(row);
    }).join('');
}

// 显示持仓饼图
function showPieChart() {
    try {
        if (!cachedData || !cachedData.dca) {
            showPieChartError('暂无持仓数据，请先加载数据');
            return;
        }
        
        // 计算各基金的持仓金额
        const fundData = calculateFundAllocation(cachedData.dca);
        
        if (!fundData || fundData.length === 0) {
            showPieChartError('暂无有效持仓数据，请检查数据格式');
            return;
        }
        
        // 检查数据有效性
        const validFunds = fundData.filter(fund => fund.percentage > 0);
        if (validFunds.length === 0) {
            showPieChartError('所有基金的持仓占比都为0，无法生成饼图');
            return;
        }
        
        // 创建饼图弹窗
        createPieChartModal(validFunds);
        
    } catch (error) {
        console.error('显示饼图失败:', error);
        showPieChartError(`生成饼图时出错: ${error.message}`);
    }
}

// 显示饼图错误提示
function showPieChartError(message) {
    // 创建错误提示模态框
    const errorModal = document.createElement('div');
    errorModal.className = 'pie-chart-modal';
    errorModal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h3>⚠️ 无法显示饼图</h3>
                <span class="close-btn" onclick="this.parentElement.parentElement.remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">📊</div>
                    <p style="color: #2c3e50; margin-bottom: 16px;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
                        <button class="refresh-btn" onclick="fetchData(); this.parentElement.parentElement.parentElement.parentElement.remove()">
                            🔄 刷新数据
                        </button>
                        <button class="chart-btn" onclick="this.parentElement.parentElement.parentElement.parentElement.remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.appendChild(errorModal);
    
    // 点击背景关闭
    errorModal.addEventListener('click', function(e) {
        if (e.target === errorModal) {
            errorModal.remove();
        }
    });
}

// 计算操作分类分布（使用持仓占比）
function calculateOperationDistribution(data) {
    const operationMap = new Map();
    
    data.forEach(row => {
        const operation = row['操作'] || '';
        
        // 获取持仓占比
        let percentage = 0;
        
        // 使用计算出的占比
        if (row._percentage !== undefined) {
            percentage = row._percentage;
        }
        
        if (operation && percentage > 0) {
            if (operationMap.has(operation)) {
                const existing = operationMap.get(operation);
                existing.percentage += percentage;
            } else {
                operationMap.set(operation, {
                    operation: operation,
                    percentage: percentage
                });
            }
        }
    });
    
    // 计算总占比并归一化
    const totalPercentage = Array.from(operationMap.values()).reduce((sum, op) => sum + op.percentage, 0);
    const result = Array.from(operationMap.values()).map(op => ({
        ...op,
        percentage: totalPercentage > 0 ? (op.percentage / totalPercentage * 100) : 0
    }));
    
    // 按占比降序排序
    return result.sort((a, b) => b.percentage - a.percentage);
}

// 生成操作分类颜色
function generateOperationColors(count) {
    // 为不同的操作类型分配固定颜色
    const operationColorMap = {
        '买入': '#FF6B6B',
        '卖出': '#4ECDC4', 
        '定投': '#45B7D1',
        '加仓': '#96CEB4',
        '减仓': '#FFEAA7',
        '推荐定投': '#DDA0DD',
        '一般': '#98D8C8',
        '风险较高': '#F7DC6F',
        '暂时别买': '#BB8FCE'
    };
    
    const colors = [];
    const defaultColors = ['#85C1E2', '#F8B739', '#52B788', '#E76F51', '#8E44AD', '#3498DB'];
    
    for (let i = 0; i < count; i++) {
        colors.push(defaultColors[i % defaultColors.length]);
    }
    
    return colors;
}

// 计算基金持仓分配（使用持仓占比）
function calculateFundAllocation(data) {
    const fundMap = new Map();
    
    // 先计算总金额，用于计算占比
    const totalAmount = data.reduce((sum, row) => {
        const amountStr = row['金额'] || '0';
        const amount = parseFloat(amountStr.toString().replace(/[^\d.-]/g, '')) || 0;
        return sum + amount;
    }, 0);
    
    data.forEach(row => {
        const fundName = row['基金名称'] || '';
        const fundCode = row['基金代码'] || '';
        
        if (!fundName) return; // 跳过没有基金名称的行
        
        // 计算该基金的占比
        let percentage = 0;
        
        // 使用金额计算占比
        const amountStr = row['金额'] || '0';
        const amount = parseFloat(amountStr.toString().replace(/[^\d.-]/g, '')) || 0;
        percentage = totalAmount > 0 ? (amount / totalAmount * 100) : 0;
        
        if (percentage > 0) {
            if (fundMap.has(fundName)) {
                const existing = fundMap.get(fundName);
                existing.percentage += percentage;
                existing.count += 1;
            } else {
                fundMap.set(fundName, {
                    name: fundName,
                    code: fundCode,
                    percentage: percentage,
                    count: 1
                });
            }
        }
    });
    
    // 过滤掉占比为0的基金
    const filteredFunds = Array.from(fundMap.values()).filter(fund => fund.percentage > 0);
    
    if (filteredFunds.length === 0) {
        return [];
    }
    
    // 计算总占比并归一化（确保总和为100%）
    const totalPercentage = filteredFunds.reduce((sum, fund) => sum + fund.percentage, 0);
    const result = filteredFunds.map(fund => ({
        name: fund.name,
        code: fund.code,
        percentage: totalPercentage > 0 ? (fund.percentage / totalPercentage * 100) : 0,
        count: fund.count
    }));
    
    // 按占比降序排序
    return result.sort((a, b) => b.percentage - a.percentage);
}

// 创建饼图弹窗 - 新版友好界面
function createPieChartModal(fundData) {
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'pie-chart-modal';
    
    // 生成基金颜色
    const fundColors = generateColors(fundData.length);
    
    // 计算基金饼图路径
    const fundPieSlices = calculatePieSlices(fundData);
    
    // 计算操作分类数据
    const operationData = calculateOperationDistribution(cachedData.dca);
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>📊 基金持仓分布</h3>
                <span class="close-btn" onclick="closePieChartModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="chart-with-legend">
                    <div class="chart-container">
                        <h4>基金持仓分布</h4>
                        <div class="chart-wrapper">
                            <svg width="350" height="350" viewBox="0 0 350 350" class="pie-chart">
                                ${fundPieSlices.map((slice, index) => `
                                    <g class="pie-slice fund-slice" data-index="${index}">
                                        <path d="${slice.path}" 
                                              fill="${fundColors[index]}" stroke="white" stroke-width="2"
                                              onmouseover="showFundTooltip(${index}, event)"
                                              onmouseout="hideFundTooltip()">
                                        </path>
                                    </g>
                                `).join('')}
                                ${fundData.map((fund, index) => {
                                    const labelAngle = fundPieSlices[index].middleAngle;
                                    const labelX = 175 + Math.cos(labelAngle) * 110;
                                    const labelY = 175 + Math.sin(labelAngle) * 110;
                                    return `
                                        <text x="${labelX}" y="${labelY}" text-anchor="middle" 
                                              class="pie-label" fill="white" font-weight="bold" font-size="11">
                                            ${fund.percentage.toFixed(1)}%
                                        </text>
                                    `;
                                }).join('')}
                                <!-- 中心文字 -->
                                <text x="175" y="175" text-anchor="middle" class="center-text" fill="#2c3e50" font-weight="bold" font-size="16">
                                    持仓分布
                                </text>
                                <text x="175" y="195" text-anchor="middle" class="center-subtext" fill="#6c757d" font-size="12">
                                    ${fundData.length} 只基金
                                </text>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="legend-container">
                        <h4>基金明细 <span class="legend-count">(${fundData.length})</span></h4>
                        <div class="legend-scroll">
                            ${fundData.map((fund, index) => `
                                <div class="legend-item" onmouseover="highlightPieSlice(${index})" onmouseout="unhighlightPieSlice()">
                                    <span class="legend-rank">${index + 1}</span>
                                    <span class="legend-color" style="background-color: ${fundColors[index]}"></span>
                                    <div class="legend-info">
                                        <div class="legend-name">${fund.name}</div>
                                        <div class="legend-code">${fund.code}</div>
                                    </div>
                                    <div class="legend-percentage">
                                        <div class="percentage-bar">
                                            <div class="percentage-fill" style="width: ${fund.percentage}%"></div>
                                        </div>
                                        <span class="percentage-value">${fund.percentage.toFixed(1)}%</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="tooltip" id="fund-tooltip" style="display: none;"></div>
    `;
    
    // 添加到页面
    document.body.appendChild(modal);
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closePieChartModal();
        }
    });
}

// 计算持仓均衡度分数
function calculateDiversificationScore(fundData) {
    if (fundData.length <= 1) return '10.0';
    
    // 计算赫芬达尔指数（HHI）
    let hhi = 0;
    fundData.forEach(fund => {
        const share = fund.percentage / 100;
        hhi += share * share;
    });
    
    // 转换为0-10分制（分数越高越均衡）
    const score = 10 * (1 - hhi);
    return score.toFixed(1);
}

// 计算持仓集中度
function calculateConcentration(fundData) {
    if (fundData.length === 0) return '无数据';
    
    const top3Percentage = fundData.slice(0, 3).reduce((sum, fund) => sum + fund.percentage, 0);
    
    if (top3Percentage > 70) return '高度集中';
    if (top3Percentage > 50) return '比较集中';
    if (top3Percentage > 30) return '相对均衡';
    return '非常均衡';
}

// 获取操作类型图标
function getOperationIcon(operation) {
    const op = (operation || '').toLowerCase();
    if (op.includes('买入') || op.includes('加仓')) return '📈';
    if (op.includes('卖出') || op.includes('减仓')) return '📉';
    if (op.includes('定投')) return '💰';
    if (op.includes('推荐')) return '⭐';
    return '📊';
}

// 生成分析建议
function generateAnalysis(fundData) {
    if (fundData.length === 0) {
        return '<p class="analysis-text">暂无持仓数据，请先添加基金记录。</p>';
    }
    
    const topFund = fundData[0];
    const top3Percentage = fundData.slice(0, 3).reduce((sum, fund) => sum + fund.percentage, 0);
    
    let analysis = '';
    
    // 持仓集中度分析
    if (topFund.percentage > 50) {
        analysis += `<p class="analysis-text warning">⚠️ <strong>持仓高度集中</strong>：${topFund.name}占比${topFund.percentage.toFixed(1)}%，建议适当分散风险。</p>`;
    } else if (topFund.percentage > 30) {
        analysis += `<p class="analysis-text info">📊 <strong>持仓相对集中</strong>：前3大基金占比${top3Percentage.toFixed(1)}%，配置较为合理。</p>`;
    } else {
        analysis += `<p class="analysis-text success">✅ <strong>持仓分散良好</strong>：前3大基金占比${top3Percentage.toFixed(1)}%，风险分散较好。</p>`;
    }
    
    // 基金数量分析
    if (fundData.length < 3) {
        analysis += `<p class="analysis-text warning">📈 <strong>基金数量较少</strong>：当前仅持有${fundData.length}只基金，建议增加至3-5只以分散风险。</p>`;
    } else if (fundData.length > 8) {
        analysis += `<p class="analysis-text info">📋 <strong>基金数量较多</strong>：持有${fundData.length}只基金，管理较为复杂，可考虑精简。</p>`;
    } else {
        analysis += `<p class="analysis-text success">🎯 <strong>基金数量适中</strong>：持有${fundData.length}只基金，便于管理和跟踪。</p>`;
    }
    
    // 持仓均衡建议
    const avgPercentage = 100 / fundData.length;
    const unbalancedFunds = fundData.filter(fund => fund.percentage > avgPercentage * 2);
    
    if (unbalancedFunds.length > 0) {
        analysis += `<p class="analysis-text tip">💡 <strong>均衡建议</strong>：${unbalancedFunds.map(f => f.name).join('、')}占比偏高，可考虑调整。</p>`;
    }
    
    return analysis;
}

// 高亮饼图切片
function highlightPieSlice(index) {
    const slices = document.querySelectorAll('.pie-slice');
    if (slices[index]) {
        slices[index].style.opacity = '0.8';
        slices[index].style.transform = 'scale(1.05)';
        slices[index].style.transition = 'all 0.2s ease';
    }
}

// 取消高亮
function unhighlightPieSlice() {
    const slices = document.querySelectorAll('.pie-slice');
    slices.forEach(slice => {
        slice.style.opacity = '1';
        slice.style.transform = 'scale(1)';
    });
}

// 生成颜色数组
function generateColors(count) {
    const baseColors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
        '#F8B739', '#52B788', '#E76F51', '#8E44AD', '#3498DB'
    ];
    
    const colors = [];
    for (let i = 0; i < count; i++) {
        colors.push(baseColors[i % baseColors.length]);
    }
    return colors;
}

// 计算饼图切片路径
function calculatePieSlices(fundData) {
    // 使用百分比计算饼图切片，而不是金额
    const totalPercentage = fundData.reduce((sum, fund) => sum + fund.percentage, 0);
    const slices = [];
    let currentAngle = -Math.PI / 2; // 从顶部开始
    
    fundData.forEach((fund) => {
        const percentage = fund.percentage / totalPercentage;
        const angle = percentage * 2 * Math.PI;
        const endAngle = currentAngle + angle;
        
        // 使用 300x300 坐标系：圆心在 150,150，半径 120
        const startX = 150 + Math.cos(currentAngle) * 120;
        const startY = 150 + Math.sin(currentAngle) * 120;
        const endX = 150 + Math.cos(endAngle) * 120;
        const endY = 150 + Math.sin(endAngle) * 120;
        
        const largeArc = angle > Math.PI ? 1 : 0;
        
        const path = [
            `M 150 150`, // 移动到圆心
            `L ${startX} ${startY}`, // 画线到起点
            `A 120 120 0 ${largeArc} 1 ${endX} ${endY}`, // 画弧到终点
            `Z` // 闭合路径
        ].join(' ');
        
        slices.push({
            path: path,
            startAngle: currentAngle,
            endAngle: endAngle,
            middleAngle: currentAngle + angle / 2
        });
        
        currentAngle = endAngle;
    });
    
    return slices;
}

// 显示操作分类详细信息提示
function showOperationTooltip(index, event) {
    const tooltip = document.getElementById('operation-tooltip');
    if (!tooltip || !cachedData || !cachedData.dca) return;
    
    const operationData = calculateOperationDistribution(cachedData.dca);
    const operation = operationData[index];
    
    if (!operation) return;
    
    // 获取该操作类型的详细记录
    const operationRecords = cachedData.dca.filter(row => 
        (row['操作'] || row['操作']) === operation.operation
    );
    
    const recordsHtml = operationRecords.map(record => `
        <div style="margin: 4px 0; font-size: 12px;">
            <strong>${formatDate(record['日期'] || record['日期'])}</strong>: 
            ${formatCurrency(record['金额'] || record['金额'])} 
            - ${record['基金名称'] || record['基金名称'] || '-'}
        </div>
    `).join('');
    
    tooltip.innerHTML = `
        <div style="padding: 8px;">
            <div style="font-weight: bold; margin-bottom: 4px;">${operation.operation}</div>
            <div>总占比: <strong>${operation.percentage.toFixed(2)}%</strong></div>
            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #eee;">
                <div style="font-size: 11px; color: #666;">操作记录:</div>
                ${recordsHtml}
            </div>
        </div>
    `;
    
    // 定位提示框
    tooltip.style.display = 'block';
    tooltip.style.left = event.pageX + 10 + 'px';
    tooltip.style.top = event.pageY + 10 + 'px';
}

// 隐藏操作分类详细信息提示
function hideOperationTooltip() {
    const tooltip = document.getElementById('operation-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

// 显示基金详细信息提示
function showFundTooltip(index, event) {
    const tooltip = document.getElementById('fund-tooltip');
    if (!tooltip || !cachedData || !cachedData.dca) return;
    
    const fundData = calculateFundAllocation(cachedData.dca);
    const fund = fundData[index];
    
    if (!fund) return;
    
    // 获取该基金的详细记录
    const fundRecords = cachedData.dca.filter(row => 
        (row['基金名称'] || row['基金名称']) === fund.name
    );
    
    const recordsHtml = fundRecords.map(record => `
        <div style="margin: 4px 0; font-size: 12px;">
            <strong>${formatDate(record['日期'] || record['日期'])}</strong>: 
            ${formatCurrency(record['金额'] || record['金额'])} 
            (${record['操作'] || record['操作'] || '-'})
        </div>
    `).join('');
    
    tooltip.innerHTML = `
        <div style="padding: 8px;">
            <div style="font-weight: bold; margin-bottom: 4px;">${fund.name} (${fund.code})</div>
            <div>持仓占比: <strong>${fund.percentage.toFixed(2)}%</strong></div>
            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #eee;">
                <div style="font-size: 11px; color: #666;">操作记录:</div>
                ${recordsHtml}
            </div>
        </div>
    `;
    
    // 定位提示框
    tooltip.style.display = 'block';
    tooltip.style.left = event.pageX + 10 + 'px';
    tooltip.style.top = event.pageY + 10 + 'px';
}

// 隐藏基金详细信息提示
function hideFundTooltip() {
    const tooltip = document.getElementById('fund-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}

// 关闭饼图模态框
function closePieChartModal() {
    const modal = document.querySelector('.pie-chart-modal');
    const fundTooltip = document.getElementById('fund-tooltip');
    const operationTooltip = document.getElementById('operation-tooltip');
    if (modal) {
        modal.remove();
    }
    if (fundTooltip) {
        fundTooltip.remove();
    }
    if (operationTooltip) {
        operationTooltip.remove();
    }
}



// 获取数据
async function fetchData(retryCount = 0) {
    const maxRetries = 3;
    const now = Date.now();
    
    // 显示加载状态
    showLoadingState();
    
    if (cachedData && (now - lastFetchTime) < CACHE_DURATION) {
        console.log('使用缓存数据');
        renderDCATable(cachedData.dca);
        renderManualTable(cachedData.active);
        renderDisclaimer(cachedData.disclaimer);
        hideLoadingState();
        return;
    }

    try {
        updateLoadingProgress(20, '正在连接数据源...');
        const response = await fetch(GOOGLE_SHEET_API_URL);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('数据源不存在 (404)');
            } else if (response.status === 403) {
                throw new Error('访问被拒绝 (403)');
            } else {
                throw new Error(`网络请求失败 (${response.status})`);
            }
        }

        updateLoadingProgress(50, '正在解析数据...');
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

        // 数据验证
        updateLoadingProgress(60, '正在验证数据...');
        validateData({
            dca,
            active,
            disclaimer,
            jsonData
        });

        // 更新缓存
        cachedData = { dca, active, disclaimer, dailyNote };
        lastFetchTime = now;

        // 调试：检查数据结构
        console.log('定投基金数据:', dca);
        if (dca && dca.length > 0) {
            console.log('第一行数据:', dca[0]);
            console.log('第一行的所有字段:', Object.keys(dca[0]));
            // 检查分类字段
            const firstRow = dca[0];
            const possibleCategoryFields = ['分类', 'category', 'Category', '类型', '类别'];
            for (const field of possibleCategoryFields) {
                if (firstRow[field] !== undefined) {
                    console.log(`找到可能的分类字段 "${field}":`, firstRow[field]);
                }
            }
        }
        
        updateLoadingProgress(80, '正在渲染表格...');
        // 渲染
        if (sortState.direction && (sortState.column === 'percentage' || sortState.column === 'cumulative' || sortState.column === 'dailyReturn')) {
            renderDCATableWithSort(dca);
        } else {
            renderDCATable(dca);
        }
        renderManualTable(active);  // 主动操作
        renderDisclaimer(disclaimer);
        
        updateLoadingProgress(100, '加载完成！');
        setTimeout(() => hideLoadingState(), 500);

    } catch (error) {
        console.error('获取数据失败:', error);
        
        // 确保隐藏加载状态
        hideLoadingState();
        
        // 检查是否有缓存数据可以显示
        if (cachedData && (Date.now() - lastFetchTime) < CACHE_DURATION * 24) { // 24倍缓存时间，即2小时内的缓存
            console.log('使用缓存数据作为降级方案');
            renderDCATable(cachedData.dca);
            renderManualTable(cachedData.active);
            renderDisclaimer(cachedData.disclaimer);
            showErrorState(`数据加载失败，显示缓存数据 (${error.message})`);
            return;
        }
        
        // 重试逻辑
        if (retryCount < maxRetries) {
            console.log(`重试中... (${retryCount + 1}/${maxRetries})`);
            setTimeout(() => fetchData(retryCount + 1), 2000 * (retryCount + 1));
            showErrorState(`加载失败，正在重试... (${retryCount + 1}/${maxRetries})`);
        } else {
            // 所有重试都失败，使用本地数据
            console.log('所有重试失败，使用本地备选数据');
            useLocalData();
            showErrorState(`网络连接失败，已显示本地备份数据<br><small>${error.message}</small>`);
        }
    }
}

// 使用本地数据
function useLocalData() {
    console.log('使用本地备选数据');
    
    // 更新缓存
    cachedData = {
        dca: LOCAL_DCA_DATA,
        active: LOCAL_ACTIVE_DATA,
        disclaimer: LOCAL_DISCLAIMER,
        dailyNote: "当前显示本地备份数据，请检查网络连接"
    };
    lastFetchTime = Date.now();
    
    // 渲染本地数据
    if (sortState.direction && (sortState.column === 'percentage' || sortState.column === 'cumulative' || sortState.column === 'dailyReturn')) {
        renderDCATableWithSort(LOCAL_DCA_DATA);
    } else {
        renderDCATable(LOCAL_DCA_DATA);
    }
    renderManualTable(LOCAL_ACTIVE_DATA);
    renderDisclaimer(LOCAL_DISCLAIMER);
    
    // 显示本地数据提示
    showLocalDataNotice();
}

// 显示本地数据提示
function showLocalDataNotice() {
    const notice = document.createElement('div');
    notice.className = 'local-data-notice';
    notice.innerHTML = `
        <div class="notice-content">
            <span class="notice-icon">📡</span>
            <span class="notice-text">当前显示本地备份数据（网络连接失败）</span>
            <button class="notice-retry-btn" onclick="fetchData()">重试连接</button>
            <button class="notice-close-btn" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    // 添加到页面顶部
    const container = document.querySelector('.container');
    if (container) {
        container.insertBefore(notice, container.firstChild);
    }
}

// 显示加载状态
function showLoadingState() {
    const dcaBody = document.getElementById('dca-body');
    const manualBody = document.getElementById('manual-body');
    
    if (dcaBody) {
        dcaBody.innerHTML = `
            <tr class="loading-row"><td colspan="9">
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div class="loading-progress">
                        <span>正在加载数据...</span>
                        <div class="progress-bar">
                            <div class="progress-fill" id="loading-progress"></div>
                        </div>
                        <small id="loading-status">连接数据源...</small>
                    </div>
                </div>
            </td></tr>
        `;
    }
    
    if (manualBody) {
        manualBody.innerHTML = `
            <tr class="loading-row"><td colspan="5">
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div class="loading-progress">
                        <span>正在加载数据...</span>
                        <div class="progress-bar">
                            <div class="progress-fill" id="loading-progress-2"></div>
                        </div>
                        <small id="loading-status-2">连接数据源...</small>
                    </div>
                </div>
            </td></tr>
        `;
    }
}

// 更新加载进度
function updateLoadingProgress(progress, status) {
    const progressBar = document.getElementById('loading-progress');
    const statusText = document.getElementById('loading-status');
    const progressBar2 = document.getElementById('loading-progress-2');
    const statusText2 = document.getElementById('loading-status-2');
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    if (statusText) {
        statusText.textContent = status;
    }
    if (progressBar2) {
        progressBar2.style.width = `${progress}%`;
    }
    if (statusText2) {
        statusText2.textContent = status;
    }
}

// 数据验证函数
function validateData(data) {
    const { dca, active, disclaimer, jsonData } = data;
    const warnings = [];
    const errors = [];
    
    // 检查必要的 sheet 是否存在
    if (!jsonData['定投基金']) {
        warnings.push('缺少"定投基金"工作表，持仓表格将为空');
    }
    
    if (!jsonData['主动操作']) {
        warnings.push('缺少"主动操作"工作表，操作记录将为空');
    }
    
    if (!jsonData['说明']) {
        warnings.push('缺少"说明"工作表，风险提示将为空');
    }
    
    // 检查数据格式
    if (dca && dca.length > 0) {
        const firstRow = dca[0];
        
        // 检查必要的字段
        const requiredFields = ['基金代码', '基金名称', '操作'];
        for (const field of requiredFields) {
            if (firstRow[field] === undefined) {
                warnings.push(`定投基金数据缺少"${field}"字段，可能影响显示`);
            }
        }
        
        // 检查数据质量
        let emptyCodeCount = 0;
        let emptyNameCount = 0;
        
        for (const row of dca) {
            if (!row['基金代码'] || row['基金代码'].trim() === '') {
                emptyCodeCount++;
            }
            if (!row['基金名称'] || row['基金名称'].trim() === '') {
                emptyNameCount++;
            }
        }
        
        if (emptyCodeCount > 0) {
            warnings.push(`${emptyCodeCount}条定投基金记录缺少基金代码`);
        }
        if (emptyNameCount > 0) {
            warnings.push(`${emptyNameCount}条定投基金记录缺少基金名称`);
        }
    }
    
    if (active && active.length > 0) {
        const firstRow = active[0];
        
        // 检查必要的字段
        if (firstRow['操作时间'] === undefined) {
            warnings.push('主动操作数据缺少"操作时间"字段，可能影响排序');
        }
    }
    
    // 输出验证结果
    if (warnings.length > 0) {
        console.warn('数据验证警告:', warnings);
        
        // 只在开发模式下显示警告
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            warnings.forEach(warning => {
                console.warn(`⚠️ ${warning}`);
            });
        }
    }
    
    if (errors.length > 0) {
        console.error('数据验证错误:', errors);
        throw new Error(`数据验证失败: ${errors.join('; ')}`);
    }
    
    return { warnings, errors };
}

// 显示错误状态
function showErrorState(message) {
    const dcaBody = document.getElementById('dca-body');
    const manualBody = document.getElementById('manual-body');
    
    if (dcaBody) {
        dcaBody.innerHTML = `
            <tr class="error-state"><td colspan="9">
                <div class="error-content">
                    <div class="error-icon">⚠️</div>
                    <div class="error-message">${message}</div>
                    <button class="retry-btn" onclick="fetchData()">重试</button>
                </div>
            </td></tr>
        `;
    }
    
    if (manualBody) {
        manualBody.innerHTML = `
            <tr class="error-state"><td colspan="5">
                <div class="error-content">
                    <div class="error-icon">⚠️</div>
                    <div class="error-message">${message}</div>
                    <button class="retry-btn" onclick="fetchData()">重试</button>
                </div>
            </td></tr>
        `;
    }
}

// 隐藏加载状态
function hideLoadingState() {
    const dcaBody = document.getElementById('dca-body');
    const manualBody = document.getElementById('manual-body');
    
    // 检查是否还在显示加载状态，如果是则清除
    if (dcaBody && dcaBody.querySelector('.loading-row')) {
        // 如果数据还未渲染，显示空状态
        if (!cachedData || !cachedData.dca || cachedData.dca.length === 0) {
            dcaBody.innerHTML = '<tr class="empty-state"><td colspan="9">暂无数据</td></tr>';
        }
    }
    
    if (manualBody && manualBody.querySelector('.loading-row')) {
        // 如果数据还未渲染，显示空状态
        if (!cachedData || !cachedData.active || cachedData.active.length === 0) {
            manualBody.innerHTML = '<tr class="empty-state"><td colspan="5">暂无数据</td></tr>';
        }
    }
}

// ============================================
// 收益记录功能
// ============================================

// 生成收益记录数据（完全匹配用户提供的表格数据）
function generateProfitData() {
    // 完全按照用户提供的表格数据
    return [
        { time: '2025', profitRanking: 'https://s3.bmp.ovh/2026/02/03/f8JXr345.png', totalProfit: 18000 },
        { time: '202601', profitRanking: 'https://s3.bmp.ovh/2026/02/02/kKXYJUHw.png', totalProfit: 5844 },
        { time: '202602', profitRanking: '-', totalProfit: '-' },
        { time: '202603', profitRanking: '-', totalProfit: '-' },
        { time: '202604', profitRanking: '-', totalProfit: '-' },
        { time: '202605', profitRanking: '-', totalProfit: '-' },
        { time: '202606', profitRanking: '-', totalProfit: '-' },
        { time: '202607', profitRanking: '-', totalProfit: '-' },
        { time: '202608', profitRanking: '-', totalProfit: '-' },
        { time: '202609', profitRanking: '-', totalProfit: '-' },
        { time: '202610', profitRanking: '-', totalProfit: '-' },
        { time: '202611', profitRanking: '-', totalProfit: '-' },
        { time: '202612', profitRanking: '-', totalProfit: '-' }
    ];
}

// 收益记录数据（完全匹配用户提供的表格数据）
const profitRecordData = generateProfitData();

// 显示收益记录模态框
function showProfitRecord() {
    try {
        if (!profitRecordData || profitRecordData.length === 0) {
            showProfitRecordError('暂无收益记录数据');
            return;
        }
        
        // 创建收益记录模态框
        createProfitRecordModal(profitRecordData);
        
    } catch (error) {
        console.error('显示收益记录失败:', error);
        showProfitRecordError(`显示收益记录时出错: ${error.message}`);
    }
}

// 显示收益记录错误提示
function showProfitRecordError(message) {
    // 创建错误提示模态框
    const errorModal = document.createElement('div');
    errorModal.className = 'profit-record-modal';
    errorModal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h3>⚠️ 无法显示收益记录</h3>
                <span class="close-btn" onclick="this.parentElement.parentElement.remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">📈</div>
                    <p style="color: #2c3e50; margin-bottom: 16px;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
                        <button class="chart-btn" onclick="this.parentElement.parentElement.parentElement.parentElement.remove()">关闭</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(errorModal);
}

// 创建收益记录模态框
function createProfitRecordModal(profitData) {
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'profit-record-modal';
    
    // 格式化时间显示（完全按照表格内容显示）
    const formatTimeDisplay = (timeValue) => {
        // 直接返回原始值，不做任何格式化
        return timeValue;
    };
    
    // 格式化收益显示（支持数字和"-"）
    const formatProfitDisplay = (profitValue) => {
        if (profitValue === '-') return '-';
        if (typeof profitValue === 'number') {
            return profitValue.toLocaleString('zh-CN');
        }
        // 如果是字符串形式的数字，尝试转换
        const num = parseFloat(profitValue);
        if (!isNaN(num)) {
            return num.toLocaleString('zh-CN');
        }
        // 其他情况返回原始值
        return profitValue;
    };
    
    // 格式化收益排序显示（支持文字+图片混合内容）
    const formatRankingDisplay = (rankingValue, timeValue) => {
        if (rankingValue === '-') return '-';
        
        // 检查是否是图片URL
        const isImageUrl = rankingValue && 
                          (rankingValue.startsWith('http://') || 
                           rankingValue.startsWith('https://') ||
                           rankingValue.startsWith('//')) &&
                          (rankingValue.includes('.png') || 
                           rankingValue.includes('.jpg') || 
                           rankingValue.includes('.jpeg') ||
                           rankingValue.includes('.gif') ||
                           rankingValue.includes('.webp'));
        
        if (isImageUrl) {
            // 是图片URL，显示图片
            // 使用安全的HTML构建方式，避免引号问题
            const safeRankingValue = rankingValue.replace(/'/g, "\\'");
            const safeTimeValue = timeValue.replace(/'/g, "\\'");
            
            return `
                <div class="image-cell">
                    <img src="${safeRankingValue}" alt="${safeTimeValue}收益排序图" loading="lazy" 
                         onclick="openProfitImageModal('${safeRankingValue}', '${safeTimeValue}')"
                         onerror="handleImageError(this)">
                </div>
            `;
        } else {
            // 是文字内容，直接显示
            return `<span class="ranking-text">${rankingValue}</span>`;
        }
    };
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>📋 月度收益明细</h3>
                <span class="close-btn" onclick="closeProfitRecordModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="table-container">
                    <table class="profit-table">
                        <thead>
                            <tr>
                                <th>时间</th>
                                <th>收益排序</th>
                                <th>总收益</th>
                            </tr>
                        </thead>
                                <tbody>
                                    ${profitData.map(record => {
                                        // 判断收益是否是正数（用于样式）
                                        const isPositive = typeof record.totalProfit === 'number' && record.totalProfit > 0;
                                        const isNegative = typeof record.totalProfit === 'number' && record.totalProfit < 0;
                                        const profitClass = isPositive ? 'profit-positive' : isNegative ? 'profit-negative' : '';
                                        
                                        return `
                                        <tr>
                                            <td class="time-cell">${formatTimeDisplay(record.time)}</td>
                                            <td class="ranking-cell">
                                                ${formatRankingDisplay(record.profitRanking, record.time)}
                                            </td>
                                            <td class="profit-cell ${profitClass}">
                                                ${formatProfitDisplay(record.totalProfit)}
                                            </td>
                                        </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeProfitRecordModal();
        }
    });
}

// 生成收益分析
function generateProfitAnalysis(profitData) {
    if (profitData.length === 0) {
        return '<p class="analysis-text info">暂无收益数据可供分析</p>';
    }
    
    const validProfits = profitData.filter(p => p.totalProfit !== 0);
    const totalProfit = validProfits.reduce((sum, p) => sum + p.totalProfit, 0);
    const avgProfit = totalProfit / validProfits.length;
    const maxProfit = Math.max(...validProfits.map(p => p.totalProfit));
    const minProfit = Math.min(...validProfits.map(p => p.totalProfit));
    
    let analysis = '';
    
    // 总体收益分析
    if (totalProfit > 0) {
        analysis += `<p class="analysis-text success">✅ <strong>总体盈利</strong>：累计收益 ${totalProfit.toLocaleString('zh-CN')} 元，表现良好。</p>`;
    } else if (totalProfit < 0) {
        analysis += `<p class="analysis-text warning">⚠️ <strong>总体亏损</strong>：累计亏损 ${Math.abs(totalProfit).toLocaleString('zh-CN')} 元，需关注风险。</p>`;
    } else {
        analysis += `<p class="analysis-text info">📊 <strong>收支平衡</strong>：累计收益为0，保持稳健。</p>`;
    }
    
    // 收益稳定性分析
    const profitRange = maxProfit - minProfit;
    if (profitRange > avgProfit * 2) {
        analysis += `<p class="analysis-text warning">📈 <strong>收益波动较大</strong>：最高收益 ${maxProfit.toLocaleString('zh-CN')} 元，最低收益 ${minProfit.toLocaleString('zh-CN')} 元，波动性较高。</p>`;
    } else {
        analysis += `<p class="analysis-text success">🎯 <strong>收益相对稳定</strong>：月度收益在合理范围内波动。</p>`;
    }
    
    // 最近月份分析
    const latestRecord = profitData[profitData.length - 1];
    if (latestRecord.totalProfit > 0) {
        analysis += `<p class="analysis-text success">📅 <strong>最近月份盈利</strong>：${formatTime(latestRecord.time)} 收益 ${latestRecord.totalProfit.toLocaleString('zh-CN')} 元。</p>`;
    } else if (latestRecord.totalProfit < 0) {
        analysis += `<p class="analysis-text warning">📅 <strong>最近月份亏损</strong>：${formatTime(latestRecord.time)} 亏损 ${Math.abs(latestRecord.totalProfit).toLocaleString('zh-CN')} 元。</p>`;
    }
    
    return analysis;
}

// 格式化时间显示（辅助函数）
function formatTime(timeStr) {
    if (timeStr.length === 6) {
        const year = timeStr.substring(0, 4);
        const month = timeStr.substring(4, 6);
        return `${year}年${month}月`;
    }
    return timeStr;
}

// 关闭收益记录模态框
function closeProfitRecordModal() {
    const modal = document.querySelector('.profit-record-modal');
    if (modal) {
        modal.remove();
    }
}

// 打开收益记录图片模态框（复用主动卖出页的图片模态框功能）
function openProfitImageModal(imageUrl, title) {
    // 使用现有的openImageModal函数，但添加标题
    openImageModal(imageUrl);
    
    // 添加标题到模态框
    setTimeout(() => {
        const modal = document.querySelector('.image-modal');
        if (modal) {
            const modalContent = modal.querySelector('.modal-content');
            if (modalContent) {
                // 添加标题
                const titleElement = document.createElement('div');
                titleElement.className = 'profit-image-title';
                titleElement.innerHTML = `
                    <div style="color: white; text-align: center; padding: 10px; background: rgba(0,0,0,0.7);">
                        <h4 style="margin: 0; font-size: 1rem;">${title} - 收益排序图</h4>
                    </div>
                `;
                modalContent.insertBefore(titleElement, modalContent.firstChild);
            }
        }
    }, 10);
}

// 图片错误处理函数
function handleImageError(imgElement) {
    try {
        // 创建错误占位符
        const errorDiv = document.createElement('div');
        errorDiv.className = 'image-error-placeholder';
        errorDiv.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 50px;
            height: 30px;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            color: #6c757d;
            font-size: 12px;
            cursor: default;
        `;
        
        // 添加错误图标和文本
        errorDiv.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 14px; margin-bottom: 2px;">📷</div>
                <div>加载失败</div>
            </div>
        `;
        
        // 替换图片元素
        if (imgElement.parentNode) {
            imgElement.parentNode.replaceChild(errorDiv, imgElement);
        }
    } catch (error) {
        console.error('图片错误处理失败:', error);
        // 如果替换失败，至少隐藏图片
        if (imgElement) {
            imgElement.style.display = 'none';
        }
    }
}

// 文本换行处理函数
function formatTextWithLineBreaks(text) {
    if (!text) return '';
    
    // 将各种换行符统一转换为HTML换行标签
    return text
        .replace(/\r\n/g, '<br>')  // Windows换行
        .replace(/\r/g, '<br>')    // Mac换行
        .replace(/\n/g, '<br>');   // Unix/Linux换行
}

// ==================== 实时刷新涨跌幅功能 ====================

// 显示刷新状态提示
function showRefreshStatus(message, type = 'info') {
    // 移除现有的状态提示
    const existingStatus = document.getElementById('refresh-status');
    if (existingStatus) {
        existingStatus.remove();
    }
    
    // 创建新的状态提示
    const statusDiv = document.createElement('div');
    statusDiv.id = 'refresh-status';
    statusDiv.className = `refresh-status ${type}`;
    statusDiv.innerHTML = `
        <span class="status-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span class="status-message">${message}</span>
    `;
    
    document.body.appendChild(statusDiv);
    
    // 3秒后自动隐藏
    setTimeout(() => {
        statusDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (statusDiv.parentNode) {
                statusDiv.remove();
            }
        }, 300);
    }, 3000);
}

// 更新单个基金的估值显示
function updateFundValuation(fundCode, valuationData) {
    // 首先尝试通过ID查找估值单元格
    let valuationCell = document.getElementById(`valuation-${fundCode}`);
    
    // 如果通过ID找不到，尝试通过行数据查找
    if (!valuationCell) {
        const row = document.querySelector(`tr[data-fund-code="${fundCode}"]`);
        if (row) {
            // 明确选择第5列的估值单元格（当日估值列）
            // 使用更精确的选择器：先找到所有td，然后选择第5个（索引4）
            const cells = row.querySelectorAll('td');
            if (cells.length >= 5) {
                valuationCell = cells[4]; // 第5列是当日估值
                
                // 验证这确实是估值单元格
                if (!valuationCell.classList.contains('valuation-cell')) {
                    console.warn(`基金 ${fundCode} 的第5列不是估值单元格，尝试查找.valuation-cell`);
                    valuationCell = row.querySelector('td.valuation-cell');
                }
            }
        }
    }
    
    if (!valuationCell) {
        console.error(`找不到基金 ${fundCode} 的估值单元格`);
        return;
    }
    
    // 验证找到的是正确的单元格
    if (!valuationCell.classList.contains('valuation-cell')) {
        console.error(`找到的单元格不是估值单元格:`, valuationCell);
        return;
    }
    
    const { value, date, className, isEstimated, rawData } = valuationData;
    
    // 生成数据源指示器
    let sourceIndicator = '';
    if (rawData && rawData.source) {
        sourceIndicator = `<span class="data-source-indicator data-source-${rawData.source}"></span>`;
    }
    
    // 生成估值标识
    let valuationTypeClass = className || '';
    if (isEstimated) {
        valuationTypeClass += ' valuation-estimated';
    } else if (rawData && rawData.isUSFund) {
        valuationTypeClass += ' valuation-official';
    }
    
    valuationCell.innerHTML = `
        <div class="valuation-container">
            <span class="valuation-value ${valuationTypeClass}">${value}</span>
            ${date ? `<span class="valuation-date">${date}</span>` : ''}
            ${sourceIndicator}
        </div>
    `;
    
    // 为美股基金添加行标识
    if (rawData && rawData.isUSFund) {
        const row = valuationCell.closest('tr');
        if (row) {
            row.setAttribute('data-fund-type', 'us');
        }
    }
    
    console.log(`✅ 更新基金 ${fundCode} 估值: ${value} (源:${rawData?.source || '未知'})`);
}

// 更新单个基金的涨跌幅显示
function updateFundDailyReturn(fundCode, dailyReturnData) {
    const rows = document.querySelectorAll('#dca-body tr[data-fund-code]');
    
    for (const row of rows) {
        const rowFundCode = row.getAttribute('data-fund-code');
        if (rowFundCode === fundCode) {
            // 明确选择第4列的日回报单元格（近6月回报列）
            const cells = row.querySelectorAll('td');
            let returnCell = null;
            
            if (cells.length >= 4) {
                returnCell = cells[3]; // 第4列是近6月回报
                
                // 验证这确实是日回报单元格
                if (!returnCell.classList.contains('daily-return-cell')) {
                    console.warn(`基金 ${fundCode} 的第4列不是日回报单元格，尝试查找.daily-return-cell`);
                    returnCell = row.querySelector('td.daily-return-cell');
                }
            } else {
                returnCell = row.querySelector('td.daily-return-cell');
            }
            
            if (returnCell) {
                // 额外验证：确保不是估值单元格
                if (returnCell.classList.contains('valuation-cell')) {
                    console.error(`错误：找到的单元格是估值单元格而不是日回报单元格`);
                    return;
                }
                
                const { value, date, className, rawData } = dailyReturnData;
                
                // 生成数据源指示器
                let sourceIndicator = '';
                if (rawData && rawData.source) {
                    sourceIndicator = `<span class="data-source-indicator data-source-${rawData.source}"></span>`;
                }
                
                returnCell.innerHTML = `
                    <div class="daily-return-container">
                        <span class="daily-return-value ${className}">${value}</span>
                        ${date ? `<span class="daily-return-date">${date}</span>` : ''}
                        ${sourceIndicator}
                    </div>
                `;
                
                // 为美股基金添加行标识
                if (rawData && rawData.isUSFund) {
                    row.setAttribute('data-fund-type', 'us');
                }
                
                console.log(`✅ 更新基金 ${fundCode} 日回报: ${value} (源:${rawData?.source || '未知'})`);
            } else {
                console.error(`找不到基金 ${fundCode} 的日回报单元格`);
            }
            break;
        }
    }
}

// 从东方财富API获取基金涨跌幅和估值
async function fetchFundDailyReturnFromAPI(fundCode) {
    try {
        // 优先使用天天基金网的涨跌幅接口（返回百分比）
        const result = await fetchFromTiantianFund(fundCode);
        return result;
    } catch (error) {
        console.error(`获取基金 ${fundCode} 数据失败:`, error);
        return {
            success: false,
            error: error.message,
            value: 'N/A',
            date: '',
            className: '',
            rawData: null
        };
    }
}

// 东方财富基金数据获取函数
async function fetchFromEastMoney(fundCode) {
    try {
        // 东方财富基金实时估值接口
        const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f13,f14,f2,f4,f152,f15&secids=0.${fundCode}&ut=fa5fd1943c7b386f172d6893dbfba10b`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://fund.eastmoney.com/',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.data || !data.data.diff || data.data.diff.length === 0) {
            // 如果东方财富没有数据，尝试备用接口（天天基金网）
            return await fetchFromTiantianFund(fundCode);
        }

        const fundData = data.data.diff[0];
        
        // 解析数据
        const changePercent = parseFloat(fundData.f3); // 涨跌幅
        const currentPrice = parseFloat(fundData.f2); // 当前价格
        const preClose = parseFloat(fundData.f4); // 昨收价
        const updateTime = fundData.f152; // 更新时间
        const fundName = fundData.f14; // 基金名称
        
        // 判断是否为美股基金
        const isUSFund = await isUSStockFund(fundCode, fundName);
        
        // 格式化涨跌幅
        let displayValue = 'N/A';
        let className = '';
        
        if (!isNaN(changePercent)) {
            displayValue = (changePercent >= 0 ? '+' : '') + changePercent.toFixed(2) + '%';
            className = changePercent >= 0 ? 'positive' : 'negative';
        }

        // 格式化时间
        let displayTime = '';
        if (updateTime) {
            const timeStr = updateTime.toString();
            if (timeStr.length >= 8) {
                displayTime = `${timeStr.substring(0,4)}-${timeStr.substring(4,6)}-${timeStr.substring(6,8)}`;
            }
        }

        return {
            success: true,
            value: displayValue,
            date: displayTime,
            className: className,
            rawData: {
                changePercent,
                currentPrice,
                preClose,
                updateTime,
                fundName,
                isUSFund,
                source: 'eastmoney'
            }
        };

    } catch (error) {
        console.warn(`东方财富接口失败，尝试备用接口: ${error.message}`);
        // 备用方案：使用天天基金网
        return await fetchFromTiantianFund(fundCode);
    }
}

// 备用接口：天天基金网
async function fetchFromTiantianFund(fundCode) {
    try {
        const result = await jsonpManager.request(fundCode, 'dailyReturn');
        
        // 判断是否为美股基金（仅根据代码）
        const isUSFund = await isUSStockFund(fundCode, '');
        
        return {
            ...result,
            rawData: {
                ...result.rawData,
                isUSFund,
                source: 'tiantianfund'
            }
        };
    } catch (error) {
        throw error;
    }
}

// JSONP管理器 - 处理多个并发JSONP请求
const jsonpManager = {
    requests: new Map(),
    requestId: 0,
    
    // 发起JSONP请求
    request(fundCode, type = 'valuation') {
        return new Promise((resolve, reject) => {
            const requestId = ++this.requestId;
            let script = null;
            let timeoutId = null;
            
            // 保存请求信息
            this.requests.set(requestId, {
                resolve,
                reject,
                fundCode,
                type
            });
            
            try {
                // 保存原始jsonpgz函数
                if (!window._originalJsonpgz) {
                    window._originalJsonpgz = window.jsonpgz;
                }
                
                // 重写全局jsonpgz函数
                window.jsonpgz = (data) => {
                    // 查找对应的请求
                    const request = this.requests.get(requestId);
                    if (!request) return;
                    
                    // 清理
                    this.cleanup(requestId, script, timeoutId);
                    
                    if (!data) {
                        request.reject(new Error('无数据'));
                        return;
                    }
                    
                    // 根据请求类型处理数据
                    if (request.type === 'valuation') {
                        this.handleValuationData(request, data);
                    } else {
                        this.handleDailyReturnData(request, data);
                    }
                };
                
                // 创建script标签
                const url = `https://fundgz.1234567.com.cn/js/${fundCode}.js?_=${Date.now()}`;
                script = document.createElement('script');
                script.src = url;
                script.type = 'text/javascript';
                
                // 错误处理
                script.onerror = (error) => {
                    const request = this.requests.get(requestId);
                    if (request) {
                        this.cleanup(requestId, script, timeoutId);
                        request.reject(new Error(`JSONP加载失败: ${error.message}`));
                    }
                };
                
                // 设置超时
                timeoutId = setTimeout(() => {
                    const request = this.requests.get(requestId);
                    if (request) {
                        this.cleanup(requestId, script, timeoutId);
                        request.reject(new Error('JSONP请求超时'));
                    }
                }, 10000); // 10秒超时
                
                // 添加到页面
                document.head.appendChild(script);
                
            } catch (error) {
                this.cleanup(requestId, script, timeoutId);
                reject(error);
            }
        });
    },
    
    // 清理资源
    cleanup(requestId, script, timeoutId) {
        // 移除script标签
        if (script && script.parentNode) {
            document.head.removeChild(script);
        }
        
        // 清除超时
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        
        // 移除请求记录
        this.requests.delete(requestId);
        
        // 如果没有其他请求，恢复原始函数
        if (this.requests.size === 0 && window._originalJsonpgz) {
            window.jsonpgz = window._originalJsonpgz;
            delete window._originalJsonpgz;
        }
    },
    
    // 处理估值数据 - 使用gszzl（估算增长率）作为日估值
    handleValuationData(request, data) {
        const gszzl = data.gszzl; // 估算增长率，如 "+0.90" 或 "-0.50"
        const gztime = data.gztime; // 估算时间，如 "2024-01-15 15:00"
        const dwjz = data.dwjz; // 单位净值（昨日），如 "1.2300"
        const jzrq = data.jzrq; // 净值日期，如 "2024-01-14"
        
        // 如果没有估值数据，返回成功但显示 "-"（某些基金如C类可能没有实时估值）
        if (!gszzl || gszzl === '' || gszzl === 'null') {
            request.resolve({
                success: true,
                value: '-',
                date: '',
                navDate: '',
                className: 'valuation-normal',
                rawData: data,
                isEstimated: false
            });
            return;
        }
        
        // 直接使用返回的估算值，保留小数点后两位
        let formattedValue = gszzl;
        
        // 确保有百分号
        if (!formattedValue.includes('%')) {
            formattedValue = formattedValue + '%';
        }
        
        // 确保有正负号
        if (!formattedValue.startsWith('+') && !formattedValue.startsWith('-')) {
            const numValue = parseFloat(formattedValue);
            if (!isNaN(numValue)) {
                formattedValue = (numValue >= 0 ? '+' : '') + formattedValue;
            }
        }
        
        // 提取日期信息（月-日格式）
        let dateStr = '';
        if (gztime) {
            const dateMatch = gztime.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (dateMatch) {
                // 格式化为 月-日，如 "01-15"
                dateStr = `${dateMatch[2]}-${dateMatch[3]}`;
            }
        }
        
        // 提取净值日期（月-日格式）
        let navDateStr = '';
        if (jzrq) {
            const navDateMatch = jzrq.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (navDateMatch) {
                navDateStr = `${navDateMatch[2]}-${navDateMatch[3]}`;
            }
        }
        
        // 确定样式类：正数红色，负数绿色
        const numValue = parseFloat(gszzl);
        let className = 'valuation-normal';
        if (!isNaN(numValue)) {
            if (numValue > 0) {
                className = 'valuation-positive'; // 红色
            } else if (numValue < 0) {
                className = 'valuation-negative'; // 绿色
            }
        }
        
        request.resolve({
            success: true,
            value: formattedValue,
            date: dateStr, // 估值更新日期（月-日）
            navDate: navDateStr, // 净值日期（月-日）
            className: className,
            rawData: data,
            // 额外信息
            yesterdayNav: dwjz ? parseFloat(dwjz).toFixed(2) : null,
            isEstimated: true // 标记为估算值
        });
    },
    
    // 处理涨跌幅数据
    handleDailyReturnData(request, data) {
        const gszzl = data.gszzl; // 估算增长率，如 "+0.90"
        const gztime = data.gztime; // 估算时间，如 "2024-01-15 15:00"
        
        // 如果没有涨跌幅数据，返回成功但显示 "-"
        if (!gszzl || gszzl === '' || gszzl === 'null') {
            request.resolve({
                success: true,
                value: '-',
                date: '',
                className: '',
                rawData: data
            });
            return;
        }
        
        // 格式化涨跌幅
        let formattedValue = gszzl;
        if (!formattedValue.includes('%')) {
            formattedValue = formattedValue + '%';
        }
        
        // 确保有正负号
        if (!formattedValue.startsWith('+') && !formattedValue.startsWith('-')) {
            const numValue = parseFloat(formattedValue);
            if (!isNaN(numValue)) {
                formattedValue = (numValue >= 0 ? '+' : '') + formattedValue;
            }
        }
        
        // 提取日期（月-日格式）
        let dateStr = '';
        if (gztime) {
            const dateMatch = gztime.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (dateMatch) {
                // 格式化为 月-日，如 "01-15"
                dateStr = `${dateMatch[2]}-${dateMatch[3]}`;
            }
        }
        
        // 确定样式类
        const numValue = parseFloat(gszzl);
        const className = !isNaN(numValue) ? 
            (numValue > 0 ? 'daily-return-positive' : numValue < 0 ? 'daily-return-negative' : '') : '';
        
        request.resolve({
            success: true,
            value: formattedValue,
            date: dateStr,
            className: className,
            rawData: data
        });
    }
};

// 获取基金估值（优化版，支持美股基金）
async function fetchFundValuationFromAPI(fundCode) {
    try {
        // 优先使用天天基金网的估值接口（返回涨跌幅百分比）
        const result = await fetchValuationFromTiantianFund(fundCode);
        return result;
    } catch (error) {
        console.error(`获取基金 ${fundCode} 估值失败:`, error);
        return {
            success: false,
            error: error.message,
            value: 'N/A',
            date: '',
            navDate: '',
            className: 'valuation-error',
            isEstimated: false
        };
    }
}

// 从东方财富获取基金详细信息和净值
async function fetchFundDetailFromEastMoney(fundCode) {
    try {
        // 东方财富基金净值接口
        const netValueUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f4,f12,f13,f14,f15,f152&secids=0.${fundCode}&ut=fa5fd1943c7b386f172d6893dbfba10b`;
        
        const response = await fetch(netValueUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://fund.eastmoney.com/',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.data || !data.data.diff || data.data.diff.length === 0) {
            // 备用方案
            return await fetchValuationFromTiantianFund(fundCode);
        }

        const fundData = data.data.diff[0];
        
        // 解析数据
        const currentPrice = parseFloat(fundData.f2); // 当前净值/价格
        const changePercent = parseFloat(fundData.f3); // 涨跌幅
        const preClose = parseFloat(fundData.f4); // 昨日收盘净值
        const updateTime = fundData.f152; // 更新时间
        const fundName = fundData.f14; // 基金名称
        
        // 判断是否为美股基金（QDII）
        const isUSFund = await isUSStockFund(fundCode, fundName);
        
        let displayValue = 'N/A';
        let displayDate = '';
        let isEstimated = false;
        let className = 'valuation-normal';

        if (!isNaN(currentPrice) && currentPrice > 0) {
            displayValue = currentPrice.toFixed(4);
            
            // 格式化时间
            if (updateTime) {
                const timeStr = updateTime.toString();
                if (timeStr.length >= 8) {
                    displayDate = `${timeStr.substring(4,6)}-${timeStr.substring(6,8)}`;
                }
            }
            
            // 对于美股基金，添加特殊标识
            if (isUSFund) {
                // 检查是否为实时估值还是昨日净值
                const now = new Date();
                const currentHour = now.getHours();
                
                // 如果是工作日的交易时间，可能是估值
                if (currentHour >= 9 && currentHour <= 15) {
                    isEstimated = true;
                    className = 'valuation-estimated';
                } else {
                    className = 'valuation-official';
                }
            }
            
            // 根据涨跌幅设置颜色
            if (!isNaN(changePercent)) {
                if (changePercent > 0) {
                    className += ' positive';
                } else if (changePercent < 0) {
                    className += ' negative';
                }
            }
        }

        return {
            success: true,
            value: displayValue,
            date: displayDate,
            navDate: displayDate,
            className: className,
            isEstimated: isEstimated,
            rawData: {
                currentPrice,
                changePercent,
                preClose,
                updateTime,
                fundName,
                isUSFund,
                source: 'eastmoney'
            }
        };

    } catch (error) {
        console.warn(`东方财富净值接口失败，尝试备用接口: ${error.message}`);
        return await fetchValuationFromTiantianFund(fundCode);
    }
}

// 判断是否为美股基金
async function isUSStockFund(fundCode, fundName = '') {
    // 常见的美股/QDII基金关键字
    const usKeywords = [
        '纳斯达克', 'NASDAQ', '纳指', '标普', 'S&P', 'SP500',
        '美国', '美股', 'QDII', '海外', '恒生', '港股',
        '中概互联', '互联网', '科技ETF', '芯片ETF'
    ];
    
    // 常见的美股基金代码范围
    const usCodeRanges = [
        { start: 160000, end: 163000 }, // 南方基金QDII系列
        { start: 270000, end: 275000 }, // 广发基金QDII系列
        { start: 513000, end: 515000 }, // 部分美股ETF
    ];
    
    const code = parseInt(fundCode);
    
    // 检查代码范围
    for (const range of usCodeRanges) {
        if (code >= range.start && code <= range.end) {
            return true;
        }
    }
    
    // 检查基金名称
    if (fundName) {
        for (const keyword of usKeywords) {
            if (fundName.includes(keyword)) {
                return true;
            }
        }
    }
    
    return false;
}

// 备用接口：天天基金网估值
async function fetchValuationFromTiantianFund(fundCode) {
    try {
        const result = await jsonpManager.request(fundCode, 'valuation');
        
        // 判断是否为美股基金（仅根据代码）
        const isUSFund = await isUSStockFund(fundCode, '');
        
        return {
            ...result,
            rawData: {
                ...result.rawData,
                isUSFund,
                source: 'tiantianfund'
            }
        };
    } catch (error) {
        throw error;
    }
}

// 刷新所有基金的涨跌幅
async function refreshDailyReturns() {
    const refreshBtn = document.querySelector('.refresh-btn');
    const badge = document.getElementById('refresh-badge');
    
    // 防止重复点击 - 使用全局锁和按钮状态双重检查
    if (window.isRefreshingDailyReturns) {
        console.log('日回报刷新正在进行中，请稍候...');
        return;
    }
    
    if (refreshBtn.classList.contains('loading')) {
        console.log('刷新按钮处于加载状态，忽略点击');
        return;
    }
    
    // 设置全局锁和加载状态
    window.isRefreshingDailyReturns = true;
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    
    showRefreshStatus('正在获取最新涨跌幅数据...', 'info');
    
    try {
        // 获取所有基金代码
        const fundRows = document.querySelectorAll('#dca-body tr[data-fund-code]');
        const fundCodes = [];
        
        for (const row of fundRows) {
            const fundCode = row.getAttribute('data-fund-code');
            const codeElement = row.querySelector('.fund-code');
            const codeText = codeElement ? codeElement.textContent.trim() : '';
            
            // 只处理有效的6位基金代码
            if (fundCode && /^\d{6}$/.test(fundCode) && codeText !== '-') {
                fundCodes.push(fundCode);
            }
        }
        
        if (fundCodes.length === 0) {
            showRefreshStatus('未找到有效的基金代码', 'error');
            return;
        }
        
        showRefreshStatus(`正在更新 ${fundCodes.length} 个基金...`, 'info');
        
        let successCount = 0;
        let failCount = 0;
        
        // 逐个获取基金数据（避免同时请求过多）
        for (let i = 0; i < fundCodes.length; i++) {
            const fundCode = fundCodes[i];
            
            try {
                // 显示进度
                if (badge) {
                    badge.textContent = `${i + 1}/${fundCodes.length}`;
                    badge.style.display = 'inline-block';
                }
                
                // 获取数据
                const result = await fetchFundDailyReturnFromAPI(fundCode);
                
                if (result.success) {
                    // 更新显示
                    updateFundDailyReturn(fundCode, {
                        value: result.value,
                        date: result.date,
                        className: result.className,
                        rawData: result.rawData
                    });
                    successCount++;
                } else {
                    failCount++;
                }
                
                // 延迟一下，避免请求过快
                if (i < fundCodes.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
            } catch (error) {
                console.error(`处理基金 ${fundCode} 时出错:`, error);
                failCount++;
            }
        }
        
        // 显示结果
        const message = `更新完成: ${successCount} 成功, ${failCount} 失败`;
        showRefreshStatus(message, successCount > 0 ? 'success' : 'error');
        
        // 更新徽章显示成功数量
        if (badge) {
            badge.textContent = successCount.toString();
            badge.style.backgroundColor = successCount > 0 ? '#10b981' : '#ef4444';
            setTimeout(() => {
                badge.style.display = 'none';
            }, 3000);
        }
        
    } catch (error) {
        console.error('刷新涨跌幅失败:', error);
        showRefreshStatus(`刷新失败: ${error.message}`, 'error');
    } finally {
        // 恢复按钮状态
        refreshBtn.classList.remove('loading');
        refreshBtn.disabled = false;
    }
}

// 刷新所有基金的估值
async function refreshFundValuations() {
    const refreshBtn = document.querySelector('.refresh-btn');
    const badge = document.getElementById('refresh-badge');
    
    // 防止重复点击
    if (refreshBtn.classList.contains('loading')) {
        return;
    }
    
    // 设置加载状态
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    
    showRefreshStatus('正在获取最新估值数据...', 'info');
    
    try {
        // 获取所有基金代码
        const fundRows = document.querySelectorAll('#dca-body tr[data-fund-code]');
        const fundCodes = [];
        
        for (const row of fundRows) {
            const fundCode = row.getAttribute('data-fund-code');
            const codeElement = row.querySelector('.fund-code');
            const codeText = codeElement ? codeElement.textContent.trim() : '';
            
            // 只处理有效的6位基金代码
            if (fundCode && /^\d{6}$/.test(fundCode) && codeText !== '-') {
                fundCodes.push(fundCode);
            }
        }
        
        if (fundCodes.length === 0) {
            showRefreshStatus('未找到有效的基金代码', 'error');
            return;
        }
        
        showRefreshStatus(`正在更新 ${fundCodes.length} 个基金估值...`, 'info');
        
        let successCount = 0;
        let failCount = 0;
        
        // 逐个获取基金估值（避免同时请求过多）
        for (let i = 0; i < fundCodes.length; i++) {
            const fundCode = fundCodes[i];
            
            try {
                // 显示进度
                if (badge) {
                    badge.textContent = `${i + 1}/${fundCodes.length}`;
                    badge.style.display = 'inline-block';
                }
                
                // 获取估值数据
                const result = await fetchFundValuationFromAPI(fundCode);
                
                if (result.success) {
                    // 更新估值显示，格式为：1.23 (01-15)
                    const displayValue = `${result.value}${result.date ? ` (${result.date})` : ''}`;
                    updateFundValuation(fundCode, {
                        value: displayValue,
                        date: result.date,
                        className: result.className,
                        isEstimated: result.isEstimated,
                        rawData: result.rawData
                    });
                    successCount++;
                } else {
                    failCount++;
                }
                
                // 延迟一下，避免请求过快
                if (i < fundCodes.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
            } catch (error) {
                console.error(`处理基金 ${fundCode} 估值时出错:`, error);
                failCount++;
            }
        }
        
        // 显示结果
        if (successCount > 0) {
            showRefreshStatus(`估值更新完成: ${successCount} 成功, ${failCount} 失败`, 'success');
        } else {
            showRefreshStatus(`估值更新失败: ${failCount} 个基金获取失败`, 'error');
        }
        
        // 更新徽章显示
        if (badge) {
            badge.textContent = successCount > 0 ? '✓' : '✗';
            badge.style.backgroundColor = successCount > 0 ? '#10b981' : '#ef4444';
            setTimeout(() => {
                badge.style.display = 'none';
            }, 3000);
        }
        
    } catch (error) {
        console.error('刷新估值失败:', error);
        showRefreshStatus(`刷新失败: ${error.message}`, 'error');
    } finally {
        // 恢复按钮状态并释放全局锁
        refreshBtn.classList.remove('loading');
        refreshBtn.disabled = false;
        window.isRefreshingDailyReturns = false;
        console.log('日回报刷新完成，锁已释放');
    }
}

// 页面加载时自动刷新估值
async function refreshValuationsOnLoad() {
    // 等待页面加载完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 检查是否有基金数据
    const fundRows = document.querySelectorAll('#dca-body tr[data-fund-code]');
    if (fundRows.length > 0) {
        console.log('📈 页面加载完成，开始获取所有基金估值...');
        showRefreshStatus('正在获取基金估值...', 'info');
        
        // 获取所有基金的估值
        const allFunds = Array.from(fundRows).map(row => 
            row.getAttribute('data-fund-code')
        ).filter(code => code && /^\d{6}$/.test(code));
        
        if (allFunds.length > 0) {
            console.log(`📊 需要查询 ${allFunds.length} 个基金的估值`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (const fundCode of allFunds) {
                try {
                    const result = await fetchFundValuationFromAPI(fundCode);
                    if (result.success) {
                        const displayValue = `${result.value}${result.date ? ` (${result.date})` : ''}`;
                        updateFundValuation(fundCode, {
                            value: displayValue,
                            date: result.date,
                            className: result.className,
                            isEstimated: result.isEstimated,
                            rawData: result.rawData
                        });
                        successCount++;
                    } else {
                        console.warn(`基金 ${fundCode} 估值获取失败:`, result.error);
                        failCount++;
                    }
                    // 稍微延迟，避免请求过快
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    console.error(`加载时获取基金 ${fundCode} 估值失败:`, error);
                    failCount++;
                }
            }
            
            showRefreshStatus(`基金估值加载完成 (成功: ${successCount}, 失败: ${failCount})`, 'success');
            console.log(`✅ 估值加载统计: 成功 ${successCount} 个, 失败 ${failCount} 个`);
        }
    }
}



// 朋友专场相关函数

// 显示朋友专场模态框
function showFriendsZone() {
    try {
        console.log('🔄 开始加载朋友专场...');
        
        // 创建朋友专场模态框
        createFriendsZoneModal();
        
        // 加载基金数据
        loadFriendsZoneData();
        
    } catch (error) {
        console.error('显示朋友专场失败:', error);
        showFriendsZoneError(`显示朋友专场时出错: ${error.message}`);
    }
}

// 创建朋友专场模态框
function createFriendsZoneModal() {
    // 创建模态框
    const modal = document.createElement('div');
    modal.className = 'friends-zone-modal';
    modal.id = 'friends-zone-modal';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>👥 朋友专场</h3>
                <span class="close-btn" onclick="closeFriendsZoneModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="table-container">
                    <table class="friends-zone-table">
                        <thead>
                            <tr>
                                <th>基金代码</th>
                                <th>基金名称</th>
                                <th>参考日估值</th>
                            </tr>
                        </thead>
                        <tbody id="friends-zone-tbody">
                            <tr class="loading-row">
                                <td colspan="3">
                                    <div class="loading-content">
                                        <div class="loading-spinner"></div>
                                        <span>正在加载朋友专场数据...</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 点击背景关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeFriendsZoneModal();
        }
    });
}

// 加载朋友专场数据
async function loadFriendsZoneData() {
    const tbody = document.getElementById('friends-zone-tbody');
    if (!tbody) return;
    
    console.log('📊 开始获取朋友专场基金数据...');
    
    const friendsFunds = [];
    let successCount = 0;
    let failCount = 0;
    
    // 为每个基金代码获取数据
    for (const fundCode of FRIENDS_ZONE_FUNDS) {
        try {
            console.log(`🔄 正在获取基金 ${fundCode} 数据...`);
            
            // 获取基金估值数据
            const result = await jsonpManager.request(fundCode, 'valuation');
            
            if (result.success) {
                const fundData = result.rawData;
                friendsFunds.push({
                    code: fundCode,
                    name: fundData.name || '基金名称获取中...',
                    valuation: result.value || '-',
                    className: result.className || '',
                    date: result.date || '',
                    rawData: fundData
                });
                successCount++;
                console.log(`✅ ${fundCode} 数据获取成功`);
            } else {
                friendsFunds.push({
                    code: fundCode,
                    name: '数据获取失败',
                    valuation: '-',
                    className: 'valuation-normal',
                    date: '',
                    rawData: null
                });
                failCount++;
                console.log(`❌ ${fundCode} 数据获取失败`);
            }
            
            // 稍微延迟，避免请求过快
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.error(`获取基金 ${fundCode} 数据失败:`, error);
            friendsFunds.push({
                code: fundCode,
                name: '网络错误',
                valuation: '-',
                className: 'valuation-normal',
                date: '',
                rawData: null
            });
            failCount++;
        }
    }
    
    // 渲染朋友专场表格
    renderFriendsZoneTable(friendsFunds);
    
    console.log(`📊 朋友专场数据加载完成 (成功: ${successCount}, 失败: ${failCount})`);
}

// 渲染朋友专场表格
function renderFriendsZoneTable(friendsFunds) {
    const tbody = document.getElementById('friends-zone-tbody');
    if (!tbody || !friendsFunds || friendsFunds.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="3">暂无朋友专场数据</td></tr>';
        return;
    }
    
    tbody.innerHTML = friendsFunds.map(fund => {
        return `
            <tr data-fund-code="${fund.code}">
                <td><code class="fund-code">${fund.code}</code></td>
                <td>${fund.name}</td>
                <td class="valuation-cell">
                    <div class="valuation-container">
                        <span class="valuation-value ${fund.className}">${fund.valuation}</span>
                        ${fund.date ? `<span class="valuation-date">${fund.date}</span>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 关闭朋友专场模态框
function closeFriendsZoneModal() {
    const modal = document.getElementById('friends-zone-modal');
    if (modal) {
        modal.remove();
    }
}

// 显示朋友专场错误提示
function showFriendsZoneError(message) {
    const errorModal = document.createElement('div');
    errorModal.className = 'friends-zone-modal';
    errorModal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h3>⚠️ 朋友专场加载失败</h3>
                <span class="close-btn" onclick="this.parentElement.parentElement.remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">👥</div>
                    <p style="color: #2c3e50; margin-bottom: 16px;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 24px;">
                        <button class="friends-btn" onclick="showFriendsZone(); this.parentElement.parentElement.parentElement.parentElement.remove()">
                            🔄 重新加载
                        </button>
                        <button class="chart-btn" onclick="this.parentElement.parentElement.parentElement.parentElement.remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(errorModal);
    
    // 点击背景关闭
    errorModal.addEventListener('click', function(e) {
        if (e.target === errorModal) {
            errorModal.remove();
        }
    });
}

// 导出当前数据到本地文件
function exportToLocalFile() {
    if (!cachedData) {
        alert('请先加载数据！');
        return;
    }
    
    try {
        // 生成JavaScript文件内容（按照完整表头结构）
        const fileContent = `/**
 * 本地备份数据文件
 * 从Google Sheets导出的真实数据
 * 导出时间: ${new Date().toLocaleString('zh-CN')}
 * 表头结构：
 * - 定投基金: 分类, 基金代码, 基金名称, 近6月回报, 操作, 备注, 金额, 累计收益, 基金限购, 当日估值
 * - 主动操作: 操作时间, 每日定投, 买入操作, 卖出操作, 当日留言
 * - 说明: 风险说明
 */

// 本地备选基金数据（当前持仓）- 完整表头结构
const LOCAL_DCA_DATA = ${JSON.stringify(cachedData.dca, null, 2)};

// 本地主动操作数据 - 完整表头结构
const LOCAL_ACTIVE_DATA = ${JSON.stringify(cachedData.active, null, 2)};

// 本地风险说明
const LOCAL_DISCLAIMER = ${JSON.stringify(cachedData.disclaimer || '')};

// 导出数据（如果使用模块化）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LOCAL_DCA_DATA,
        LOCAL_ACTIVE_DATA,
        LOCAL_DISCLAIMER
    };
}`;
        
        // 创建下载链接
        const blob = new Blob([fileContent], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'local-data-export.js';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('✅ 数据导出成功！');
        alert(`数据导出成功！\n包含 ${cachedData.dca.length} 条持仓记录和 ${cachedData.active.length} 条操作记录\n使用完整表头结构导出`);
        
    } catch (error) {
        console.error('导出数据失败:', error);
        alert('导出数据失败: ' + error.message);
    }
}

// 添加导出按钮到页面
function addExportButton() {
    // 检查是否已存在导出按钮
    if (document.getElementById('export-data-btn')) {
        return;
    }
    
    // 创建导出按钮
    const exportBtn = document.createElement('button');
    exportBtn.id = 'export-data-btn';
    exportBtn.className = 'export-btn';
    exportBtn.innerHTML = '💾 导出本地数据';
    exportBtn.title = '将当前数据导出到本地文件';
    exportBtn.onclick = exportToLocalFile;
    
    // 添加到页面
    const tableActions = document.querySelector('.table-actions');
    if (tableActions) {
        tableActions.appendChild(exportBtn);
    } else {
        // 如果找不到.table-actions，添加到页面其他位置
        const header = document.querySelector('header');
        if (header) {
            const btnContainer = document.createElement('div');
            btnContainer.style.marginTop = '10px';
            btnContainer.appendChild(exportBtn);
            header.appendChild(btnContainer);
        }
    }
    
    // 添加CSS样式
    const style = document.createElement('style');
    style.textContent = `
        .export-btn {
            background: linear-gradient(135deg, #10b981, #34d399);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: 10px;
        }
        
        .export-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(16, 185, 129, 0.4);
        }
        
        .export-btn:active {
            transform: translateY(0);
        }
        
        @media (max-width: 768px) {
            .export-btn {
                padding: 8px 16px;
                font-size: 0.85rem;
                margin-left: 5px;
            }
        }
    `;
    document.head.appendChild(style);
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 养鸡场基金系统开始加载...');
    console.log('📊 配置信息:');
    console.log('  - API URL:', GOOGLE_SHEET_API_URL);
    console.log('  - 缓存时间:', CACHE_DURATION / 1000, '秒');
    console.log('  - 当前时间:', new Date().toLocaleString());
    
    // 添加导出按钮
    addExportButton();
    
    // 直接加载数据
    fetchData().finally(() => {
        // 无论数据加载成功与否，都尝试获取估值
        setTimeout(() => {
            refreshValuationsOnLoad();
        }, 1000);
    });
    

});


