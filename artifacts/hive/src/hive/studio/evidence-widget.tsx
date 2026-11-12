import { useEffect, useState } from 'react';
import { createWidgets } from 'ag-studio-react';
import type {
  AgDefaultRegistry,
  AgFieldRole,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetField,
  AgWidgetFieldReference,
  AgWidgetFormParams,
  AgWidgetParams,
  AgWidgetsConfig,
} from 'ag-studio';
import type { AgRegistry, AgWidgetDefinition } from 'ag-studio-react';

type SignalMapping = {
  alert: AgWidgetFieldReference[];
  severity: AgWidgetFieldReference[];
  rule: AgWidgetFieldReference[];
  score: AgWidgetFieldReference[];
  status: AgWidgetFieldReference[];
};

type SignalWidgetState = AgWidgetData<SignalMapping, AgWidgetDataFormat<unknown>>;
type SignalWidgetDefinition = AgWidgetDefinition<'hive-signal-pulse', SignalWidgetState>;

export type HiveStudioRegistry = Omit<AgRegistry, 'widgets'> & {
  widgets: readonly (AgDefaultRegistry['widgets'][number] | SignalWidgetDefinition)[];
};

const roles: AgFieldRole[] = ['category'];

function SignalPulse({ dataMapping, widgetApi }: AgWidgetParams<SignalWidgetState>) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const alertField = dataMapping.alert?.[0];
  const severityField = dataMapping.severity?.[0];
  const ruleField = dataMapping.rule?.[0];
  const scoreField = dataMapping.score?.[0];
  const statusField = dataMapping.status?.[0];

  useEffect(() => {
    if (!alertField || !severityField || !ruleField || !scoreField || !statusField) {
      setLoading(false);
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }

    let current = true;
    setLoading(true);
    setFailed(false);
    widgetApi.setDisplayState('loading', { prominent: false });

    widgetApi.getData({
      kind: 'flat',
      fields: [alertField, severityField, ruleField, scoreField, statusField],
      sort: [{ field: scoreField, direction: 'desc' }],
      limit: { count: 5 },
    }).then((response) => {
      if (!current) return;
      setRows(response.results.rows);
      setLoading(false);
      widgetApi.setDisplayState(response.results.rows.length ? 'displayed' : 'noData');
    }).catch(() => {
      if (!current) return;
      setRows([]);
      setLoading(false);
      setFailed(true);
      widgetApi.setDisplayState('displayed');
    });

    return () => { current = false; };
  }, [alertField, severityField, ruleField, scoreField, statusField, widgetApi]);

  if (loading) return <div className="hive-signal-empty">Reading the alert evidence…</div>;
  if (failed) return <div className="hive-signal-empty">Could not load the current signal list.</div>;
  if (!rows.length) return <div className="hive-signal-empty">No alerts match the current filters.</div>;
  if (!alertField || !severityField || !ruleField || !scoreField || !statusField) return null;

  const value = (row: Record<string, unknown>, field: AgWidgetField) => row[field.key];
  const severityLabel = (row: Record<string, unknown>) => String(value(row, severityField) ?? 'low');

  return (
    <div className="hive-signal-widget">
      <div className="hive-signal-caption">
        <span>TOP EVIDENCE-BACKED ALERTS</span>
        <span>Click an alert to filter the report</span>
      </div>
      <div className="hive-signal-list">
        {rows.map((row, index) => {
          const id = value(row, alertField);
          const severity = severityLabel(row);
          const score = Number(value(row, scoreField) ?? 0);
          return (
            <button
              key={String(id ?? index)}
              className="hive-signal-row"
              onClick={() => id != null && widgetApi.toggleCrossFilter({
                type: 'value',
                field: alertField,
                value: id,
                group: 0,
              })}
              title="Filter the other dashboard widgets to this alert"
            >
              <span className={`hive-signal-mark is-${severity}`} aria-hidden="true" />
              <span className="hive-signal-main">
                <strong>{String(value(row, ruleField) ?? 'Risk signal')}</strong>
                <small>{String(id ?? 'Alert')} · {String(value(row, statusField) ?? 'unreviewed')}</small>
              </span>
              <span className={`hive-signal-score is-${severity}`}>{Math.round(score)}<small>%</small></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const field = (supportedRoles: AgFieldRole[], label: string) => ({
  type: 'field' as const,
  supportedRoles,
  required: true,
  aiDescription: label,
});

const signalPulse: SignalWidgetDefinition = {
  id: 'hive-signal-pulse',
  label: 'Evidence signal queue',
  dataMapping: {
    alert: field(roles, 'Alert identifier from Wasp Radar.'),
    severity: field(roles, 'Alert severity: high, medium, or low.'),
    rule: field(roles, 'The deterministic rule that raised this alert.'),
    score: field(['numeric'], 'Risk score from 0 to 100; aggregate with max.'),
    status: field(roles, 'Current human review status.'),
  },
  defaultState: {
    dataMapping: {
      alert: [{ id: 'alerts.id' }],
      severity: [{ id: 'alerts.severity' }],
      rule: [{ id: 'alerts.rule' }],
      score: [{ id: 'alerts.score', aggregation: 'max' }],
      status: [{ id: 'alerts.status' }],
    },
  },
  form: (params: AgWidgetFormParams<SignalWidgetState>) => params.createDefaults({
    dataMappingItems: [
      { key: 'alert', label: 'Alert identifier' },
      { key: 'severity', label: 'Severity' },
      { key: 'rule', label: 'Risk rule' },
      { key: 'score', label: 'Risk score' },
      { key: 'status', label: 'Review status' },
    ],
  }),
  comp: SignalPulse,
  defaultSize: { width: 420, height: 320 },
  minSize: { width: 280, height: 220 },
  featureConfig: { crossFilter: { supportsHighlight: true } },
  ai: {
    description: 'A HIVE-specific queue of the five highest-scoring Wasp Radar alerts, with each alert backed by the live report data.',
    usage: 'Use on a risk or incident page when the reader needs a short, filterable priority queue. Do not describe scores as proof of fraud.',
  },
};

export const hiveStudioWidgets = (
  defaults: AgWidgetsConfig<AgDefaultRegistry>,
) => createWidgets<HiveStudioRegistry>({
  additionalTypes: [signalPulse],
  menu: [
    ...defaults.menu,
    { label: 'HIVE signals', widgetIds: ['hive-signal-pulse'] },
  ],
});
