"use client";

import { useState } from "react";
import Hjson from "hjson";
import { COMMON_MATERIALS, ENUM_FOR_KEY, PLUGIN_ENUMS } from "@/lib/plugin-enums";
import { describeRawParts } from "@/lib/elements";

const MATERIALS_LIST_ID = "vp-materials-list";

/**
 * A structured, form-based editor for a VehiclesPlus config. Parses the HJSON once and renders nice
 * typed fields (text / number / toggle / colour picker / lists / nested sections) for every key —
 * including ones we don't specially know about — then serialises back to HJSON on every change.
 *
 * Layout: top-level primitives go in a "General" card; each nested object/array becomes a collapsible
 * section; and `parts[]` items render as colour-coded, collapsible cards that match the 3D markers.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isPlainObject(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isColor(v: unknown): v is { red?: number; green?: number; blue?: number } {
  return isPlainObject(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k === "red" || k === "green" || k === "blue");
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, "0");

function rgbToHex(c: { red?: number; green?: number; blue?: number }): string {
  return `#${hex2(c.red ?? 0)}${hex2(c.green ?? 0)}${hex2(c.blue ?? 0)}`;
}
function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  return { red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16) };
}

function labelize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

const inputCls =
  "rounded-md border border-neutral-700 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-200 outline-none transition focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30";

function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className={`${inputCls} w-full`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
}

function NumberField({ value, onChange, className = "w-28" }: { value: number; onChange: (v: number) => void; className?: string }) {
  // Local string state so intermediate edits like "1." or "-" aren't clobbered by re-serialisation.
  const [local, setLocal] = useState(String(value));
  return (
    <input
      className={`${inputCls} ${className}`}
      value={local}
      inputMode="decimal"
      onChange={(e) => {
        setLocal(e.target.value);
        const n = parseFloat(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

function BoolField({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`h-5 w-9 shrink-0 rounded-full px-0.5 transition ${value ? "bg-amber-500" : "bg-neutral-700"}`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white transition ${value ? "translate-x-4" : ""}`} />
    </button>
  );
}

function ColorField({ value, onChange }: { value: { red?: number; green?: number; blue?: number }; onChange: (v: Json) => void }) {
  const hex = rgbToHex(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(hexToRgb(e.target.value))}
        className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-900"
      />
      <span className="font-mono text-[11px] text-neutral-500">{hex}</span>
    </div>
  );
}

function SelectField({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (v: Json) => void }) {
  const opts = options.includes(value) ? options : [value, ...options]; // keep an unknown current value selectable
  return (
    <select className={`${inputCls} w-full`} value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function MaterialField({ value, onChange }: { value: string; onChange: (v: Json) => void }) {
  // Bukkit Material is a huge, version-specific enum, so this stays free text with suggestions.
  return (
    <input
      className={`${inputCls} w-full`}
      value={value}
      list={MATERIALS_LIST_ID}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
    />
  );
}

function Field({ value, onChange, fieldKey }: { value: Json; onChange: (v: Json) => void; fieldKey?: string }) {
  if (isColor(value)) return <ColorField value={value} onChange={onChange} />;
  if (Array.isArray(value)) return <ArrayField value={value} onChange={onChange} fieldKey={fieldKey} />;
  if (isPlainObject(value)) return <ObjectField value={value} onChange={onChange} />;
  if (typeof value === "boolean") return <BoolField value={value} onChange={onChange} />;
  if (typeof value === "number") return <NumberField value={value} onChange={onChange} />;
  // String/null: prefer a dropdown for known finite-choice fields, then a material autocomplete.
  const str = value == null ? "" : String(value);
  if (fieldKey === "material") return <MaterialField value={str} onChange={onChange} />;
  const enumKey = fieldKey ? ENUM_FOR_KEY[fieldKey] : undefined;
  if (enumKey) return <SelectField value={str} options={PLUGIN_ENUMS[enumKey]} onChange={onChange} />;
  return <TextField value={str} onChange={onChange} />;
}

/** A primitive is shown inline (label + control on one row); objects/arrays get their own block. */
function isInline(v: Json): boolean {
  return isColor(v) || !(Array.isArray(v) || isPlainObject(v));
}

const OFFSET_KEYS = ["xoffset", "yoffset", "zoffset"] as const;

/** Label + control on one row. */
function InlineRow({ label, value, onChange, fieldKey }: { label: string; value: Json; onChange: (v: Json) => void; fieldKey: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="shrink-0 text-xs text-neutral-400">{label}</label>
      <Field value={value} onChange={onChange} fieldKey={fieldKey} />
    </div>
  );
}

function ObjectField({ value, onChange }: { value: Record<string, Json>; onChange: (v: Json) => void }) {
  const keys = Object.keys(value);
  const hasOffset = OFFSET_KEYS.every((k) => typeof value[k] === "number");
  const rest = hasOffset ? keys.filter((k) => !OFFSET_KEYS.includes(k as (typeof OFFSET_KEYS)[number])) : keys;
  const set = (key: string) => (nv: Json) => onChange({ ...value, [key]: nv });

  return (
    <div className="space-y-2">
      {hasOffset && (
        <div className="flex items-center justify-between gap-3">
          <label className="shrink-0 text-xs text-neutral-400">Offset</label>
          <div className="flex gap-1">
            {OFFSET_KEYS.map((k, i) => (
              <div key={k} className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-neutral-600">{"xyz"[i]}</span>
                <NumberField value={value[k] as number} onChange={set(k)} className="w-16" />
              </div>
            ))}
          </div>
        </div>
      )}
      {rest.map((key) => {
        const v = value[key];
        if (isInline(v)) return <InlineRow key={key} label={labelize(key)} value={v} onChange={set(key)} fieldKey={key} />;
        return (
          <div key={key} className="rounded-md border border-neutral-800 bg-neutral-900/30 p-2">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{labelize(key)}</div>
            <Field value={v} onChange={set(key)} fieldKey={key} />
          </div>
        );
      })}
    </div>
  );
}

function templateFrom(items: Json[]): Json {
  const last = items[items.length - 1];
  if (typeof last === "number") return 0;
  if (typeof last === "boolean") return false;
  if (typeof last === "string") return "";
  if (isColor(last)) return { red: 255, green: 255, blue: 255 };
  if (Array.isArray(last)) return [];
  if (isPlainObject(last)) return JSON.parse(JSON.stringify(last)); // clone the shape of an existing item
  return "";
}

/** A collapsible card for one object inside an array (e.g. a part / seat), with a coloured title. */
function ItemCard({
  title,
  color,
  emoji,
  value,
  onChange,
  onRemove,
  defaultOpen = false,
}: {
  title: string;
  color: string;
  emoji?: string;
  value: Record<string, Json>;
  onChange: (v: Json) => void;
  onRemove: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/40">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          {emoji && <span className="shrink-0 text-[13px] leading-none">{emoji}</span>}
          <span className="truncate text-xs font-medium text-neutral-200">{title}</span>
          <span className="ml-auto text-neutral-600">{open ? "▾" : "▸"}</span>
        </button>
        <button onClick={onRemove} title="Remove" className="rounded px-1 text-neutral-600 hover:bg-neutral-800 hover:text-red-400">
          ×
        </button>
      </div>
      {open && (
        <div className="border-t border-neutral-800 px-2 py-2">
          <ObjectField value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function ArrayField({ value, onChange, fieldKey }: { value: Json[]; onChange: (v: Json) => void; fieldKey?: string }) {
  const enumKey = fieldKey ? ENUM_FOR_KEY[fieldKey] : undefined;
  const addItem = () => onChange([...value, enumKey ? PLUGIN_ENUMS[enumKey][0] : value.length ? templateFrom(value) : ""]);
  const replace = (i: number) => (nv: Json) => onChange(value.map((it, j) => (j === i ? nv : it)));
  const remove = (i: number) => () => onChange(value.filter((_, j) => j !== i));

  // Colour-coded titles for object-array items so parts/seats read like the 3D markers.
  const meta =
    fieldKey === "parts"
      ? describeRawParts(value.map((it) => (isPlainObject(it) ? { type: it.type as string, steer: it.steer as boolean } : {})))
      : null;

  return (
    <div className="space-y-1.5">
      {value.map((item, i) => {
        if (isPlainObject(item) && !isColor(item)) {
          const m = meta?.[i];
          return (
            <ItemCard
              key={i}
              title={m?.label ?? `Item ${i + 1}`}
              color={m?.color ?? "#6b7280"}
              emoji={m?.emoji}
              value={item}
              onChange={replace(i)}
              onRemove={remove(i)}
              defaultOpen={value.length === 1}
            />
          );
        }
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <Field value={item} onChange={replace(i)} fieldKey={fieldKey} />
            </div>
            <button
              onClick={remove(i)}
              title="Remove"
              className="mt-0.5 rounded px-1.5 text-neutral-600 hover:bg-neutral-800 hover:text-red-400"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={addItem}
        className="w-full rounded-md border border-dashed border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 transition hover:border-neutral-500 hover:text-neutral-200"
      >
        + Add
      </button>
    </div>
  );
}

/** A collapsible top-level section (one nested object/array, or the "General" group). */
function Section({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-neutral-800/40"
      >
        <span className="text-[12px] font-semibold uppercase tracking-wide text-neutral-300">{title}</span>
        {badge != null && (
          <span className="rounded-full bg-neutral-800 px-1.5 text-[10px] font-medium text-neutral-400">{badge}</span>
        )}
        <span className="ml-auto text-neutral-600">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-neutral-800 px-3 py-2.5">{children}</div>}
    </div>
  );
}

export default function ConfigForm({
  text,
  onChange,
  json = false,
}: {
  text: string;
  onChange: (text: string) => void;
  /** Serialise edits as strict JSON (V4 `.vppack`, read by the plugin's Gson) instead of HJSON (V3). */
  json?: boolean;
}) {
  const [data, setData] = useState<Json | null>(() => {
    try {
      return Hjson.parse(text) as Json; // HJSON is a JSON superset, so this parses both
    } catch {
      return null;
    }
  });

  if (data == null || !isPlainObject(data)) {
    // Malformed config — fall back to a raw editor so it's still fixable.
    return (
      <div className="flex flex-1 flex-col">
        <div className="px-1 pb-1 text-[11px] text-red-400">Couldn&apos;t parse as a config — editing raw text.</div>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-xs text-neutral-200 outline-none"
        />
      </div>
    );
  }

  const update = (next: Json) => {
    setData(next);
    onChange(json ? JSON.stringify(next, null, 2) : Hjson.stringify(next, { bracesSameLine: false, separator: false }));
  };
  const setKey = (key: string) => (nv: Json) => update({ ...data, [key]: nv });

  const keys = Object.keys(data);
  const loose = keys.filter((k) => isInline(data[k])); // primitives → one "General" card
  const sections = keys.filter((k) => !isInline(data[k])); // objects / arrays → their own section

  return (
    <div className="flex-1 space-y-2 overflow-y-auto pr-1">
      <datalist id={MATERIALS_LIST_ID}>
        {COMMON_MATERIALS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {loose.length > 0 && (
        <Section title="General">
          <div className="space-y-2">
            {loose.map((key) => (
              <InlineRow key={key} label={labelize(key)} value={data[key]} onChange={setKey(key)} fieldKey={key} />
            ))}
          </div>
        </Section>
      )}

      {sections.map((key) => {
        const v = data[key];
        const badge = Array.isArray(v) ? v.length : undefined;
        // Long arrays (parts) collapse the section by default; everything else opens.
        const defaultOpen = !(Array.isArray(v) && v.length > 6);
        return (
          <Section key={key} title={labelize(key)} badge={badge} defaultOpen={defaultOpen}>
            <Field value={v} onChange={setKey(key)} fieldKey={key} />
          </Section>
        );
      })}
    </div>
  );
}
