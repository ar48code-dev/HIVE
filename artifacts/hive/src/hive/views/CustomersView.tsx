import { useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { themeQuartz, type ColDef } from 'ag-grid-community';
import { AgCharts } from 'ag-charts-react';
import type { AgCartesianChartOptions } from 'ag-charts-community';
import { api, money, when, type CustomerRow } from '../api';

const theme = themeQuartz.withParams({
  accentColor: '#B97C00', headerBackgroundColor: '#F3F1F6', borderColor: '#E1DCE8', foregroundColor: '#241A31',
  fontFamily: "'Public Sans', system-ui, sans-serif", headerFontFamily: "'Bricolage Grotesque', 'Public Sans', system-ui, sans-serif",
  headerFontWeight: 600, rowHoverColor: '#FBF4E2', fontSize: 14,
});

export function CustomersView() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<CustomerRow[]>('/api/customers').then(setRows).catch((e: Error) => setErr(e.message)); }, []);

  const cols = useMemo<ColDef<CustomerRow>[]>(() => [
    { headerName: 'Customer', field: 'customer', width: 130, pinned: 'left' },
    { headerName: 'Last 30 days', field: 'last30Cents', type: 'rightAligned', valueFormatter: (p) => money(p.value as number), sort: 'desc', width: 150, filter: 'agNumberColumnFilter' },
    { headerName: 'Share', field: 'shareOfLast30', type: 'rightAligned', valueFormatter: (p) => `${((p.value as number) * 100).toFixed(1)}%`, width: 100, filter: 'agNumberColumnFilter' },
    { headerName: 'All time', field: 'revenueCents', type: 'rightAligned', valueFormatter: (p) => money(p.value as number), width: 130, filter: 'agNumberColumnFilter' },
    { headerName: 'Payments', field: 'payments', type: 'rightAligned', width: 110, filter: 'agNumberColumnFilter' },
    { headerName: 'Refunds', field: 'refunds', type: 'rightAligned', width: 100, filter: 'agNumberColumnFilter' },
    { headerName: 'Refunded', field: 'refundCents', type: 'rightAligned', valueFormatter: (p) => money(p.value as number), width: 120, filter: 'agNumberColumnFilter' },
    { headerName: 'Failed', field: 'failed', type: 'rightAligned', width: 90, filter: 'agNumberColumnFilter' },
    { headerName: 'Repeat', field: 'repeat', valueFormatter: (p) => (p.value ? 'Yes' : 'No'), width: 100 },
    { headerName: 'First seen', field: 'firstAt', valueFormatter: (p) => when(p.value as number), width: 160 },
    { headerName: 'Last seen', field: 'lastAt', valueFormatter: (p) => when(p.value as number), width: 160 },
  ], []);

  const top = (rows ?? []).filter((r) => r.last30Cents > 0).sort((a, b) => b.last30Cents - a.last30Cents).slice(0, 8);
  const chart: AgCartesianChartOptions = {
    data: top.map((r) => ({ customer: r.customer, revenue: r.last30Cents / 100 })),
    background: { fill: 'transparent' }, legend: { enabled: false },
    series: [{ type: 'bar', direction: 'horizontal', xKey: 'customer', yKey: 'revenue', yName: 'Last 30 days', fill: '#E8A317' }],
    axes: [{ type: 'category', position: 'left' }, { type: 'number', position: 'bottom', label: { formatter: (p: { value: number }) => `$${p.value}` } }],
  };

  return (
    <section className="panel" aria-labelledby="cu-h">
      <h2 id="cu-h">Customers</h2>
      <p className="muted">Who brings money into the shop. Customers appear as short codes so personal details stay out of the screen.</p>
      {err && <p className="notice error" role="alert">{err}</p>}
      {!rows && !err && <p className="muted">Loading customers…</p>}
      {rows && (
        <>
          <h3>Top customers, last 30 days</h3>
          <div className="chart" role="img" aria-label="Bar chart of the eight customers who paid the most in the last 30 days">{top.length > 0 && <AgCharts options={chart} />}</div>
          <div className="grid-wrap short">
            <AgGridReact<CustomerRow> theme={theme} rowData={rows} columnDefs={cols} defaultColDef={{ sortable: true, resizable: true, filter: true }} pagination paginationPageSize={25} getRowId={(p) => p.data.customer} />
          </div>
        </>
      )}
    </section>
  );
}
