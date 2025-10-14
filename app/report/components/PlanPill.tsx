export type PillState =
  | "Finding client"
  | "Locating PDF"
  | "Extracting"
  | "Drafting"
  | "Done";

export default function PlanPill({ state, active = false }: { state: PillState; active?: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '6px 10px',
      borderRadius: 12,
      background: active ? '#e0e7ff' : '#eef2ff',
      border: '1px solid #c7d2fe',
      color: active ? '#1e3a8a' : '#3730a3',
      fontSize: 12,
      marginRight: 8,
      opacity: active ? 1 : 0.85,
    }}>{state}</span>
  );
}


