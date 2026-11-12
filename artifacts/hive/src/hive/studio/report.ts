// The HIVE report: three pages built on AG Studio widgets. Field ids refer to ./data.ts.
import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });
const FONT = "'Public Sans', system-ui, sans-serif";
const typo = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({ fontFamily: FONT, fontSize, fontWeight, fontStyle: 'normal' as const });

const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'countd' }, sparklineX?: string) => ({
  type: 'value' as const,
  dataMapping: { value: [value], ...(sparklineX && { sparklineX: [{ id: sparklineX }] }) },
  format: {
    title: { enabled: true, text, typography: typo(14, 'bold') },
    caption: { enabled: true, text: '', typography: typo(0) },
    style: { typography: typo(24) },
  },
});

const overview: AgPageState = {
  id: 'overview',
  widgets: {
    period: { type: 'date-filter', dataMapping: { value: [{ id: 'transactions.date' }] }, format: { style: { filterType: 'relative' } } },
    'kpi-revenue': kpi('Revenue', sum('transactions.paymentAmount'), 'calendar::day'),
    'kpi-refunds': kpi('Refunded', sum('transactions.refundAmount'), 'calendar::day'),
    'kpi-fees': kpi('PayPal fees', sum('transactions.feeAmount'), 'calendar::day'),
    'kpi-net': kpi('Kept', sum('transactions.netCash'), 'calendar::day'),
    'money-by-day': {
      type: 'combo-chart-grouped-column-line',
      dataMapping: {
        categoryKey: [{ id: 'calendar::day' }],
        valueKey: [sum('transactions.paymentAmount'), sum('transactions.refundAmount')],
        secondaryValueKey: [{ id: 'refundRate' }],
      },
      format: { ...title('Payments and refunds by day, with refund rate'), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    'refund-rate': {
      type: 'radial-gauge',
      dataMapping: { value: [{ id: 'refundRate' }] },
      format: {
        ...title('Refund rate'),
        style: { scaleLabel: { min: 0, max: 0.3 }, label: { typography: typo(24, 'bold') }, secondaryLabel: { enabled: true, text: 'refunded', typography: typo(12) } },
      },
    },
    'keep-rate': {
      type: 'radial-gauge',
      dataMapping: { value: [{ id: 'keepRate' }] },
      format: {
        ...title('Kept after refunds and fees'),
        style: { scaleLabel: { min: 0, max: 1 }, label: { typography: typo(24, 'bold') }, secondaryLabel: { enabled: true, text: 'kept', typography: typo(12) } },
      },
    },
    'by-source': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'transactions.kind' }], valueKey: [countd('transactions.id')] },
      format: title('Transactions by kind'),
    },
  },
  widgetLayout: {
    'kpi-revenue': at(0, 0, 4, 7), 'kpi-refunds': at(4, 0, 4, 7), 'kpi-fees': at(8, 0, 4, 7), 'kpi-net': at(12, 0, 4, 7), period: at(16, 0, 8, 7),
    'money-by-day': at(0, 7, 16, 17), 'refund-rate': at(16, 7, 8, 11), 'keep-rate': at(16, 18, 8, 11), 'by-source': at(0, 24, 16, 10),
  },
};

const risk: AgPageState = {
  id: 'risk',
  widgets: {
    'kpi-alerts': kpi('Alerts', countd('alerts.id')),
    'kpi-evidence': kpi('Evidence transactions', sum('alerts.evidenceCount')),
    'kpi-pending': kpi('Pending actions', sum('alerts.pendingActions')),
    severity: { type: 'button-filter', dataMapping: { value: [{ id: 'alerts.severity' }] }, format: { ...title('Severity'), style: { selection: { type: 'multiple' }, dimensions: { height: 28, minWidth: 56 } } } },
    'by-rule': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'alerts.rule' }], valueKey: [countd('alerts.id')] },
      format: title('Alerts by rule'),
    },
    'signal-pulse': {
      type: 'hive-signal-pulse' as never,
      dataMapping: {
        alert: [{ id: 'alerts.id' }],
        severity: [{ id: 'alerts.severity' }],
        rule: [{ id: 'alerts.rule' }],
        score: [{ id: 'alerts.score', aggregation: 'max' }],
        status: [{ id: 'alerts.status' }],
      },
      format: title('Evidence-backed risk queue'),
    },
    'alert-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'alerts.id' }, { id: 'alerts.severity' }, { id: 'alerts.rule' }, { id: 'alerts.score', aggregation: 'max' as const }, sum('alerts.evidenceCount'),
          { id: 'alerts.status' }, { id: 'alerts.customer' }, { id: 'alerts.triggerKind' }, sum('alerts.triggerAmount'),
        ],
      },
      sort: [{ field: { id: 'alerts.score', aggregation: 'max' as const }, direction: 'desc' }],
      format: title('Alerts and the transactions that triggered them'),
    },
  },
  widgetLayout: {
    'kpi-alerts': at(0, 0, 5, 7), 'kpi-evidence': at(5, 0, 5, 7), 'kpi-pending': at(10, 0, 5, 7), severity: at(15, 0, 9, 7),
    'by-rule': at(0, 7, 14, 16), 'signal-pulse': at(14, 7, 10, 16), 'alert-grid': at(0, 23, 24, 20),
  },
};

const customers: AgPageState = {
  id: 'customers',
  widgets: {
    'kpi-customers': kpi('Customers', countd('customers.customer')),
    'kpi-repeat': kpi('Repeat customers', { id: 'customers.customer', aggregation: 'countd' }),
    concentration: {
      type: 'treemap-chart',
      dataMapping: { categoryKey: [{ id: 'customers.kind' }, { id: 'customers.customer' }], valueKey: [sum('customers.last30')] },
      format: title('30-day revenue by customer (concentration)'),
    },
    'customer-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'customers.customer' }, { id: 'customers.kind' }, sum('customers.payments'), sum('customers.refunds'), sum('customers.failed'),
          sum('customers.last30'), sum('customers.refundTotal'), sum('customers.share30'),
        ],
      },
      sort: [{ field: sum('customers.last30'), direction: 'desc' }],
      format: title('Customers'),
    },
  },
  widgetLayout: { 'kpi-customers': at(0, 0, 6, 7), 'kpi-repeat': at(6, 0, 6, 7), concentration: at(0, 7, 12, 18), 'customer-grid': at(12, 7, 12, 18) },
};

export const hiveReport: AgReportState<any> = { selectedPageId: overview.id, pages: [overview, risk, customers] };
export const PAGE_TITLES: Record<string, string> = { overview: 'Money overview', risk: 'Risk and alerts', customers: 'Customers' };
