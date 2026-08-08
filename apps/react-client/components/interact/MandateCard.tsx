"use client";

import { CalendarDays, Landmark, TrendingUp } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  CurrencyField,
  DateField,
  NumberField,
  SelectField,
  SliderField,
} from "@/components/ui/Field";
import {
  RISK_MAX,
  RISK_MIN,
  RISK_STEP,
  type MandateFieldErrors,
  type MandateInput,
} from "@/lib/mandate";
import { formatRelativeDays, daysSince, toIsoDate } from "@/lib/format";
import type { AccountType } from "@/lib/rebalanceEconomics";

interface MandateCardProps {
  value: MandateInput;
  errors: MandateFieldErrors;
  onChange: (patch: Partial<MandateInput>) => void;
  disabled?: boolean;
}

/**
 * The mandate the engine consumes (AN-08).
 *
 * Every field carries a one-line explanation of what it changes in the result,
 * because these are unfamiliar concepts to someone arriving without a written
 * allocation policy (AN-11).
 */
export function MandateCard({ value, errors, onChange, disabled }: MandateCardProps) {
  const today = toIsoDate(new Date());

  return (
    <Card aria-labelledby="mandate-heading">
      <CardHeader id="mandate-heading" title="2. Execution mandate" level={2} />

      <DateField
        label="Last rebalance"
        value={value.lastRebalanceDate}
        onChange={(v) => onChange({ lastRebalanceDate: v })}
        max={today}
        disabled={disabled}
        error={errors.lastRebalanceDate}
        icon={<CalendarDays className="size-4" />}
        hint={
          value.lastRebalanceDate && !errors.lastRebalanceDate
            ? `${formatRelativeDays(daysSince(value.lastRebalanceDate))} — feeds the “days since last rebalance” feature.`
            : "Date of your last major portfolio adjustment. Leave blank if you have never rebalanced."
        }
      />

      <CurrencyField
        label="Available cash"
        value={value.cashAvailable}
        onChange={(v) => onChange({ cashAvailable: v })}
        min={0}
        step={1000}
        placeholder="0"
        disabled={disabled}
        error={errors.cashAvailable}
        hint="Deployable capital. Funds the buy side of any proposed trades."
      />

      <NumberField
        label="Horizon (days)"
        value={value.horizonDays}
        onChange={(v) => onChange({ horizonDays: v })}
        min={1}
        max={3650}
        step={1}
        placeholder="365"
        disabled={disabled}
        error={errors.horizonDays}
        icon={<TrendingUp className="size-4" />}
        hint="Intended holding period before the next review. Scales the benefit of correcting drift."
      />

      <SliderField
        label="Risk preference"
        value={value.riskAversion}
        onChange={(v) => onChange({ riskAversion: v })}
        min={RISK_MIN}
        max={RISK_MAX}
        step={RISK_STEP}
        minLabel={`Tolerant (${RISK_MIN})`}
        maxLabel={`Averse (${RISK_MAX})`}
        disabled={disabled}
        error={errors.riskAversion}
        hint="Higher aversion values drift correction more, so smaller deviations become worth trading."
      />

      <SelectField
        label="Account type"
        value={value.accountType}
        onChange={(v) => onChange({ accountType: v as AccountType })}
        options={[
          { value: "taxable", label: "Taxable" },
          { value: "tax-advantaged", label: "Tax-advantaged" },
        ]}
        disabled={disabled}
        icon={<Landmark className="size-4" />}
        hint="Determines whether capital-gains tax is estimated against the sell side."
      />
    </Card>
  );
}
