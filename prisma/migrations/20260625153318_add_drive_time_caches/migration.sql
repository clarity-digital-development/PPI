-- Round 25: drive-time cache tables. Layered on top of the existing
-- haversine + ZIP-override service-area pipeline. Populated by the
-- Google Routes API (see scripts/seed-zip-drive-times.ts and
-- lib/service-area/google-routes.ts). Both tables hold a `cached_at`
-- column because Google Maps Platform Service Terms require drive-time
-- values to be refreshed every 30 days.

-- CreateTable
CREATE TABLE "zip_drive_time_cache" (
    "zip" VARCHAR(5) NOT NULL,
    "center_id" TEXT NOT NULL,
    "drive_minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google_routes',
    "cached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zip_drive_time_cache_pkey" PRIMARY KEY ("zip", "center_id")
);

-- CreateIndex
CREATE INDEX "zip_drive_time_cache_cached_at_idx" ON "zip_drive_time_cache"("cached_at");

-- CreateTable
CREATE TABLE "address_drive_time_cache" (
    "address_hash" VARCHAR(64) NOT NULL,
    "center_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "drive_minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google_routes',
    "cached_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_drive_time_cache_pkey" PRIMARY KEY ("address_hash", "center_id")
);

-- CreateIndex
CREATE INDEX "address_drive_time_cache_cached_at_idx" ON "address_drive_time_cache"("cached_at");

-- AlterTable (Round 25 audit trail): record which drive-time signal
-- decided each order's service-area tier. Nullable so existing rows and
-- exempt / override-decided orders can stay null without a backfill.
ALTER TABLE "orders"
  ADD COLUMN "service_area_drive_minutes" INTEGER,
  ADD COLUMN "service_area_drive_time_source" TEXT;
