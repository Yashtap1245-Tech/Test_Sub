// charts.js — Visualization Renderer for PolicyLens (Chart.js & D3)
import { logger } from './logger.js';

let activeChartInstance = null;
let currentDrillDownHandler = null;

// Premium dark mode colors
const PALETTE = [
  '#4f8ef7', // Electric Blue
  '#818cf8', // Indigo
  '#2dd4bf', // Teal
  '#f43f5e', // Rose
  '#fbbf24', // Amber
  '#a78bfa', // Purple
  '#22d3ee', // Cyan
  '#f97316', // Orange
  '#34d399', // Emerald
  '#e879f9'  // Fuchsia
];

const TEXT_COLOR = '#94a3b8'; // Slate 400
const GRID_COLOR = '#334155'; // Slate 700

export const charts = {
  setDrillDownHandler(handler) {
    currentDrillDownHandler = handler;
  },

  destroyActiveChart() {
    if (activeChartInstance) {
      activeChartInstance.destroy();
      activeChartInstance = null;
    }
    const treemapContainer = document.getElementById('treemap-container');
    if (treemapContainer) {
      treemapContainer.innerHTML = '';
      treemapContainer.style.display = 'none';
    }
    const canvas = document.getElementById('main-chart-canvas');
    if (canvas) {
      canvas.style.display = 'block';
    }
  },

  render(type, data, options = {}) {
    this.destroyActiveChart();
    logger.event('chart_render_started', { type, dataPoints: data.length });

    const canvas = document.getElementById('main-chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Clean data: exclude 'Other' from some detailed breakdowns if empty, limit to positive values
    const chartData = data.filter(d => d.value > 0);

    if (chartData.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No spending data meets these criteria to plot.', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Format numbers nicely
    const formatCurrency = (val) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
      }).format(val);
    };

    switch (type) {
      case 'bar':
        this.renderHorizontalBar(ctx, chartData, formatCurrency, options);
        break;
      case 'line':
        this.renderLine(ctx, chartData, formatCurrency, options);
        break;
      case 'doughnut':
        this.renderDoughnut(ctx, chartData, formatCurrency, options);
        break;
      case 'scatter':
        this.renderScatter(ctx, chartData, formatCurrency, options);
        break;
      case 'treemap':
        this.renderTreemapD3(chartData, formatCurrency, options);
        break;
      default:
        this.renderHorizontalBar(ctx, chartData, formatCurrency, options);
    }
  },

  renderHorizontalBar(ctx, data, formatter, options) {
    const labels = data.map(d => d.label);
    const values = data.map(d => d.value);

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
    gradient.addColorStop(0, '#4f8ef722');
    gradient.addColorStop(1, '#4f8ef7aa');

    activeChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: data.map((d, i) => d.isOther ? '#475569aa' : (PALETTE[i % PALETTE.length] + 'bb')),
          borderColor: data.map((d, i) => d.isOther ? '#64748b' : PALETTE[i % PALETTE.length]),
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` Spend: ${formatter(context.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: GRID_COLOR },
            ticks: {
              color: TEXT_COLOR,
              callback: (value) => formatter(value)
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: TEXT_COLOR }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0 && currentDrillDownHandler) {
            const index = elements[0].index;
            const clickedLabel = labels[index];
            if (clickedLabel !== 'Other') {
              logger.event('chart_item_clicked', { label: clickedLabel, chart: 'bar' });
              currentDrillDownHandler(clickedLabel);
            }
          }
        }
      }
    });
  },

  renderLine(ctx, data, formatter, options) {
    // Sort months chronologically
    // FMonth values '01'-'12' (FY22), '13'-'24' (FY23).
    // Let's map month index keys to readable months:
    // '01' -> 'Jul 2021', '02' -> 'Aug 2021', ... '12' -> 'Jun 2022'
    // '13' -> 'Jul 2022', ... '24' -> 'Jun 2023'
    const monthNames = {
      '01': 'Jul 2021', '02': 'Aug 2021', '03': 'Sep 2021', '04': 'Oct 2021',
      '05': 'Nov 2021', '06': 'Dec 2021', '07': 'Jan 2022', '08': 'Feb 2022',
      '09': 'Mar 2022', '10': 'Apr 2022', '11': 'May 2022', '12': 'Jun 2022',
      '13': 'Jul 2022', '14': 'Aug 2022', '15': 'Sep 2022', '16': 'Oct 2022',
      '17': 'Nov 2022', '18': 'Dec 2022', '19': 'Jan 2023', '20': 'Feb 2023',
      '21': 'Mar 2023', '22': 'Apr 2023', '23': 'May 2023', '24': 'Jun 2023'
    };

    // Sort the keys so line reads left-to-right chronologically
    const sortedData = [...data].sort((x, y) => {
      return parseInt(x.label) - parseInt(y.label);
    });

    const labels = sortedData.map(d => monthNames[d.label] || `Month ${d.label}`);
    const values = sortedData.map(d => d.value);

    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, '#818cf855');
    gradient.addColorStop(1, '#818cf800');

    activeChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: '#818cf8',
          backgroundColor: gradient,
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointBackgroundColor: '#818cf8',
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` Spend: ${formatter(context.raw)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: GRID_COLOR },
            ticks: { color: TEXT_COLOR }
          },
          y: {
            grid: { color: GRID_COLOR },
            ticks: {
              color: TEXT_COLOR,
              callback: (value) => formatter(value)
            }
          }
        }
      }
    });
  },

  renderDoughnut(ctx, data, formatter, options) {
    const labels = data.map(d => d.label);
    const values = data.map(d => d.value);

    activeChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: data.map((d, i) => d.isOther ? '#475569bb' : (PALETTE[i % PALETTE.length] + 'cc')),
          borderColor: '#0f172a',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: TEXT_COLOR,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => ` Spend: ${formatter(context.raw)}`
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0 && currentDrillDownHandler) {
            const index = elements[0].index;
            const clickedLabel = labels[index];
            if (clickedLabel !== 'Other') {
              logger.event('chart_item_clicked', { label: clickedLabel, chart: 'doughnut' });
              currentDrillDownHandler(clickedLabel);
            }
          }
        }
      }
    });
  },

  renderScatter(ctx, data, formatter, options) {
    // Scatter aggregates total spend (X axis) vs transaction count (Y axis) for each label
    // This helps policy analysts see concentration: high spend + low count (big contracts) vs low spend + high count (frequent small bills)
    const scatterData = data.map((d, i) => ({
      x: d.value,
      y: d.count,
      label: d.label,
      color: PALETTE[i % PALETTE.length]
    }));

    activeChartInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          data: scatterData,
          backgroundColor: scatterData.map(d => d.color + 'aa'),
          borderColor: scatterData.map(d => d.color),
          borderWidth: 1,
          pointRadius: 6,
          pointHoverRadius: 9
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const pt = context.raw;
                return ` ${pt.label}: ${formatter(pt.x)} (${pt.y} txs)`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'logarithmic', // log scale because vendor amounts span 6 orders of magnitude!
            title: { display: true, text: 'Total Spend (Log Scale)', color: TEXT_COLOR },
            grid: { color: GRID_COLOR },
            ticks: {
              color: TEXT_COLOR,
              callback: (value) => formatter(value)
            }
          },
          y: {
            type: 'logarithmic',
            title: { display: true, text: 'Transaction Count (Log Scale)', color: TEXT_COLOR },
            grid: { color: GRID_COLOR },
            ticks: { color: TEXT_COLOR }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0 && currentDrillDownHandler) {
            const index = elements[0].index;
            const clickedLabel = scatterData[index].label;
            if (clickedLabel !== 'Other') {
              logger.event('chart_item_clicked', { label: clickedLabel, chart: 'scatter' });
              currentDrillDownHandler(clickedLabel);
            }
          }
        }
      }
    });
  },

  renderTreemapD3(data, formatter, options) {
    const canvas = document.getElementById('main-chart-canvas');
    const container = document.getElementById('treemap-container');
    if (!canvas || !container) return;

    canvas.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = ''; // Clear previous

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    // Create D3 treemap hierarchy
    // Root node
    const rootData = {
      name: 'Spend',
      children: data.map((d, i) => ({
        name: d.label,
        value: d.value,
        color: d.isOther ? '#475569' : PALETTE[i % PALETTE.length]
      }))
    };

    const root = d3.hierarchy(rootData)
      .sum(d => d.value)
      .sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([width, height])
      .padding(2.5)(root);

    // Create SVG container
    const svg = d3.select('#treemap-container')
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('font-family', 'sans-serif');

    // Create leaf groups
    const leaf = svg.selectAll('g')
      .data(root.leaves())
      .enter()
      .append('g')
      .attr('transform', d => `translate(${d.x0},${d.y0})`);

    // Add rectangles
    leaf.append('rect')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => d.data.color)
      .attr('rx', 3)
      .style('cursor', d => d.data.name === 'Other' ? 'default' : 'pointer')
      .style('opacity', 0.85)
      .on('mouseover', function () {
        d3.select(this).style('opacity', 1.0);
      })
      .on('mouseout', function () {
        d3.select(this).style('opacity', 0.85);
      })
      .on('click', (event, d) => {
        if (d.data.name !== 'Other' && currentDrillDownHandler) {
          logger.event('chart_item_clicked', { label: d.data.name, chart: 'treemap' });
          currentDrillDownHandler(d.data.name);
        }
      });

    // Add labels
    leaf.append('text')
      .attr('x', 5)
      .attr('y', 18)
      .attr('fill', '#ffffff')
      .style('font-weight', '600')
      .style('font-size', '11px')
      .style('pointer-events', 'none')
      .text(d => {
        const w = d.x1 - d.x0;
        if (w < 60) return '';
        // Truncate if label too long
        const label = d.data.name;
        if (label.length * 6 > w) {
          return label.substring(0, Math.floor(w / 7)) + '...';
        }
        return label;
      });

    // Add values
    leaf.append('text')
      .attr('x', 5)
      .attr('y', 32)
      .attr('fill', '#e2e8f0')
      .style('font-size', '10px')
      .style('pointer-events', 'none')
      .text(d => {
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        if (w < 60 || h < 40) return '';
        return formatter(d.data.value);
      });

    // Add simple title tooltip
    leaf.append('title')
      .text(d => `${d.data.name}\nSpend: ${formatter(d.data.value)}`);
  }
};
