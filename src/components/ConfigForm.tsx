"use client";

import { useState } from "react";
import Hjson from "hjson";

/**
 * A structured, form-based editor for a VehiclesPlus config. Parses the HJSON once and renders nice
 * typed fields (text / number / toggle / colour picker / lists / nested sections) for every key —
 * including ones we don't specially know about — then serialises back to HJSON on every change.
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
  "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-amber-500";

function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className={`${inputCls} w-full`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
}

function NumberField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // Local string state so intermediate edits like "1." or "-" aren't clobbered by re-serialisation.
  const [local, setLocal] = useState(String(value));
  return (
    <input
      className={`${inputCls} w-28`}
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
      className={`h-5 w-9 rounded-full px-0.5 transition ${value ? "bg-amber-500" : "bg-neutral-700"}`}
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

function Field({ value, onChange }: { value: Json; onChange: (v: Json) => void }) {
  if (isColor(value)) return <ColorField value={value} onChange={onChange} />;
  if (Array.isArray(value)) return <ArrayField value={value} onChange={onChange} />;
  if (isPlainObject(value)) return <ObjectField value={value} onChange={onChange} />;
  if (typeof value === "boolean") return <BoolField value={value} onChange={onChange} />;
  if (typeof value === "number") return <NumberField value={value} onChange={onChange} />;
  return <TextField value={value == null ? "" : String(value)} onChange={onChange} />;
}

/** A primitive is shown inline (label + control on one row); objects/arrays get their own block. */
function isInline(v: Json): boolean {
  return isColor(v) || !(Array.isArray(v) || isPlainObject(v));
}

function ObjectField({ value, onChange, top }: { value: Record<string, Json>; onChange: (v: Json) => void; top?: boolean }) {
  const keys = Object.keys(value);
  const body = (
    <div className="space-y-2">
      {keys.map((key) => {
        const v = value[key];
        const set = (nv: Json) => onChange({ ...value, [key]: nv });
        if (isInline(v)) {
          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <label className="shrink-0 text-xs text-neutral-400">{labelize(key)}</label>
              <Field value={v} onChange={set} />
            </div>
          );
        }
        return (
          <div key={key} className="rounded border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{labelize(key)}</div>
            <Field value={v} onChange={set} />
          </div>
        );
      })}
    </div>
  );
  return top ? body : <div className="pl-1">{body}</div>;
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

function ArrayField({ value, onChange }: { value: Json[]; onChange: (v: Json) => void }) {
  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <Field value={item} onChange={(nv) => onChange(value.map((it, j) => (j === i ? nv : it)))} />
          </div>
          <button
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            title="Remove"
            className="mt-0.5 rounded px-1.5 text-neutral-600 hover:bg-neutral-800 hover:text-red-400"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...value, value.length ? templateFrom(value) : ""])}
        className="rounded border border-dashed border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
      >
        + Add
      </button>
    </div>
  );
}

export default function ConfigForm({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [data, setData] = useState<Json | null>(() => {
    try {
      return Hjson.parse(text) as Json;
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
    onChange(Hjson.stringify(next, { bracesSameLine: false, separator: false }));
  };

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      <ObjectField value={data} onChange={update} top />
    </div>
  );
}
