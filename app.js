// 配置：Google Apps Script URL
const GOOGLE_SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbyDmyVuRF3vUHUGsPDHjdx8fNiqv86oAXr8lyi0NcvBJylAcXwReXjn0mXjHRrVYpA5/exec';

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
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无定投记录</td></tr>';
        return;
    }

    // 根据当前排序状态排序数据
    let sortedData = [...data];
    if (sortState.column === 'amount' && sortState.direction) {
        sortedData.sort((a, b) => {
            const amountA = parseFloat((a['金额'] || '0').toString().replace(/[^\d.-]/g, '')) || 0;
            const amountB = parseFloat((b['金额'] || '0').toString().replace(/[^\d.-]/g, '')) || 0;
            
            return sortState.direction === 'asc' ? amountA - amountB : amountB - amountA;
        });
    }

    tbody.innerHTML = sortedData.map(row => {
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

// 显示持仓饼图
function showPieChart() {
    if (!cachedData || !cachedData.dca) {
        alert('暂无持仓数据');
        return;
    }
    
    // 计算各基金的持仓金额
    const fundData = calculateFundAllocation(cachedData.dca);
    
    if (fundData.length === 0) {
        alert('暂无有效持仓数据');
        return;
    }
    
    // 创建饼图弹窗
    createPieChartModal(fundData);
}

// 计算操作分类分布
function calculateOperationDistribution(data) {
    const operationMap = new Map();
    
    data.forEach(row => {
        const operation = row['操作'] || row['操作'] || '';
        const amountStr = row['金额'] || row['金额'] || '0';
        const amount = parseFloat(amountStr.toString().replace(/[^\d.-]/g, '')) || 0;
        
        if (operation && amount > 0) {
            if (operationMap.has(operation)) {
                const existing = operationMap.get(operation);
                existing.amount += amount;
            } else {
                operationMap.set(operation, {
                    operation: operation,
                    amount: amount
                });
            }
        }
    });
    
    // 计算总额和百分比
    const totalAmount = Array.from(operationMap.values()).reduce((sum, op) => sum + op.amount, 0);
    const result = Array.from(operationMap.values()).map(op => ({
        ...op,
        percentage: totalAmount > 0 ? (op.amount / totalAmount * 100) : 0
    }));
    
    // 按金额降序排序
    return result.sort((a, b) => b.amount - a.amount);
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

// 计算基金持仓分配
function calculateFundAllocation(data) {
    const fundMap = new Map();
    
    data.forEach(row => {
        const fundName = row['基金名称'] || row['基金名称'] || '';
        const fundCode = row['基金代码'] || row['基金代码'] || '';
        const amountStr = row['金额'] || row['金额'] || '0';
        const amount = parseFloat(amountStr.toString().replace(/[^\d.-]/g, '')) || 0;
        
        if (fundName && amount > 0) {
            if (fundMap.has(fundName)) {
                const existing = fundMap.get(fundName);
                existing.amount += amount;
            } else {
                fundMap.set(fundName, {
                    name: fundName,
                    code: fundCode,
                    amount: amount
                });
            }
        }
    });
    
    // 计算总额和百分比
    const totalAmount = Array.from(fundMap.values()).reduce((sum, fund) => sum + fund.amount, 0);
    const result = Array.from(fundMap.values()).map(fund => ({
        ...fund,
        percentage: totalAmount > 0 ? (fund.amount / totalAmount * 100) : 0
    }));
    
    // 按金额降序排序
    return result.sort((a, b) => b.amount - a.amount);
}

// 创建饼图弹窗
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
    const operationColors = generateOperationColors(operationData.length);
    const operationPieSlices = calculatePieSlices(operationData);
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>📊 持仓分布图</h3>
                <span class="close-btn" onclick="closePieChartModal()">&times;</span>
            </div>
                <div class="modal-body">
                    <div class="charts-container">
                        <div class="chart-section">
                            <div class="chart-container">
                                <h4>操作分类</h4>
                                <svg width="300" height="300" viewBox="0 0 300 300" class="pie-chart">
                                    ${operationPieSlices.map((slice, index) => `
                                        <g class="pie-slice operation-slice" data-operation-index="${index}">
                                            <path d="${slice.path}" 
                                                  fill="${operationColors[index]}" stroke="white" stroke-width="2"
                                                  onmouseover="showOperationTooltip(${index}, event)"
                                                  onmouseout="hideOperationTooltip()">
                                            </path>
                                        </g>
                                    `).join('')}
                                    ${operationData.map((op, index) => {
                                        const labelAngle = operationPieSlices[index].middleAngle;
                                        const labelX = 150 + Math.cos(labelAngle) * 80;
                                        const labelY = 150 + Math.sin(labelAngle) * 80;
                                        return `
                                            <text x="${labelX}" y="${labelY}" text-anchor="middle" 
                                                  class="pie-label" fill="white" font-weight="bold" font-size="10">
                                                ${op.percentage.toFixed(1)}%
                                            </text>
                                        `;
                                    }).join('')}
                                </svg>
                            </div>
                            <div class="chart-container">
                                <h4>基金分布</h4>
                                <svg width="300" height="300" viewBox="0 0 300 300" class="pie-chart">
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
                                        const labelX = 150 + Math.cos(labelAngle) * 80;
                                        const labelY = 150 + Math.sin(labelAngle) * 80;
                                        return `
                                            <text x="${labelX}" y="${labelY}" text-anchor="middle" 
                                                  class="pie-label" fill="white" font-weight="bold" font-size="10">
                                                ${fund.percentage.toFixed(1)}%
                                            </text>
                                        `;
                                    }).join('')}
                                </svg>
                            </div>
                        </div>
                    <div class="legend">
                        <h4>基金明细</h4>
                        ${fundData.map((fund, index) => `
                            <div class="legend-item">
                                <span class="legend-color" style="background-color: ${fundColors[index]}"></span>
                                <span class="legend-name">${fund.name}</span>
                                <span class="legend-code">${fund.code}</span>
                                <span class="legend-amount">${formatCurrency(fund.amount)}</span>
                                <span class="legend-percentage">(${fund.percentage.toFixed(2)}%)</span>
                            </div>
                        `).join('')}
                        <div class="legend-total">
                            <strong>总计: ${formatCurrency(fundData.reduce((sum, fund) => sum + fund.amount, 0))}</strong>
                        </div>
                        
                        <h4 style="margin-top: 24px;">操作分类</h4>
                        ${operationData.map((op, index) => `
                            <div class="legend-item">
                                <span class="legend-color" style="background-color: ${operationColors[index]}"></span>
                                <span class="legend-name">${op.operation}</span>
                                <span class="legend-amount">${formatCurrency(op.amount)}</span>
                                <span class="legend-percentage">(${op.percentage.toFixed(2)}%)</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        <div class="tooltip" id="fund-tooltip" style="display: none;"></div>
        <div class="tooltip" id="operation-tooltip" style="display: none;"></div>
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
    const totalAmount = fundData.reduce((sum, fund) => sum + fund.amount, 0);
    const slices = [];
    let currentAngle = -Math.PI / 2; // 从顶部开始
    
    fundData.forEach((fund) => {
        const percentage = fund.amount / totalAmount;
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
            <div>总金额: <strong>${formatCurrency(operation.amount)}</strong></div>
            <div>占比: <strong>${operation.percentage.toFixed(2)}%</strong></div>
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
            <div>持仓金额: <strong>${formatCurrency(fund.amount)}</strong></div>
            <div>占比: <strong>${fund.percentage.toFixed(2)}%</strong></div>
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
        if (sortState.direction && sortState.column === 'amount') {
            renderDCATableWithSort(dca);
        } else {
            renderDCATable(dca);
        }
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
