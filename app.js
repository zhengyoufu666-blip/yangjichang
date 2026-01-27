// 配置：Google Apps Script URL
const GOOGLE_SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbyDmyVuRF3vUHUGsPDHjdx8fNiqv86oAXr8lyi0NcvBJylAcXwReXjn0mXjHRrVYpA5/exec';

// 缓存数据（5分钟）
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

// 当前显示的标签
let currentTab = 'dca';

// 当前操作筛选状态
let currentOperationFilter = 'all';

// 获取操作标签背景色
function getOperationBackgroundClass(operation) {
    const op = (operation || '').toLowerCase();
    if (op.includes('推荐定投')) return 'bg-recommend';
    if (op.includes('一般')) return 'bg-normal';
    if (op.includes('风险较高')) return 'bg-risk';
    if (op.includes('暂时别买')) return 'bg-stop';
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
    const cleaned = dateStr.replace(/[^\d]/g, '');
    if (cleaned.length === 8) {
        return cleaned.slice(4);
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
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close-btn" onclick="closeImageModal()">&times;</span>
            <img src="${imageUrl}" alt="放大图片">
        </div>
    `;
    
    document.body.appendChild(modal);
    
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

// 操作筛选功能
function filterOperations(filterType) {
    currentOperationFilter = filterType;
    
    // 更新按钮状态
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    
    renderDCATable(cachedData.dca);
}

// 渲染定投基金表格
function renderDCATable(data) {
    const tbody = document.getElementById('dca-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无定投记录</td></tr>';
        return;
    }

    let filteredData = data;
    if (currentOperationFilter !== 'all') {
        filteredData = data.filter(row => {
            const operation = (row['操作'] || '').trim();
            return operation === currentOperationFilter;
        });
    }

    if (!filteredData || filteredData.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无符合条件的定投记录</td></tr>';
        return;
    }

    tbody.innerHTML = filteredData.map(row => {
        const bgClass = getOperationBackgroundClass(row['操作'] || '');
        
        return `
        <tr>
            <td>${formatDate(row['日期'] || '')}</td>
            <td><code>${row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || '-'}</td>
            <td>${row['基金限购'] || '-'}</td>
            <td>
                <span class="operation-tag ${bgClass}">
                    ${row['操作'] || '-'}
                </span>
            </td>
            <td>${formatCurrency(row['金额'] || '')}</td>
            <td>${row['备注'] || '-'}</td>
        </tr>
    `;
    }).join('');
}

// 检查是否同一天
function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

// 解析日期字符串
function parseDate(dateStr) {
    if (!dateStr) return null;
    
    const cleaned = dateStr.replace(/[^\d]/g, '');
    if (cleaned.length === 4) {
        const currentYear = new Date().getFullYear();
        return new Date(currentYear, parseInt(cleaned.substring(0, 2)) - 1, parseInt(cleaned.substring(2)));
    } else if (cleaned.length === 8) {
        return new Date(
            parseInt(cleaned.substring(0, 4)),
            parseInt(cleaned.substring(4, 6)) - 1,
            parseInt(cleaned.substring(6))
        );
    }
    return null;
}

// 排序功能
function sortTable(field) {
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'desc' ? 'asc' : 'desc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'desc';
    }
    
    document.querySelectorAll('.sort-arrow').forEach(arrow => {
        arrow.classList.remove('asc', 'desc');
        if (arrow.dataset.sort === field) {
            arrow.classList.add(currentSort.direction);
        }
    });
    
    renderDCATable(cachedData.dca);
}

// 筛选功能
function filterActiveData() {
    currentFilter = document.getElementById('dateFilter').value;
    renderManualTable(cachedData.active);
}

// 渲染定投基金表格
function renderDCATable(data) {
    const tbody = document.getElementById('dca-body');

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="7">暂无定投记录</td></tr>';
        return;
    }

    let sortedData = [...data];
    if (currentSort.field) {
        sortedData.sort((a, b) => {
            let aVal = a[currentSort.field] || '';
            let bVal = b[currentSort.field] || '';
            
            if (currentSort.field === 'amount' || currentSort.field === 'limit') {
                aVal = parseFloat(aVal.toString().replace(/[^\d.-]/g, '')) || 0;
                bVal = parseFloat(bVal.toString().replace(/[^\d.-]/g, '')) || 0;
            }
            
            if (currentSort.direction === 'asc') {
                return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            } else {
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            }
        });
    }

    tbody.innerHTML = sortedData.map(row => {
        const bgClass = getOperationBackgroundClass(row['操作'] || '');
        
        return `
        <tr>
            <td>${formatDate(row['日期'] || '')}</td>
            <td><code>${row['基金代码'] || '-'}</code></td>
            <td>${row['基金名称'] || '-'}</td>
            <td>${row['基金限购'] || '-'}</td>
            <td>
                <span class="operation-tag ${bgClass}">
                    ${row['操作'] || '-'}
                </span>
            </td>
            <td>${formatCurrency(row['金额'] || '')}</td>
            <td>${row['备注'] || '-'}</td>
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

    const sortedData = [...data].sort((a, b) => {
        const dateA = (a['操作时间'] || '').replace(/[^\d]/g, '');
        const dateB = (b['操作时间'] || '').replace(/[^\d]/g, '');
        return dateB.localeCompare(dateA);
    });

    tbody.innerHTML = sortedData.map(row => `
        <tr>
            <td>${formatDate(row['操作时间'] || '')}</td>
            <td>${formatImageContent(row['每日定投'] || '')}</td>
            <td>${formatImageContent(row['买入操作'] || '')}</td>
            <td>${formatImageContent(row['卖出操作'] || '')}</td>
            <td>${row['当日留言'] || '-'}</td>
        </tr>
    `).join('');
}

// 切换标签
function switchTab(tabName) {
    currentTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

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

        const dca = jsonData['定投基金'] ? jsonData['定投基金'].rows : [];
        const manual = jsonData['操作记录'] ? jsonData['操作记录'].rows : [];
        const active = jsonData['主动操作'] ? jsonData['主动操作'].rows : [];
        
        let disclaimer = '';
        if (jsonData['说明'] && jsonData['说明'].rows.length > 0) {
            const firstRow = jsonData['说明'].rows[0];
            disclaimer = firstRow['风险说明'] || '';
        }

        cachedData = { dca, manual, active, disclaimer };
        lastFetchTime = now;

        renderDCATable(dca);
        renderManualTable(active);
        renderDisclaimer(disclaimer);
        updateLastUpdateTime();

    } catch (error) {
        console.error('获取数据失败:', error);
        document.getElementById('dca-body').innerHTML = `
            <tr class="empty-state"><td colspan="7">加载失败: ${error.message}</td></tr>
        `;
        document.getElementById('manual-body').innerHTML = `
            <tr class="empty-state"><td colspan="5">加载失败: ${error.message}</td></tr>
        `;
    }
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

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});