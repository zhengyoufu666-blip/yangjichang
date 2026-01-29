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
        tbody.innerHTML = '<tr class="empty-state"><td colspan="8">暂无定投记录</td></tr>';
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
            <td><strong>${formatPercentage(percentage)}</strong></td>
            <td>${cumulativeAmount ? formatCurrency(cumulativeAmount) : '-'}</td>
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
        tbody.innerHTML = '<tr class="empty-state"><td colspan="8">暂无定投记录</td></tr>';
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
            <td><strong>${formatPercentage(percentage)}</strong></td>
            <td>${cumulativeAmount ? formatCurrency(cumulativeAmount) : '-'}</td>
            <td>${row['备注'] || row['备注'] || '-'}</td>
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
                <h3>📊 资产分布可视化</h3>
                <span class="close-btn" onclick="closePieChartModal()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="dashboard-container">
                    <!-- 顶部概览卡片 -->
                    <div class="overview-cards">
                        <div class="overview-card">
                            <div class="card-icon">📈</div>
                            <div class="card-content">
                                <div class="card-title">基金数量</div>
                                <div class="card-value">${fundData.length}</div>
                            </div>
                        </div>
                        <div class="overview-card">
                            <div class="card-icon">🎯</div>
                            <div class="card-content">
                                <div class="card-title">最大持仓</div>
                                <div class="card-value">${fundData.length > 0 ? fundData[0].percentage.toFixed(1) + '%' : '0%'}</div>
                                <div class="card-subtitle">${fundData.length > 0 ? fundData[0].name : ''}</div>
                            </div>
                        </div>
                        <div class="overview-card">
                            <div class="card-icon">⚖️</div>
                            <div class="card-content">
                                <div class="card-title">持仓均衡度</div>
                                <div class="card-value">${calculateDiversificationScore(fundData)}</div>
                                <div class="card-subtitle">分数越高越均衡</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 主图表区域 -->
                    <div class="main-chart-area">
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
                        
                        <!-- 操作分类区域 -->
                        ${operationData.length > 0 ? `
                        <div class="operation-section">
                            <h4>操作类型分布</h4>
                            <div class="operation-grid">
                                ${operationData.map((op, index) => `
                                    <div class="operation-card">
                                        <div class="operation-icon">${getOperationIcon(op.operation)}</div>
                                        <div class="operation-info">
                                            <div class="operation-name">${op.operation}</div>
                                            <div class="operation-percentage">${op.percentage.toFixed(1)}%</div>
                                        </div>
                                        <div class="operation-bar">
                                            <div class="operation-bar-fill" style="width: ${op.percentage}%"></div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    
                    <!-- 分析建议 -->
                    <div class="analysis-section">
                        <h4>📋 持仓分析</h4>
                        <div class="analysis-content">
                            ${generateAnalysis(fundData)}
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

        // 渲染
        if (sortState.direction && (sortState.column === 'percentage' || sortState.column === 'cumulative')) {
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
            <tr class="loading-row"><td colspan="8">
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
            <tr class="error-state"><td colspan="8">
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

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});
