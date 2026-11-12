# How HIVE uses AG Grid, AG Charts and AG Studio

**AG Studio dashboard (`../../src/hive/studio/`, `../../src/hive/views/StudioView.tsx`)**
- Data sources built from HIVE's own transactions, alerts and customers, with relationships, a calendar and three calculated fields (refund rate, fee rate, kept after refunds and fees).
- A three-page report: money overview (value tiles with sparklines, a combo chart, two gauges, a date filter), risk and alerts (button filter, bar and donut charts, grid), customers (treemap of 30-day concentration, grid).
- A custom theme in HIVE's plum and amber palette, edit mode so the owner can change widgets, and lazy loading so the rest of the app stays light.
- The evidence signal queue is a custom widget (`../../src/hive/studio/evidence-widget.tsx`). The report assistant is implemented in `../../src/hive/studio/ai.ts`; it is limited to synthetic demo mode so live transaction details are not sent from this dashboard.

**AG Grid (`../../src/hive/views/AnalyticsView.tsx`)**: filters, search, row selection linked from alerts, answers, estimates and honeycomb days.

**AG Charts**: the revenue chart on the Hive screen.

Licence: AG Studio can be tried locally without a key. A trial/license key is needed for production use and to remove the trial notice; set `AG_STUDIO_LICENSE` through the host's secret store.
