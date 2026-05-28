// app.js — Main Orchestrator for PolicyLens
import { logger } from './logger.js';
import { queryEngine } from './queryEngine.js';
import { aiLayer } from './aiLayer.js';
import { charts } from './charts.js';

// Application State
const state = {
  apiKey: localStorage.getItem('policylens_gemini_key') || '',
  mode: 'manual', // 'ai' or 'manual'
  metadata: { agencies: [], categories: [], subcategories: [], fiscal_years: [] },
  currentQuery: {
    agency: null,
    category: null,
    subcategory: null,
    vendor: null,
    fiscal_year: null,
    group_by: 'category',
    metric: 'total_amount',
    sort: 'desc',
    limit: 15
  },
  currentChartType: 'bar',
  originalQuestion: ''
};

// DOM Elements
const elements = {
  kpiTotalSpend: document.getElementById('kpi-total-spend'),
  kpiTotalTxs: document.getElementById('kpi-total-txs'),
  kpiActiveVendors: document.getElementById('kpi-active-vendors'),
  btnToggleKey: document.getElementById('btn-toggle-key'),
  modeBadge: document.getElementById('mode-badge'),
  filterAgency: document.getElementById('filter-agency'),
  filterCategory: document.getElementById('filter-category'),
  filterYearRadios: document.getElementsByName('filter-year'),
  filterMinSpend: document.getElementById('filter-min-spend'),
  minSpendVal: document.getElementById('min-spend-val'),
  btnApplyFilters: document.getElementById('btn-apply-filters'),
  filtersForm: document.getElementById('filters-form'),
  logTerminal: document.getElementById('log-terminal'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  searchInput: document.getElementById('search-input'),
  btnSubmitQuestion: document.getElementById('btn-submit-question'),
  exampleChipsContainer: document.getElementById('example-chips-container'),
  aiUpgradeBanner: document.getElementById('ai-upgrade-banner'),
  btnUnlockBanner: document.getElementById('btn-unlock-banner'),
  resultIntentTitle: document.getElementById('result-intent-title'),
  resultMetaSubtitle: document.getElementById('result-meta-subtitle'),
  visualChartSelector: document.getElementById('visual-chart-selector'),
  shimmerPlaceholder: document.getElementById('shimmer-placeholder'),
  mainChartCanvas: document.getElementById('main-chart-canvas'),
  treemapContainer: document.getElementById('treemap-container'),
  aiSummaryBox: document.getElementById('ai-summary-box'),
  aiSummaryContent: document.getElementById('ai-summary-content'),
  aiSummaryMeta: document.getElementById('ai-summary-meta'),
  manualStatsBox: document.getElementById('manual-stats-box'),
  statsMatchingSpend: document.getElementById('stats-matching-spend'),
  statsMatchingCats: document.getElementById('stats-matching-cats'),
  statsDuration: document.getElementById('stats-duration'),
  transparencySection: document.getElementById('transparency-section'),
  transparencyHeaderBtn: document.getElementById('transparency-header-btn'),
  transparencyDetails: document.getElementById('transparency-details'),
  transparencyChevron: document.getElementById('transparency-chevron'),
  transparencyFilterList: document.getElementById('transparency-filter-list'),
  transparencyGroupBy: document.getElementById('transparency-group-by'),
  keyModal: document.getElementById('key-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  modalInputKey: document.getElementById('modal-input-key'),
  btnSkipKey: document.getElementById('btn-skip-key'),
  btnSaveKey: document.getElementById('btn-save-key')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  logger.setLogCallback(addLogToTerminal);
  logger.event('app_initialization_started');
  
  initUIEvents();
  loadMetaAndSummary();
  checkApiKeyStatus();
});

// Setup UI Interaction Events
function initUIEvents() {
  // Range slider label
  elements.filterMinSpend.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    elements.minSpendVal.innerText = val === 0 ? '$0' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
  });

  // Handle manual filter form submission
  elements.filtersForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runManualFilterQuery();
  });

  // Key Modal controls
  elements.btnToggleKey.addEventListener('click', () => showKeyModal(true));
  elements.btnUnlockBanner.addEventListener('click', () => showKeyModal(true));
  elements.btnCloseModal.addEventListener('click', () => showKeyModal(false));
  elements.btnSkipKey.addEventListener('click', () => {
    showKeyModal(false);
    logger.event('api_key_modal_skipped');
  });
  elements.btnSaveKey.addEventListener('click', saveApiKeyFromModal);

  // AI Question Submission
  elements.btnSubmitQuestion.addEventListener('click', submitAIQuestion);
  elements.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitAIQuestion();
    }
  });

  // Example Prompt Chips
  elements.exampleChipsContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.prompt-chip');
    if (chip && state.mode === 'ai') {
      const q = chip.dataset.q;
      elements.searchInput.value = q;
      submitAIQuestion();
    }
  });

  // Visualization Switcher Tabs
  elements.visualChartSelector.addEventListener('click', (e) => {
    const tab = e.target.closest('.visual-tab');
    if (tab) {
      document.querySelectorAll('.visual-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const chartType = tab.dataset.type;
      state.currentChartType = chartType;
      logger.event('chart_type_changed_by_user', { type: chartType });
      replotChart();
    }
  });

  // Transparency Collapsible
  elements.transparencyHeaderBtn.addEventListener('click', () => {
    const details = elements.transparencyDetails;
    const isVisible = details.style.display === 'block';
    details.style.display = isVisible ? 'none' : 'block';
    elements.transparencyChevron.className = isVisible ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
    logger.event('transparency_toggled', { visible: !isVisible });
  });

  // Audit Logs Clear button
  elements.btnClearLogs.addEventListener('click', () => {
    elements.logTerminal.innerHTML = '';
  });

  // Setup Drill-Down Action inside charts
  charts.setDrillDownHandler((clickedLabel) => {
    logger.event('drill_down_triggered', { label: clickedLabel });
    
    // Auto-update filter selections depending on the current aggregation level
    const currentGroupBy = state.currentQuery.group_by;
    if (currentGroupBy === 'agency') {
      elements.filterAgency.value = clickedLabel;
      state.currentQuery.agency = clickedLabel;
      state.currentQuery.group_by = 'category';
      state.currentQuery.intent_label = `Spend breakdown for ${clickedLabel}`;
    } else if (currentGroupBy === 'category') {
      elements.filterCategory.value = clickedLabel;
      state.currentQuery.category = clickedLabel;
      state.currentQuery.group_by = 'subcategory';
      state.currentQuery.intent_label = `Subcategories under ${clickedLabel}`;
    } else if (currentGroupBy === 'subcategory') {
      state.currentQuery.subcategory = clickedLabel;
      state.currentQuery.group_by = 'vendor';
      state.currentQuery.intent_label = `Top vendors for ${clickedLabel}`;
    } else {
      // already at vendor level, can't drill further
      return;
    }

    runStateQuery();
  });
}

// Visual Log Terminal Feed Appender
function addLogToTerminal(entry) {
  const line = document.createElement('div');
  line.className = 'log-entry';
  
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const metaStr = Object.entries(entry)
    .filter(([k]) => !['event', 'timestamp', 'session_id'].includes(k))
    .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' | ');

  line.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-event">${entry.event}</span>
    ${metaStr ? `<span class="log-meta">(${metaStr})</span>` : ''}
  `;
  
  elements.logTerminal.appendChild(line);
  elements.logTerminal.scrollTop = elements.logTerminal.scrollHeight;
}

// API Key UI Mode manager
function checkApiKeyStatus() {
  if (state.apiKey) {
    state.mode = 'ai';
    logger.setMode('ai');
    
    // UI states
    elements.modeBadge.innerText = 'AI Enabled';
    elements.modeBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    elements.modeBadge.style.color = 'var(--success)';
    
    elements.searchInput.removeAttribute('disabled');
    elements.searchInput.placeholder = 'Ask a question about the budget in plain English...';
    elements.btnSubmitQuestion.removeAttribute('disabled');
    
    elements.aiUpgradeBanner.style.display = 'none';
    elements.btnToggleKey.classList.add('active');
    
    // Start lazy loading vendors data so it's ready for natural language vendor questions
    queryEngine.loadVendors('./data/vendors.json');
  } else {
    state.mode = 'manual';
    logger.setMode('manual');
    
    // UI states
    elements.modeBadge.innerText = 'Manual Filter';
    elements.modeBadge.style.background = 'rgba(245, 158, 11, 0.15)';
    elements.modeBadge.style.color = 'var(--warning)';
    
    elements.searchInput.setAttribute('disabled', 'true');
    elements.searchInput.placeholder = 'Unlock AI mode to ask natural language questions...';
    elements.btnSubmitQuestion.setAttribute('disabled', 'true');
    
    elements.aiUpgradeBanner.style.display = 'flex';
    elements.btnToggleKey.classList.remove('active');
  }
}

function showKeyModal(show) {
  if (show) {
    elements.modalInputKey.value = state.apiKey;
    elements.keyModal.classList.add('active');
  } else {
    elements.keyModal.classList.remove('active');
  }
}

function saveApiKeyFromModal() {
  const key = elements.modalInputKey.value.trim();
  if (key) {
    state.apiKey = key;
    localStorage.setItem('policylens_gemini_key', key);
    logger.event('api_key_saved', { length: key.length });
  } else {
    state.apiKey = '';
    localStorage.removeItem('policylens_gemini_key');
    logger.event('api_key_removed');
  }
  checkApiKeyStatus();
  showKeyModal(false);
}

// Load metadata and summary json
function loadMetaAndSummary() {
  // 1. Fetch Metadata
  fetch('./data/meta.json')
    .then(res => res.json())
    .then(meta => {
      state.metadata = meta;
      
      // Populate filters dropdown
      meta.agencies.forEach(agy => {
        const opt = document.createElement('option');
        opt.value = agy;
        opt.innerText = agy;
        elements.filterAgency.appendChild(opt);
      });
      
      meta.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        elements.filterCategory.appendChild(opt);
      });

      logger.event('metadata_loaded', {
        agenciesCount: meta.agencies.length,
        categoriesCount: meta.categories.length
      });
    })
    .catch(err => console.error('Error loading metadata:', err));

  // 2. Fetch Summary JSON
  fetch('./data/summary.json')
    .then(res => res.json())
    .then(summary => {
      queryEngine.setSummaryData(summary);
      
      // Calculate top level KPIs from the full dataset
      let totalSpend = 0;
      let totalTxs = 0;
      summary.forEach(r => {
        totalSpend += r.v;
        totalTxs += 1;
      });

      // Update KPI Header Display
      elements.kpiTotalSpend.innerText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalSpend);
      elements.kpiTotalTxs.innerText = new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(totalTxs);
      
      // Active vendors are loaded lazily
      elements.kpiActiveVendors.innerText = '97.5K';

      // Perform initial query representation to load the chart
      runManualFilterQuery();
    })
    .catch(err => console.error('Error loading summary data:', err));
    
  // Handle callbacks when vendor data is fully loaded
  queryEngine.onVendorsLoaded(() => {
    logger.event('vendors_lazy_load_completed');
    elements.kpiActiveVendors.innerText = '97,519';
  });
}

// Run Query based on Left Sidebar Filters Form (Manual Mode)
function runManualFilterQuery() {
  const selectedAgency = elements.filterAgency.value;
  const selectedCategory = elements.filterCategory.value;
  
  let selectedYear = '';
  for (const r of elements.filterYearRadios) {
    if (r.checked) {
      selectedYear = r.value;
      break;
    }
  }
  
  const minSpend = parseInt(elements.filterMinSpend.value);

  // Construct query object
  state.currentQuery = {
    agency: selectedAgency || null,
    category: selectedCategory || null,
    subcategory: null,
    vendor: null,
    fiscal_year: selectedYear || null,
    min_amount: minSpend > 0 ? minSpend : undefined,
    group_by: selectedCategory ? 'subcategory' : (selectedAgency ? 'category' : 'agency'),
    metric: 'total_amount',
    sort: 'desc',
    limit: 15,
    intent_label: 'Custom Filter View'
  };

  state.originalQuestion = ''; // Clear plain english query state
  runStateQuery();
}

// Coordinate the state query execution, UI updates, and Chart rendering
function runStateQuery() {
  // Update Chart tab selection to reflect query structure
  if (state.currentQuery.group_by === 'month') {
    state.currentChartType = 'line';
  } else {
    // defaults to bar if not specified or line-incompatible
    if (state.currentChartType === 'line') state.currentChartType = 'bar';
  }
  
  // Update tabs UI selection state
  document.querySelectorAll('.visual-tab').forEach(t => {
    t.classList.remove('active');
    if (t.dataset.type === state.currentChartType) {
      t.classList.add('active');
    }
  });

  // Execute Query
  const queryResult = queryEngine.executeQuery(state.currentQuery);

  if (queryResult.error === 'vendor_data_loading') {
    elements.resultIntentTitle.innerText = 'Loading Vendor Dataset...';
    elements.resultMetaSubtitle.innerText = queryResult.message;
    // Show a loading text or retry loop
    setTimeout(runStateQuery, 1000);
    return;
  }

  if (queryResult.error === 'out_of_scope') {
    elements.resultIntentTitle.innerText = 'Search Outside Dataset Scope';
    elements.resultMetaSubtitle.innerText = 'The requested search is outside the scope of our WA State Vendor Payments (FY2022-2023) records.';
    
    // Clear the charts
    replotChart([]);
    
    // Display explanation and valid suggestion alternatives to guide the user back
    elements.aiSummaryBox.style.display = 'none';
    elements.manualStatsBox.style.display = 'block';
    
    const suggestions = [
      "What were the top 10 categories of spend in 2023?",
      "Which vendors got the most money from the Health Care Authority?",
      "How did Department of Transportation spending change month over month?"
    ];
    
    elements.manualStatsBox.innerHTML = `
      <div class="manual-stats-title" style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>Out of Scope Request</div>
      <div style="font-size: 13px; line-height: 1.4; margin-top: 6px; color: var(--text-muted);">
        PolicyLens database only contains Washington State agency vendor payments for Fiscal Years 2022 and 2023.
      </div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
        <span style="font-size:11px; font-weight:bold; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Try these valid questions:</span>
        ${suggestions.map(s => `
          <a href="#" class="suggested-q-link" data-q="${s}" style="color:var(--accent-color); text-decoration:none; font-size:13px; line-height:1.4;">
            <i class="fa-solid fa-circle-question" style="margin-right:6px;"></i> "${s}"
          </a>
        `).join('')}
      </div>
    `;
    
    // Add click handler to alternative links
    document.querySelectorAll('.suggested-q-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        elements.searchInput.value = link.dataset.q;
        submitAIQuestion();
      });
    });
    
    elements.transparencySection.style.display = 'none';
    return;
  }

  if (queryResult.results.length === 0) {
    elements.resultIntentTitle.innerText = state.currentQuery.intent_label || 'No Records Found';
    elements.resultMetaSubtitle.innerText = `Filtered on: ${getReadableFilterString()}. Total Spend: $0 (0 matching records).`;
    
    replotChart([]);
    
    elements.aiSummaryBox.style.display = 'none';
    elements.manualStatsBox.style.display = 'block';
    elements.manualStatsBox.innerHTML = `
      <div class="manual-stats-title" style="color:var(--warning);"><i class="fa-solid fa-circle-info" style="margin-right:6px;"></i>No Matching Records Found</div>
      <div style="font-size: 13px; line-height: 1.4; margin-top: 6px; color: var(--text-muted);">
        Your search filter did not return any matching transaction records. Try widening your filters or setting a lower minimum spend threshold.
      </div>
    `;
    
    elements.transparencySection.style.display = 'block';
    elements.transparencyFilterList.innerHTML = getReadableFilterBadgeString();
    elements.transparencyGroupBy.innerText = state.currentQuery.group_by;
    return;
  }

  // Display Title Headers
  elements.resultIntentTitle.innerText = state.currentQuery.intent_label || 'Query Results';
  
  const subtitleText = `Filtered on: ${getReadableFilterString()}. Spent: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(queryResult.meta.totalSpend)} across ${queryResult.meta.totalTransactions} records.`;
  elements.resultMetaSubtitle.innerText = subtitleText;

  // Render Visual Chart
  replotChart(queryResult.results);

  // Update Details Block (AI summary vs Manual stats cards)
  if (state.mode === 'ai' && state.originalQuestion) {
    // Trigger AI plain-English summary generation
    elements.manualStatsBox.style.display = 'none';
    elements.aiSummaryBox.style.display = 'flex';
    elements.aiSummaryContent.innerText = 'AI is writing spending brief...';
    elements.aiSummaryMeta.innerText = 'Generating insights summary...';
    
    aiLayer.generateSummary(state.originalQuestion, state.currentQuery, queryResult, state.apiKey)
      .then(summaryText => {
        elements.aiSummaryContent.innerText = summaryText;
        elements.aiSummaryMeta.innerText = `Engine: gemini-2.5-flash-lite | Latency: ${Math.round(queryResult.meta.durationMs)}ms`;
      });
  } else {
    // Show basic numeric counts table
    elements.aiSummaryBox.style.display = 'none';
    elements.manualStatsBox.style.display = 'block';
    
    elements.statsMatchingSpend.innerText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(queryResult.meta.totalSpend);
    elements.statsMatchingCats.innerText = queryResult.results.length;
    elements.statsDuration.innerText = `${Math.round(queryResult.meta.durationMs * 10) / 10}ms`;
  }

  // Transparency explanation UI
  elements.transparencySection.style.display = 'block';
  elements.transparencyFilterList.innerHTML = getReadableFilterBadgeString();
  elements.transparencyGroupBy.innerText = state.currentQuery.group_by;
}

// Re-plot current loaded data on canvas/container
function replotChart(resultsData = null) {
  // If resultsData isn't passed, run the query again to get fresh sorted results
  let dataPoints = resultsData;
  if (!dataPoints) {
    const queryResult = queryEngine.executeQuery(state.currentQuery);
    dataPoints = queryResult.results;
  }
  
  charts.render(state.currentChartType, dataPoints);
}

// Submit Natural Language Question to Gemini
async function submitAIQuestion() {
  const question = elements.searchInput.value.trim();
  if (!question) return;

  logger.event('ai_question_submitted', { question });
  
  // Show UI Loading State
  elements.searchInput.setAttribute('disabled', 'true');
  elements.btnSubmitQuestion.setAttribute('disabled', 'true');
  elements.mainChartCanvas.style.display = 'none';
  elements.treemapContainer.style.display = 'none';
  elements.shimmerPlaceholder.style.display = 'flex';
  elements.aiSummaryBox.style.display = 'none';
  elements.manualStatsBox.style.display = 'none';
  elements.resultIntentTitle.innerText = 'Analyzing Question...';
  elements.resultMetaSubtitle.innerText = 'Translating plain English to structured query filters...';

  try {
    // 1. Get structured query parameters from AI
    const queryObj = await aiLayer.extractIntent(question, state.metadata, state.apiKey);
    
    // Save state
    state.currentQuery = queryObj;
    state.originalQuestion = question;
    state.currentChartType = queryObj.chart_type || 'bar';

    // 2. Load vendor file if query is vendor-related
    const useVendors = queryObj.vendor || queryObj.group_by === 'vendor';
    if (useVendors && !queryEngine.isVendorsLoaded()) {
      elements.resultIntentTitle.innerText = 'Loading Vendor Dataset (~23MB)...';
      elements.resultMetaSubtitle.innerText = 'Please wait while vendor payments indices are mapped for this search.';
      queryEngine.loadVendors('./data/vendors.json');
      
      // Wait for load completion
      queryEngine.onVendorsLoaded(() => {
        elements.shimmerPlaceholder.style.display = 'none';
        elements.mainChartCanvas.style.display = 'block';
        runStateQuery();
      });
      return;
    }

    // 3. Apply state and plot
    elements.shimmerPlaceholder.style.display = 'none';
    elements.mainChartCanvas.style.display = 'block';
    runStateQuery();

  } catch (error) {
    logger.event('ai_flow_failed', { question, error: error.message });
    
    // Fallback UI
    elements.shimmerPlaceholder.style.display = 'none';
    elements.mainChartCanvas.style.display = 'block';
    elements.resultIntentTitle.innerText = 'Query Ambiguity Detected';
    elements.resultMetaSubtitle.innerText = 'We couldn\'t map your question. Try one of these alternatives below:';
    
    // Ask Gemini for alternative suggestions
    const suggestions = await aiLayer.suggestAlternatives(question, state.apiKey);
    
    // Render suggestion links in the details block
    elements.aiSummaryBox.style.display = 'none';
    elements.manualStatsBox.style.display = 'block';
    elements.manualStatsBox.innerHTML = `
      <div class="manual-stats-title" style="color:var(--danger);">Suggested Questions</div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
        ${suggestions.map(s => `
          <a href="#" class="suggested-q-link" data-q="${s}" style="color:var(--accent-color); text-decoration:none; font-size:13px; line-height:1.4;">
            <i class="fa-solid fa-circle-question" style="margin-right:6px;"></i> "${s}"
          </a>
        `).join('')}
      </div>
    `;

    // Add click handler to alternative links
    document.querySelectorAll('.suggested-q-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        elements.searchInput.value = link.dataset.q;
        submitAIQuestion();
      });
    });
  } finally {
    elements.searchInput.removeAttribute('disabled');
    elements.btnSubmitQuestion.removeAttribute('disabled');
    elements.searchInput.focus();
  }
}

// Human readable string helper functions
function getReadableFilterString() {
  const parts = [];
  if (state.currentQuery.agency) parts.push(`Agency: ${state.currentQuery.agency}`);
  if (state.currentQuery.category) parts.push(`Category: ${state.currentQuery.category}`);
  if (state.currentQuery.subcategory) parts.push(`Subcategory: ${state.currentQuery.subcategory}`);
  if (state.currentQuery.vendor) parts.push(`Vendor: ${state.currentQuery.vendor}`);
  if (state.currentQuery.fiscal_year) parts.push(`FY: ${state.currentQuery.fiscal_year}`);
  if (state.currentQuery.min_amount) parts.push(`Min spend: $${state.currentQuery.min_amount.toLocaleString()}`);
  return parts.length > 0 ? parts.join(', ') : 'All State Spending';
}

function getReadableFilterBadgeString() {
  const parts = [];
  if (state.currentQuery.agency) parts.push(`Agency: <span class="filter-badge">${state.currentQuery.agency}</span>`);
  if (state.currentQuery.category) parts.push(`Category: <span class="filter-badge">${state.currentQuery.category}</span>`);
  if (state.currentQuery.subcategory) parts.push(`Subcategory: <span class="filter-badge">${state.currentQuery.subcategory}</span>`);
  if (state.currentQuery.vendor) parts.push(`Vendor: <span class="filter-badge">${state.currentQuery.vendor}</span>`);
  if (state.currentQuery.fiscal_year) parts.push(`FY: <span class="filter-badge">${state.currentQuery.fiscal_year}</span>`);
  if (state.currentQuery.min_amount) parts.push(`Min amount: <span class="filter-badge">$${state.currentQuery.min_amount.toLocaleString()}</span>`);
  return parts.length > 0 ? parts.join(' and ') : '<span class="filter-badge">No filters (All Data)</span>';
}
