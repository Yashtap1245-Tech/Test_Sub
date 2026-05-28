// queryEngine.js — Client-side Filter & Aggregation Engine for PolicyLens
import { logger } from './logger.js';

let summaryData = [];
let vendorsData = [];
let isVendorsLoading = false;
let vendorsLoadedCallback = null;

export const queryEngine = {
  setSummaryData(data) {
    summaryData = data;
    logger.event('data_loaded', { type: 'summary', records: data.length });
  },

  setVendorsData(data) {
    vendorsData = data;
    logger.event('data_loaded', { type: 'vendors', records: data.length });
    if (vendorsLoadedCallback) {
      vendorsLoadedCallback();
    }
  },

  onVendorsLoaded(callback) {
    vendorsLoadedCallback = callback;
  },

  isVendorsLoaded() {
    return vendorsData.length > 0;
  },

  loadVendors(fetchUrl) {
    if (this.isVendorsLoaded() || isVendorsLoading) return;
    isVendorsLoading = true;
    logger.event('vendors_load_started', { url: fetchUrl });
    
    fetch(fetchUrl)
      .then(res => res.json())
      .then(data => {
        isVendorsLoading = false;
        this.setVendorsData(data);
      })
      .catch(err => {
        isVendorsLoading = false;
        logger.event('vendors_load_failed', { error: err.message });
        console.error('Error loading vendors data:', err);
      });
  },

  /**
   * Run a structured query filter on the dataset
   * @param {Object} queryObj 
   * @returns {Object} { results: Array, metadata: Object }
   */
  executeQuery(queryObj) {
    const startTime = performance.now();
    
    if (queryObj.out_of_scope) {
      logger.event('query_blocked_out_of_scope', { query: queryObj });
      return {
        results: [],
        error: 'out_of_scope',
        message: 'The requested query is outside the scope of the Washington State Vendor Payments dataset (FY2022-2023).',
        meta: {
          totalSpend: 0,
          totalTransactions: 0,
          dataSetUsed: 'none',
          durationMs: performance.now() - startTime
        }
      };
    }
    
    // 1. Determine which dataset to use
    // If the query filters by vendor or groups by vendor, we must use vendorsData.
    const useVendors = queryObj.vendor || queryObj.group_by === 'vendor' || (queryObj.search_term && queryObj.search_term_type === 'vendor');
    
    if (useVendors && !this.isVendorsLoaded()) {
      logger.event('query_blocked_vendors_loading', { query: queryObj });
      return {
        results: [],
        error: 'vendor_data_loading',
        message: 'Vendor payments dataset is loading. Please wait a moment and try again.'
      };
    }

    const dataSet = useVendors ? vendorsData : summaryData;
    let filtered = [];

    // 2. Perform filtering
    for (let i = 0; i < dataSet.length; i++) {
      const row = dataSet[i];
      let matches = true;

      // Filter by Agency
      if (queryObj.agency) {
        // Handle array of agencies or single agency string
        const targetAgency = queryObj.agency.toLowerCase().trim();
        const rowAgency = (row.a || '').toLowerCase().trim();
        if (Array.isArray(queryObj.agency)) {
          matches = queryObj.agency.some(a => rowAgency.includes(a.toLowerCase().trim()));
        } else {
          matches = rowAgency.includes(targetAgency) || targetAgency.includes(rowAgency);
        }
      }

      // Filter by Category
      if (matches && queryObj.category) {
        const targetCat = queryObj.category.toLowerCase().trim();
        const rowCat = (row.c || '').toLowerCase().trim();
        if (Array.isArray(queryObj.category)) {
          matches = queryObj.category.some(c => rowCat.includes(c.toLowerCase().trim()));
        } else {
          matches = rowCat.includes(targetCat) || targetCat.includes(rowCat);
        }
      }

      // Filter by SubCategory (only in summaryData)
      if (matches && queryObj.subcategory && !useVendors) {
        const targetSub = queryObj.subcategory.toLowerCase().trim();
        const rowSub = (row.s || '').toLowerCase().trim();
        matches = rowSub.includes(targetSub) || targetSub.includes(rowSub);
      }

      // Filter by Vendor (only in vendorsData)
      if (matches && queryObj.vendor && useVendors) {
        const targetVendor = queryObj.vendor.toLowerCase().trim();
        const rowVendor = (row.v || '').toLowerCase().trim();
        matches = rowVendor.includes(targetVendor) || targetVendor.includes(rowVendor);
      }

      // Filter by Fiscal Year
      if (matches && queryObj.fiscal_year) {
        matches = String(row.y) === String(queryObj.fiscal_year);
      }

      // Range Filter on Amount (value/val)
      if (matches && queryObj.min_amount !== undefined) {
        const val = useVendors ? row.val : row.v;
        matches = val >= queryObj.min_amount;
      }
      if (matches && queryObj.max_amount !== undefined) {
        const val = useVendors ? row.val : row.v;
        matches = val <= queryObj.max_amount;
      }

      if (matches) {
        filtered.push(row);
      }
    }

    // 3. Perform Aggregation
    const groupBy = queryObj.group_by || 'category';
    const metric = queryObj.metric || 'total_amount';
    
    // aggregation map: key -> { label, sum, count }
    const aggMap = new Map();

    for (let i = 0; i < filtered.length; i++) {
      const row = filtered[i];
      let key = '';
      
      if (groupBy === 'agency') key = row.a;
      else if (groupBy === 'category') key = row.c;
      else if (groupBy === 'subcategory') key = useVendors ? 'N/A (Vendors summary)' : row.s;
      else if (groupBy === 'vendor') key = useVendors ? row.v : 'N/A (Summary data)';
      else if (groupBy === 'year') key = row.y;
      else if (groupBy === 'month') key = row.m || 'N/A';
      else key = 'All';

      const val = useVendors ? row.val : row.v;

      if (!aggMap.has(key)) {
        aggMap.set(key, { label: key, sum: 0, count: 0 });
      }
      const node = aggMap.get(key);
      node.sum += val;
      node.count += 1;
    }

    // Convert map to array
    let aggregatedResults = Array.from(aggMap.values()).map(item => ({
      label: item.label,
      value: Math.round(item.sum * 100) / 100,
      count: item.count
    }));

    // 4. Sorting
    const sortOrder = queryObj.sort || 'desc';
    aggregatedResults.sort((x, y) => {
      const valX = metric === 'tx_count' ? x.count : x.value;
      const valY = metric === 'tx_count' ? y.count : y.value;
      return sortOrder === 'desc' ? valY - valX : valX - valY;
    });

    // 5. Limit results
    const limit = queryObj.limit || 15;
    const finalResults = aggregatedResults.slice(0, limit);

    // If there were items sliced off, group them into an "Other" category for completeness
    if (aggregatedResults.length > limit) {
      let otherSum = 0;
      let otherCount = 0;
      for (let i = limit; i < aggregatedResults.length; i++) {
        otherSum += aggregatedResults[i].value;
        otherCount += aggregatedResults[i].count;
      }
      finalResults.push({
        label: 'Other',
        value: Math.round(otherSum * 100) / 100,
        count: otherCount,
        isOther: true
      });
    }

    const duration = performance.now() - startTime;
    logger.event('query_executed', {
      query: queryObj,
      dataSetUsed: useVendors ? 'vendors' : 'summary',
      filteredRowCount: filtered.length,
      resultCount: finalResults.length,
      durationMs: duration
    });

    return {
      results: finalResults,
      meta: {
        totalSpend: Math.round(filtered.reduce((sum, r) => sum + (useVendors ? r.val : r.v), 0) * 100) / 100,
        totalTransactions: filtered.length,
        dataSetUsed: useVendors ? 'vendors' : 'summary',
        durationMs: duration
      }
    };
  }
};
