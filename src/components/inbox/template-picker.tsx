"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact, CustomField, MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
  /** When set, body/header variables can pull Contact / custom field values. */
  contact?: Contact | null;
}

type VarSourceKind = "static" | "contact" | "custom";

interface VarSource {
  kind: VarSourceKind;
  /** Contact column, custom field id, or static text */
  value: string;
}

const CONTACT_FIELDS = [
  { value: "name", label: "Contact · Name" },
  { value: "phone", label: "Contact · Phone" },
  { value: "email", label: "Contact · Email" },
  { value: "company", label: "Contact · Company" },
] as const;

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none";

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots };
}

function resolveVarSource(
  source: VarSource,
  contact: Contact | null | undefined,
  customValues: Map<string, string>,
): string {
  if (source.kind === "static") return source.value;
  if (!contact) return "";
  if (source.kind === "contact") {
    const key = source.value as "name" | "phone" | "email" | "company";
    return String(contact[key] ?? "");
  }
  return customValues.get(source.value) ?? "";
}

function VariableSourceEditor({
  label,
  source,
  onChange,
  contact,
  customFields,
  customValues,
  placeholder,
}: {
  label: string
  source: VarSource
  onChange: (next: VarSource) => void
  contact?: Contact | null
  customFields: CustomField[]
  customValues: Map<string, string>
  placeholder?: string
}) {
  const resolved = resolveVarSource(source, contact, customValues)
  const canPickFields = Boolean(contact)

  return (
    <div className="space-y-1.5 rounded-md border border-border/70 bg-background/40 p-2">
      <Label className="text-xs text-popover-foreground">{label}</Label>
      {canPickFields ? (
        <select
          value={source.kind}
          onChange={(e) => {
            const kind = e.target.value as VarSourceKind
            if (kind === "static") {
              onChange({ kind: "static", value: "" })
              return
            }
            if (kind === "contact") {
              onChange({ kind: "contact", value: "name" })
              return
            }
            onChange({
              kind: "custom",
              value: customFields[0]?.id ?? "",
            })
          }}
          className={SELECT_CLASS}
        >
          <option value="static">Static value</option>
          <option value="contact">Contact field</option>
          <option value="custom">Custom field</option>
        </select>
      ) : null}

      {source.kind === "static" || !canPickFields ? (
        <Input
          value={source.value}
          onChange={(e) => onChange({ kind: "static", value: e.target.value })}
          placeholder={placeholder}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      ) : null}

      {canPickFields && source.kind === "contact" ? (
        <select
          value={source.value || "name"}
          onChange={(e) =>
            onChange({ kind: "contact", value: e.target.value })
          }
          className={SELECT_CLASS}
        >
          {CONTACT_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      ) : null}

      {canPickFields && source.kind === "custom" ? (
        <select
          value={source.value}
          onChange={(e) =>
            onChange({ kind: "custom", value: e.target.value })
          }
          className={SELECT_CLASS}
        >
          {customFields.length === 0 ? (
            <option value="">No custom fields yet</option>
          ) : (
            customFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.field_name}
              </option>
            ))
          )}
        </select>
      ) : null}

      {canPickFields && source.kind !== "static" ? (
        <p className="truncate text-[10px] text-muted-foreground">
          Resolves to:{" "}
          <span className="text-popover-foreground">
            {resolved.trim() ? resolved : "(empty)"}
          </span>
        </p>
      ) : null}
    </div>
  )
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  contact,
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [bodySources, setBodySources] = useState<VarSource[]>([]);
  const [headerSource, setHeaderSource] = useState<VarSource>({
    kind: "static",
    value: "",
  });
  const [buttonSources, setButtonSources] = useState<
    Record<number, VarSource>
  >({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Map<string, string>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setCustomFields([]);
          setCustomValues(new Map());
          setLoading(false);
        }
        return;
      }

      // Scope by RLS (message_templates_select → is_account_member), NOT by
      // user_id. Templates are account-owned, so filtering on the caller's
      // user_id hid templates that a teammate created — leaving them unable
      // to send approved templates in a shared account.
      const [templatesRes, fieldsRes] = await Promise.all([
        supabase
          .from("message_templates")
          .select("*")
          .eq("status", "APPROVED")
          .order("created_at", { ascending: false }),
        supabase.from("custom_fields").select("*").order("field_name"),
      ]);

      if (cancelled) return;
      if (templatesRes.error) {
        console.error("Failed to fetch templates:", templatesRes.error);
        setTemplates([]);
      } else {
        setTemplates((templatesRes.data as MessageTemplate[]) ?? []);
      }
      setCustomFields((fieldsRes.data as CustomField[] | null) ?? []);

      if (contact?.id) {
        const { data: vals } = await supabase
          .from("contact_custom_values")
          .select("custom_field_id, value")
          .eq("contact_id", contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of vals ?? []) {
            map.set(row.custom_field_id, row.value ?? "");
          }
          setCustomValues(map);
        }
      } else if (!cancelled) {
        setCustomValues(new Map());
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, contact?.id]);

  function resetSelection() {
    setSelected(null);
    setBodySources([]);
    setHeaderSource({ kind: "static", value: "" });
    setButtonSources({});
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setBodySources(
      slots.bodyVars.map(() => ({ kind: "static" as const, value: "" })),
    );
    setHeaderSource({ kind: "static", value: "" });
    setButtonSources({});
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );

  const resolvedBody = useMemo(
    () =>
      bodySources.map((s) => resolveVarSource(s, contact, customValues)),
    [bodySources, contact, customValues],
  );
  const resolvedHeader = useMemo(
    () => resolveVarSource(headerSource, contact, customValues),
    [headerSource, contact, customValues],
  );
  const resolvedButtons = useMemo(() => {
    const out: Record<number, string> = {};
    for (const [k, source] of Object.entries(buttonSources)) {
      out[Number(k)] = resolveVarSource(source, contact, customValues);
    }
    return out;
  }, [buttonSources, contact, customValues]);

  function confirm() {
    if (!selected || !slots) return;
    const values: TemplateSendValues = { body: resolvedBody };
    if (slots.headerVarCount > 0) values.headerText = resolvedHeader.trim();
    if (Object.keys(resolvedButtons).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(resolvedButtons).map(([k, v]) => [
          Number(k),
          v.trim(),
        ]),
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (resolvedBody[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || resolvedHeader.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (resolvedButtons[s.index] ?? "").trim().length > 0,
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : "Send template"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected
              ? contact
                ? "Map each placeholder to a Contact field, custom field, or static value."
                : "Fill in the placeholders to render this template. Meta requires every variable to be set."
              : "Pick an approved WhatsApp template to send to this contact."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-popover-foreground">No approved templates</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approve a template in Meta WhatsApp Manager, then sync it
                  from Settings → Templates.
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-popover"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-popover-foreground">
                          {t.name}
                        </p>
                        <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">Preview</p>
              <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                {renderBodyPreview(selected.body_text, resolvedBody)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {slots && slots.headerVarCount > 0 && (
              <VariableSourceEditor
                label="Header {{1}}"
                source={headerSource}
                onChange={setHeaderSource}
                contact={contact}
                customFields={customFields}
                customValues={customValues}
                placeholder="Value for the header variable"
              />
            )}
            {slots?.bodyVars.map((v, i) => (
              <VariableSourceEditor
                key={v}
                label={`Body {{${v}}}`}
                source={bodySources[i] ?? { kind: "static", value: "" }}
                onChange={(next) => {
                  const copy = [...bodySources];
                  copy[i] = next;
                  setBodySources(copy);
                }}
                contact={contact}
                customFields={customFields}
                customValues={customValues}
                placeholder={`Value for {{${v}}}`}
              />
            ))}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <VariableSourceEditor
                  label={`URL button "${slot.text}" — {{1}}`}
                  source={
                    buttonSources[slot.index] ?? {
                      kind: "static",
                      value: "",
                    }
                  }
                  onChange={(next) =>
                    setButtonSources((prev) => ({
                      ...prev,
                      [slot.index]: next,
                    }))
                  }
                  contact={contact}
                  customFields={customFields}
                  customValues={customValues}
                  placeholder="URL suffix value"
                />
                <p className="break-all px-1 text-[10px] text-muted-foreground">
                  Final URL:{" "}
                  {slot.url.replace(
                    /\{\{1\}\}/g,
                    resolvedButtons[slot.index] || "{{1}}",
                  )}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Send template
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
