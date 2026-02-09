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
    
    // 尝试解析数字
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return value; // 如果不是数字，返回原始值
    
    // 格式化：x.xx 格式，保留2位小数
    return num.toFixed(2);
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

    tbody.innerHTML = dataWithPercentage.map(row => {
        const bgClass = getOperationBackgroundClass(row['操作'] || row['操作']);
        // 累计收益：只使用累计收益列数据，如果没有则显示"-"
        const cumulativeAmount = row['累计收益'];
        // 持仓占比：使用计算出的占比，如果没有则显示"-"
        const percentage = row._percentage !== undefined ? row._percentage : 
                          (row['持仓占比'] ? parseFloat(row['持仓占比']) : null);
        // 参考日回报：使用参考日回报数据，如果没有则显示"-"
        const dailyReturn = row['参考日回报'] || row['参考日回报/%'] || row['参考日回报%'] || null;
        const dailyReturnClass = getDailyReturnClass(dailyReturn);
        
        // 灵活获取分类字段，支持多种可能的字段名称
        const category = row['分类'] || row['category'] || row['Category'] || row['类型'] || row['类别'] || '-';
        
        return `
        <tr>
            <td>${category}</td>
            <td><code>${row['基金代码'] || row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || row['基金名称'] || '-'}</td>
            <td><span class="daily-return ${dailyReturnClass}">${dailyReturn ? formatDailyReturn(dailyReturn) : '-'}</span></td>
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
                // 日回报排序：使用参考日回报数据
                const dailyReturnA = a['参考日回报'] || a['参考日回报/%'] || a['参考日回报%'] || null;
                const dailyReturnB = b['参考日回报'] || b['参考日回报/%'] || b['参考日回报%'] || null;
                
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
        // 持仓占比：使用计算出的占比，如果没有则显示"-"
        const percentage = row._percentage !== undefined ? row._percentage : 
                          (row['持仓占比'] ? parseFloat(row['持仓占比']) : null);
        
        // 参考日回报：使用参考日回报数据，如果没有则显示"-"
        const dailyReturn = row['参考日回报'] || row['参考日回报/%'] || row['参考日回报%'] || null;
        const dailyReturnClass = getDailyReturnClass(dailyReturn);
        
        // 灵活获取分类字段，支持多种可能的字段名称
        const category = row['分类'] || row['category'] || row['Category'] || row['类型'] || row['类别'] || '-';
        
        return `
        <tr>
            <td>${category}</td>
            <td><code>${row['基金代码'] || row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || row['基金名称'] || '-'}</td>
            <td><span class="daily-return ${dailyReturnClass}">${dailyReturn ? formatDailyReturn(dailyReturn) : '-'}</span></td>
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
        
        // 先尝试使用计算出的占比
        if (row._percentage !== undefined) {
            percentage = row._percentage;
        } 
        // 如果没有计算出的占比，尝试使用表格中的持仓占比列
        else if (row['持仓占比']) {
            percentage = parseFloat(row['持仓占比']) || 0;
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
        
        // 优先使用表格中的持仓占比列
        if (row['持仓占比']) {
            percentage = parseFloat(row['持仓占比']) || 0;
        }
        // 如果没有持仓占比列，使用金额计算占比
        else {
            const amountStr = row['金额'] || '0';
            const amount = parseFloat(amountStr.toString().replace(/[^\d.-]/g, '')) || 0;
            percentage = totalAmount > 0 ? (amount / totalAmount * 100) : 0;
        }
        
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
        
        // 渲染
        if (sortState.direction && (sortState.column === 'percentage' || sortState.column === 'cumulative' || sortState.column === 'dailyReturn')) {
            renderDCATableWithSort(dca);
        } else {
            renderDCATable(dca);
        }
        renderManualTable(active);  // 主动操作
        renderDisclaimer(disclaimer);
        
        hideLoadingState();

    } catch (error) {
        console.error('获取数据失败:', error);
        
        // 重试逻辑
        if (retryCount < maxRetries) {
            console.log(`重试中... (${retryCount + 1}/${maxRetries})`);
            setTimeout(() => fetchData(retryCount + 1), 2000 * (retryCount + 1));
            showErrorState(`加载失败，正在重试... (${retryCount + 1}/${maxRetries})`);
        } else {
            showErrorState(`加载失败: ${error.message}<br><small>请检查网络连接或稍后重试</small>`);
        }
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
                    <span>正在加载数据...</span>
                </div>
            </td></tr>
        `;
    }
    
    if (manualBody) {
        manualBody.innerHTML = `
            <tr class="loading-row"><td colspan="5">
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <span>正在加载数据...</span>
                </div>
            </td></tr>
        `;
    }
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
    // 加载状态会在数据渲染时自动替换，所以这里不需要额外操作
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

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});
