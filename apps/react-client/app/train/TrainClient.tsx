"use client";

import { useState } from "react";
import { Database, Network, History, ShieldAlert, RotateCcw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PasswordField } from "@/components/ui/Field";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { EmptyState } from "@/components/ui/EmptyState";
import { AppFooter } from "@/components/layout/AppFooter";
import {
  fetchModelHistory,
  fetchModelStatus,
  rollbackModel,
  runAggregation,
  seedFromDataset,
  type ModelHistoryEntry,
  type ModelStatusResponse,
} from "@/lib/api";
import { formatDateTime, formatRelativeDays, daysSince } from "@/lib/format";

type Busy = "none" | "unlocking" | "seeding" | "aggregating" | "rollback";

interface Outcome {
  tone: "success" | "warning" | "error";
  message: string;
}

/**
 * Operator console for model seeding, aggregation and rollback.
 *
 * Rendered without the application shell: `/train` is unlisted and must not
 * carry public navigation (GL-03, GL-06). The Stitch design puts the public
 * header on this screen; the requirement wins.
 *
 * The admin secret lives in component state and nowhere else — never storage,
 * never the URL, never a log (AD-06, SC-03).
 */
export default function TrainClient() {
  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState("");
  const [status, setStatus] = useState<ModelStatusResponse | null>(null);
  const [history, setHistory] = useState<ModelHistoryEntry[]>([]);
  const [busy, setBusy] = useState<Busy>("none");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const unlocked = status !== null;

  async function refresh(withSecret: string) {
    const [statusResult, historyResult] = await Promise.all([
      fetchModelStatus(withSecret),
      fetchModelHistory(withSecret, 1, 10),
    ]);
    if (statusResult.ok) setStatus(statusResult.data);
    if (historyResult.ok) setHistory(historyResult.data.results);
    return statusResult;
  }

  async function handleUnlock(event: React.FormEvent) {
    event.preventDefault();
    if (!secret) {
      setSecretError("Enter the operator key.");
      return;
    }

    setBusy("unlocking");
    setSecretError("");

    // AD-01: a read-only status call. Authenticating never changes state.
    const result = await refresh(secret);
    setBusy("none");

    if (!result.ok) {
      setSecretError(
        result.status === 403 ? "That key was rejected. Access denied." : result.error,
      );
    }
  }

  async function handleSeed() {
    setBusy("seeding");
    setOutcome(null);
    const result = await seedFromDataset(secret);
    if (result.ok) {
      setOutcome({
        tone: "success",
        message: `Seeded from the demonstration dataset — ${result.data.n_samples.toLocaleString("en-IN")} samples, ${result.data.n_features} features, classes ${result.data.classes.join(" and ")}. Activated as global model #${result.data.globalModel.serialno}.`,
      });
      await refresh(secret);
    } else {
      setOutcome({ tone: "error", message: result.error });
    }
    setBusy("none");
  }

  async function handleAggregate() {
    setBusy("aggregating");
    setOutcome(null);
    const result = await runAggregation(secret);
    if (result.ok) {
      // AD-04: a round that the model service never confirmed is not a success.
      const confirmed = result.data.modelService === "weights updated";
      setOutcome({
        tone: confirmed ? "success" : "warning",
        message: `FedAvg round complete — ${result.data.participants} participants, ${result.data.n_samples_total.toLocaleString("en-IN")} samples, saved as global model #${result.data.globalModel.serialno}. Model service: ${result.data.modelService}.`,
      });
      await refresh(secret);
    } else {
      setOutcome({ tone: "error", message: result.error });
    }
    setBusy("none");
  }

  async function handleRollback(serialno: number) {
    setBusy("rollback");
    setOutcome(null);
    const result = await rollbackModel(secret, serialno);
    if (result.ok) {
      setOutcome({
        tone: "success",
        message: `${result.data.message}. Restored as global model #${result.data.globalModel.serialno}.`,
      });
      await refresh(secret);
    } else {
      setOutcome({ tone: "error", message: result.error });
    }
    setBusy("none");
  }

  const activeSerial = status?.activeModel?.serialno ?? null;

  const columns: Array<Column<ModelHistoryEntry>> = [
    {
      key: "serial",
      header: "Serial",
      render: (row) =>
        row.serialno === activeSerial ? (
          <Badge tone="primary">#{row.serialno}</Badge>
        ) : (
          <span className="font-mono text-on-surface-variant">#{row.serialno}</span>
        ),
    },
    { key: "timestamp", header: "Timestamp", render: (row) => formatDateTime(row.timestamp) },
    {
      key: "participants",
      header: "Participants",
      align: "right",
      render: (row) => row.participants,
    },
    {
      key: "versions",
      header: "Contract",
      align: "right",
      render: (row) => (
        <span className="font-mono text-label-xs text-on-surface-variant">
          f{row.feature_version}/s{row.scaler_version}/m{row.model_version}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) =>
        row.serialno === activeSerial ? (
          <span className="text-label-xs text-on-surface-variant italic">Active</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            busy={busy === "rollback"}
            onClick={() => handleRollback(row.serialno)}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Roll back
          </Button>
        ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-on-background">
      <header className="border-b border-outline-variant bg-surface-container-low">
        <div className="max-w-[1280px] mx-auto px-margin h-16 flex items-center justify-between gap-md">
          <span className="text-title-xl font-semibold text-primary tracking-tight">
            PortfolioIQ
          </span>
          <Badge tone="tertiary" variant="soft" uppercase icon={<ShieldAlert className="size-3.5" />}>
            Restricted access
          </Badge>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-margin py-xl flex flex-col gap-lg">
        <div>
          <h1 className="text-verdict-lg text-on-surface">System operations</h1>
          <p className="text-body-base text-on-surface-variant mt-sm max-w-prose">
            Administrative panel for model aggregation, demo provisioning and rollback.
          </p>
        </div>

        {outcome && (
          <Alert tone={outcome.tone} role="alert">
            {outcome.message}
          </Alert>
        )}

        <div className="grid lg:grid-cols-12 gap-lg items-start">
          {/* Left rail: authentication and operations. */}
          <div className="lg:col-span-4 flex flex-col gap-lg">
            <Card aria-labelledby="auth-heading">
              <CardHeader id="auth-heading" title="Authentication" level={2} />
              {unlocked ? (
                <Alert tone="success">Operator key accepted for this session only.</Alert>
              ) : (
                <form onSubmit={handleUnlock} className="flex flex-col gap-md">
                  <PasswordField
                    label="Admin secret"
                    value={secret}
                    onChange={(v) => {
                      setSecret(v);
                      setSecretError("");
                    }}
                    placeholder="Enter operator key…"
                    error={secretError}
                    autoComplete="off"
                    hint="Held in memory for this session. Never written to storage or the URL."
                    disabled={busy === "unlocking"}
                  />
                  <Button type="submit" fullWidth busy={busy === "unlocking"} busyLabel="Verifying…">
                    Verify key
                  </Button>
                </form>
              )}
            </Card>

            {unlocked && status && (
              <Card aria-labelledby="ops-heading">
                <CardHeader id="ops-heading" title="Operations" level={2} />

                <div className="flex flex-col gap-sm">
                  <h3 className="text-body-sm font-semibold text-on-surface">Seed environment</h3>
                  <p className="text-label-xs font-normal text-on-surface-variant">
                    Trains the model service on the bundled synthetic demonstration dataset and
                    activates the result as a new global model.
                  </p>
                  <ConfirmAction
                    variant="secondary"
                    icon={<Database aria-hidden="true" className="size-4" />}
                    confirmTitle="Destructive action"
                    confirmMessage="This replaces the active global model for every client with one trained on synthetic data."
                    confirmLabel="Seed"
                    onConfirm={handleSeed}
                    busy={busy === "seeding"}
                    busyLabel="Training on dataset…"
                    disabled={!status.flags.demoModelEnabled && !status.flags.federatedAggregationEnabled}
                    disabledReason={
                      !status.flags.demoModelEnabled && !status.flags.federatedAggregationEnabled
                        ? "Unavailable: DEMO_MODEL_ENABLED and FEDERATED_AGGREGATION_ENABLED are both off."
                        : undefined
                    }
                  >
                    Seed from dataset
                  </ConfirmAction>
                </div>

                <div className="flex flex-col gap-sm pt-md border-t border-outline-variant">
                  <h3 className="text-body-sm font-semibold text-on-surface">Run aggregation</h3>
                  <p className="text-label-xs font-normal text-on-surface-variant">
                    Runs one sample-weighted FedAvg round over the latest client weights and
                    activates the result.
                  </p>
                  <ConfirmAction
                    icon={<Network aria-hidden="true" className="size-4" />}
                    confirmTitle="Initiate round"
                    confirmMessage="This activates a new global model version for every connected client."
                    confirmLabel="Start round"
                    onConfirm={handleAggregate}
                    busy={busy === "aggregating"}
                    busyLabel="Running FedAvg…"
                    disabled={!status.flags.federatedAggregationEnabled}
                    disabledReason={
                      status.flags.federatedAggregationEnabled
                        ? undefined
                        : "Unavailable: FEDERATED_AGGREGATION_ENABLED is off pending outcome-based model validation."
                    }
                  >
                    Run FedAvg round
                  </ConfirmAction>
                </div>
              </Card>
            )}
          </div>

          {/* Right: state and audit trail. */}
          <div className="lg:col-span-8 flex flex-col gap-lg">
            {unlocked && status ? (
              <>
                <StatGrid columns={3}>
                  <Stat
                    label="Active serial"
                    value={status.activeModel ? `#${status.activeModel.serialno}` : "None"}
                    accent="primary"
                    hint="Global model"
                  />
                  <Stat
                    label="Last update"
                    value={
                      status.activeModel ? formatDateTime(status.activeModel.timestamp) : "—"
                    }
                    accent="primary"
                    hint={
                      status.activeModel
                        ? formatRelativeDays(daysSince(status.activeModel.timestamp))
                        : "No model activated yet"
                    }
                  />
                  <Stat
                    label="Participants"
                    value={status.activeModel ? status.activeModel.participants : "—"}
                    accent="primary"
                    hint="In the activating round"
                  />
                </StatGrid>

                <Card aria-labelledby="history-heading">
                  <CardHeader
                    id="history-heading"
                    title="Model history"
                    level={2}
                    action={<History aria-hidden="true" className="size-5 text-on-surface-variant" />}
                  />
                  <DataTable
                    caption="Global model snapshots, newest first, with a rollback action per row"
                    columns={columns}
                    rows={history}
                    rowKey={(row) => String(row.serialno)}
                    empty={
                      <EmptyState
                        icon={<History className="size-6" />}
                        title="No global model snapshots yet"
                        description="Seed the environment or run an aggregation round to create the first one."
                      />
                    }
                  />
                </Card>
              </>
            ) : (
              <EmptyState
                icon={<ShieldAlert className="size-7" />}
                title="Verify the operator key to continue"
                description="Model state, history and operations are hidden until the key is accepted. Verification is read-only and changes nothing."
              />
            )}

            {/* AD-07 */}
            <Alert tone="info">
              <strong className="text-on-surface font-semibold">Notice: </strong>
              The seed dataset is synthetic and exists for contract and demonstration purposes
              only — it does not validate financial performance. Aggregation and seeding both
              change the global model state for every connected client.
            </Alert>
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
