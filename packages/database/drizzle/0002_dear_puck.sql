ALTER TABLE "globalmodelhistory" ADD COLUMN "participants" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "globalmodelhistory" ADD COLUMN "n_samples_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "globalmodelhistory" ADD COLUMN "feature_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "globalmodelhistory" ADD COLUMN "scaler_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "globalmodelhistory" ADD COLUMN "model_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usermodelhistory" ADD COLUMN "feature_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usermodelhistory" ADD COLUMN "scaler_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usermodelhistory" ADD COLUMN "model_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usermodelhistory" ADD COLUMN "validation_auc" real;